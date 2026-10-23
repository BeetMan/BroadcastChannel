import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  matchCachedHtml,
  scheduleCachePut,
  setHtmlCache,
  setPlatformWaitUntil,
  storeCachedHtml,
  withHtmlCacheStatus,
} from './html-cache'

function memoryCache() {
  const entries = new Map<string, Response>()
  return {
    entries,
    cache: {
      async match(request: Request) {
        const hit = entries.get(request.url)
        return hit ? hit.clone() : undefined
      },
      async put(request: Request, response: Response) {
        entries.set(request.url, response.clone())
      },
    },
  }
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=60',
      ...headers,
    },
  })
}

describe('html response cache', () => {
  afterEach(() => {
    setHtmlCache(undefined)
    setPlatformWaitUntil(undefined)
    vi.unstubAllGlobals()
  })

  it('stores a 200 HTML response without stale-while-revalidate and reads it back as a hit', async () => {
    const { entries, cache } = memoryCache()
    setHtmlCache(cache)
    const request = new Request('https://beet.select/posts/42')
    const response = htmlResponse('<p>Post</p>')

    expect(await matchCachedHtml(request, '/posts/42')).toBeNull()
    await storeCachedHtml(request, '/posts/42', response)

    const stored = entries.get(request.url)
    expect(stored?.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=900')
    expect(response.headers.get('cache-control')).toContain('stale-while-revalidate=60')

    const hit = await matchCachedHtml(request, '/posts/42')
    expect(hit).not.toBeNull()
    const marked = withHtmlCacheStatus(hit as Response, 'HIT')
    expect(marked.headers.get('X-BC-Cache')).toBe('HIT')
    expect(await marked.text()).toBe('<p>Post</p>')
    expect(await response.text()).toBe('<p>Post</p>')
  })

  it('does not store errors, private responses, non-html, or no-cache reloads', async () => {
    const { entries, cache } = memoryCache()
    setHtmlCache(cache)
    const request = new Request('https://beet.select/')

    await storeCachedHtml(request, '/', htmlResponse('missing', 404))
    await storeCachedHtml(request, '/', htmlResponse('<p>private</p>', 200, {
      'cache-control': 'private, no-store',
    }))
    await storeCachedHtml(request, '/', htmlResponse('<p>cookie</p>', 200, {
      'set-cookie': 'session=1',
    }))
    await storeCachedHtml(request, '/', new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    await storeCachedHtml(request, '/rss.xml', htmlResponse('<rss>'))
    expect(entries.size).toBe(0)

    await storeCachedHtml(request, '/', htmlResponse('<p>Home</p>'))
    const reload = new Request('https://beet.select/', {
      headers: { 'cache-control': 'no-cache' },
    })
    expect(await matchCachedHtml(reload, '/')).toBeNull()
  })

  it('registers the put on the bound Cloudflare execution context', async () => {
    const writes: Promise<unknown>[] = []
    const bareWaitUntil = vi.fn()
    vi.stubGlobal('waitUntil', bareWaitUntil)
    const platformWaitUntil = vi.fn()
    setPlatformWaitUntil(platformWaitUntil)

    const cfContext = {
      waitUntil(promise: Promise<unknown>) {
        expect(this).toBe(cfContext)
        writes.push(promise)
      },
    }
    let release: () => void = () => {}
    const task = new Promise<void>((resolve) => {
      release = resolve
    })

    const scheduled = scheduleCachePut({ cfContext }, task)
    await scheduled

    expect(writes).toEqual([task])
    expect(bareWaitUntil).not.toHaveBeenCalled()
    expect(platformWaitUntil).not.toHaveBeenCalled()
    release()
    await task
  })

  it('uses the platform waitUntil when the execution context is missing', async () => {
    const writes: Promise<unknown>[] = []
    const bareWaitUntil = vi.fn()
    vi.stubGlobal('waitUntil', bareWaitUntil)
    setPlatformWaitUntil((promise) => {
      writes.push(promise)
    })

    const task = Promise.resolve('stored')
    await scheduleCachePut({}, task)

    expect(writes).toEqual([task])
    expect(bareWaitUntil).not.toHaveBeenCalled()
  })

  it('awaits the put when no Workers waitUntil exists', async () => {
    setPlatformWaitUntil(null)
    let release: () => void = () => {}
    const task = new Promise<void>((resolve) => {
      release = resolve
    })
    let settled = false
    const scheduled = scheduleCachePut({}, task).then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await scheduled
    expect(settled).toBe(true)
  })
})
