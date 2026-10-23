import { afterEach, describe, expect, it } from 'vitest'
import {
  channelInfoCacheKey,
  channelPostCacheKey,
  isCachedChannelInfo,
  readParsedJson,
  setParsedCacheKv,
} from './parsed-cache'

function memoryKv() {
  const entries = new Map<string, string>()
  return {
    entries,
    kv: {
      async get(key: string, type: 'json') {
        const value = entries.get(key)
        if (value == null)
          return null

        return type === 'json' ? JSON.parse(value) as unknown : value
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

  it('reads JSON that is already stored and does not write', async () => {
    const { entries, kv } = memoryKv()
    const cache = await import('./parsed-cache')
    setParsedCacheKv(kv)
    const key = channelPostCacheKey({ channel: 'demo', id: '7' })
    entries.set(key, JSON.stringify({ id: '7', ok: true }))

    expect(await readParsedJson(key)).toEqual({ id: '7', ok: true })
    expect(entries.size).toBe(1)
    expect('writeParsedJson' in cache).toBe(false)
  })

  it('returns null when KV is unavailable or the read fails', async () => {
    setParsedCacheKv(null)
    expect(await readParsedJson('missing')).toBeNull()

    setParsedCacheKv({
      async get() {
        throw new Error('kv down')
      },
    })
    expect(await readParsedJson('missing')).toBeNull()
  })

  it('accepts only channel payloads that include a posts array', () => {
    expect(isCachedChannelInfo({ posts: [], title: 'Channel', description: '', descriptionHTML: null })).toBe(true)
    expect(isCachedChannelInfo({ posts: 'nope', title: 'Channel' })).toBe(false)
    expect(isCachedChannelInfo(null)).toBe(false)
  })
})
