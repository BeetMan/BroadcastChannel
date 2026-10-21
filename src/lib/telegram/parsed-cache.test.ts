import { afterEach, describe, expect, it } from 'vitest'
import {
  channelInfoCacheKey,
  channelPostCacheKey,
  isCachedChannelInfo,
  PARSED_CACHE_TTL_SECONDS,
  readParsedJson,
  setParsedCacheKv,
  writeParsedJson,
} from './parsed-cache'

function memoryKv() {
  const entries = new Map<string, { value: string, expirationTtl?: number }>()
  return {
    entries,
    kv: {
      async get(key: string, type: 'json') {
        const entry = entries.get(key)
        if (!entry)
          return null

        return type === 'json' ? JSON.parse(entry.value) as unknown : entry.value
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }) {
        entries.set(key, { value, expirationTtl: options?.expirationTtl })
      },
    },
  }
}

describe('parsed telegram cache', () => {
  afterEach(() => {
    setParsedCacheKv(undefined)
  })

  it('keeps variable key parts from colliding and bounds long keys', () => {
    const shared = {
      channel: 'demo',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactions: false,
    }
    const withColonInQuery = channelInfoCacheKey({ ...shared, q: 'a:b' })
    const withColonInAfter = channelInfoCacheKey({ ...shared, after: 'a', q: 'b' })

    expect(withColonInQuery).not.toBe(withColonInAfter)
    expect(withColonInQuery.startsWith('bc:parsed:v1:info:')).toBe(true)
    expect(withColonInQuery).toContain('%2Fstatic%2F')

    const longKey = channelInfoCacheKey({ ...shared, q: 'x'.repeat(600) })
    expect(longKey.length).toBeLessThanOrEqual(512)
    expect(longKey).not.toBe(channelInfoCacheKey({ ...shared, q: 'y'.repeat(600) }))
  })

  it('includes the post id in the post key', () => {
    expect(channelPostCacheKey({
      channel: 'demo',
      id: '42',
      telegramHost: 'telegram.dog',
      staticProxy: '',
      reactions: true,
    })).toBe('bc:parsed:v1:post:demo:42:telegram.dog::1')
  })

  it('round-trips JSON in the injected KV with the page cache TTL', async () => {
    const { entries, kv } = memoryKv()
    setParsedCacheKv(kv)
    const key = channelPostCacheKey({ channel: 'demo', id: '7' })

    expect(await readParsedJson(key)).toBeNull()
    await writeParsedJson(key, { id: '7', ok: true })

    expect(await readParsedJson(key)).toEqual({ id: '7', ok: true })
    expect(entries.get(key)?.expirationTtl).toBe(PARSED_CACHE_TTL_SECONDS)
  })

  it('returns null when KV is unavailable or the payload is corrupt', async () => {
    setParsedCacheKv(null)
    expect(await readParsedJson('missing')).toBeNull()
    await writeParsedJson('missing', { ok: true })

    setParsedCacheKv({
      async get() {
        throw new Error('kv down')
      },
      async put() {
        throw new Error('kv down')
      },
    })
    expect(await readParsedJson('missing')).toBeNull()
    await expect(writeParsedJson('missing', { ok: true })).resolves.toBeUndefined()
  })

  it('accepts only channel payloads that include a posts array', () => {
    expect(isCachedChannelInfo({ posts: [], title: 'Channel', description: '', descriptionHTML: null })).toBe(true)
    expect(isCachedChannelInfo({ posts: 'nope', title: 'Channel' })).toBe(false)
    expect(isCachedChannelInfo(null)).toBe(false)
  })
})
