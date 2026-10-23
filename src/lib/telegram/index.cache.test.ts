import type { Post } from '../../types'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./request', () => ({
  loadChannelDocument: vi.fn(),
}))

vi.mock('./parse', () => ({
  extractPost: vi.fn(),
}))

vi.mock('./content', () => ({
  modifyHTMLContent: vi.fn(async () => ({
    html: () => '<p>About</p>',
  })),
}))

const { loadChannelDocument } = await import('./request')
const { extractPost } = await import('./parse')
const { modifyHTMLContent } = await import('./content')
const { getChannelInfo, getChannelPost } = await import('./index')
const { setParsedCacheKv } = await import('./parsed-cache')

function memoryKv() {
  const entries = new Map<string, string>()
  const gets: string[] = []
  const puts: string[] = []
  return {
    entries,
    gets,
    puts,
    kv: {
      async get(key: string, type: 'json') {
        gets.push(key)
        const value = entries.get(key)
        if (value == null)
          return null

        return type === 'json' ? JSON.parse(value) as unknown : value
      },
      async put(key: string) {
        puts.push(key)
        throw new Error(`parsed cache must not put ${key}`)
      },
    },
  }
}

function createPost(id: string): Post {
  return {
    id,
    title: `Post ${id}`,
    type: 'text',
    datetime: '2026-01-02T03:04:05.000Z',
    tags: [],
    text: 'Text',
    content: `<p>${id}</p>`,
    reactions: [],
  }
}

function channelDocument() {
  const selectors: Record<string, { toArray?: () => unknown[], attr?: (name: string) => string | undefined, text?: () => string }> = {
    '.tgme_channel_history .tgme_widget_message_wrap': { toArray: () => [{}, {}] },
    '.tgme_page_photo_image img': { attr: () => 'https://cdn.example/avatar.jpg' },
    '.tgme_channel_info_header_title': { text: () => 'Channel' },
    '.tgme_channel_info_description': { text: () => 'Description' },
  }
  const $ = (selector: string) => selectors[selector] ?? { text: () => '', attr: () => undefined, toArray: () => [] }

  return {
    $,
    channel: 'demo',
    telegramHost: 'telegram.me',
    staticProxy: '/static/',
    reactionsEnabled: undefined,
  }
}

describe('parsed channel cache', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    setParsedCacheKv(undefined)
  })

  it('reads an existing channel payload and does not put on a miss', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    const { entries, gets, puts, kv } = memoryKv()
    setParsedCacheKv(kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost)
      .mockResolvedValueOnce(createPost('older'))
      .mockResolvedValueOnce(createPost('newer'))

    const parsed = await getChannelInfo()
    expect(parsed.posts.map(post => post.id)).toEqual(['newer', 'older'])
    expect(modifyHTMLContent).toHaveBeenCalledTimes(1)
    expect(puts).toEqual([])
    expect(entries.size).toBe(0)
    expect(gets[0]).toMatch(/^bc:parsed:v1:info:/)

    entries.set(gets[0], JSON.stringify({
      ...parsed,
      title: 'From KV',
    }))
    vi.mocked(loadChannelDocument).mockClear()

    const cached = await getChannelInfo()
    expect(cached.title).toBe('From KV')
    expect(loadChannelDocument).not.toHaveBeenCalled()
    expect(puts).toEqual([])
  })

  it('shares one in-flight parse across concurrent callers', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    setParsedCacheKv(memoryKv().kv)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(loadChannelDocument).mockImplementation(async () => {
      await gate
      return channelDocument() as never
    })
    vi.mocked(extractPost).mockImplementation(async (_$, _item, options) => createPost(String(options?.index ?? 'x')))

    const pending = Promise.all([getChannelInfo(), getChannelInfo()])
    await vi.waitFor(() => expect(loadChannelDocument).toHaveBeenCalledTimes(1))
    release()
    const [first, second] = await pending

    expect(first).toEqual(second)
    expect(loadChannelDocument).toHaveBeenCalledTimes(1)
  })

  it('serves a stored post from KV and parses a miss without putting', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    const { entries, gets, puts, kv } = memoryKv()
    setParsedCacheKv(kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost).mockResolvedValue(createPost('99'))

    expect(await getChannelPost('99')).toMatchObject({ id: '99' })
    expect(puts).toEqual([])
    expect(gets[0]).toMatch(/^bc:parsed:v1:post:/)
    entries.set(gets[0], JSON.stringify(createPost('99')))
    vi.mocked(loadChannelDocument).mockClear()

    expect(await getChannelPost('99')).toMatchObject({ id: '99' })
    expect(loadChannelDocument).not.toHaveBeenCalled()
    expect(puts).toEqual([])
  })

  it('does not cache a post that cannot be rendered', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    const { puts, kv } = memoryKv()
    setParsedCacheKv(kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost).mockResolvedValue({ ...createPost(''), type: 'service' })

    expect(await getChannelPost('1')).toBeNull()
    expect(await getChannelPost('1')).toBeNull()
    expect(loadChannelDocument).toHaveBeenCalledTimes(2)
    expect(puts).toEqual([])
  })
})
