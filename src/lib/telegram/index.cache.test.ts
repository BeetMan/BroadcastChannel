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
  return {
    entries,
    kv: {
      async get(key: string, type: 'json') {
        const value = entries.get(key)
        if (value == null)
          return null

        return type === 'json' ? JSON.parse(value) as unknown : value
      },
      async put(key: string, value: string) {
        entries.set(key, value)
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

  it('parses a channel once and serves the next call from KV', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    const { entries, kv } = memoryKv()
    setParsedCacheKv(kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost)
      .mockResolvedValueOnce(createPost('older'))
      .mockResolvedValueOnce(createPost('newer'))

    const first = await getChannelInfo()
    const second = await getChannelInfo()

    expect(first.posts.map(post => post.id)).toEqual(['newer', 'older'])
    expect(second).toEqual(first)
    expect(loadChannelDocument).toHaveBeenCalledTimes(1)
    expect(modifyHTMLContent).toHaveBeenCalledTimes(1)
    expect(entries.size).toBe(1)
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

  it('caches a single post without re-fetching Telegram HTML', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    setParsedCacheKv(memoryKv().kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost).mockResolvedValue(createPost('99'))

    expect(await getChannelPost('99')).toMatchObject({ id: '99' })
    expect(await getChannelPost('99')).toMatchObject({ id: '99' })
    expect(loadChannelDocument).toHaveBeenCalledTimes(1)
  })

  it('does not cache a post that cannot be rendered', async () => {
    vi.stubEnv('CHANNEL', 'demo')
    setParsedCacheKv(memoryKv().kv)
    vi.mocked(loadChannelDocument).mockResolvedValue(channelDocument() as never)
    vi.mocked(extractPost).mockResolvedValue({ ...createPost(''), type: 'service' })

    expect(await getChannelPost('1')).toBeNull()
    expect(await getChannelPost('1')).toBeNull()
    expect(loadChannelDocument).toHaveBeenCalledTimes(2)
  })
})
