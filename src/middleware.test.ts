import { afterEach, describe, expect, it, vi } from 'vitest'
import { setHtmlCache, setPlatformWaitUntil } from './lib/html-cache'

vi.mock('astro:middleware', () => ({
  defineMiddleware: <T>(handler: T): T => handler,
}))

const { isHtmlResponse, onRequest, shouldApplyDefaultCache } = await import('./middleware')

setPlatformWaitUntil(null)

afterEach(() => {
  setHtmlCache(undefined)
  setPlatformWaitUntil(null)
  vi.unstubAllGlobals()
})

describe('middleware response header helpers', () => {
  it('applies default cache to successful responses without cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 200 }))).toBe(true)
  })

  it('applies default cache to redirects without cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 302 }))).toBe(true)
  })

  it('does not apply default cache to not found responses', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 404 }))).toBe(false)
  })

  it('does not apply default cache to upstream error responses', () => {
    expect(shouldApplyDefaultCache(new Response('', { status: 502 }))).toBe(false)
  })

  it('does not replace existing cache headers', () => {
    expect(shouldApplyDefaultCache(new Response('', {
      headers: {
        'Cache-Control': 'private, max-age=0',
      },
      status: 200,
    }))).toBe(false)
  })

  it('detects HTML responses with charset parameters', () => {
    expect(isHtmlResponse(new Response('', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    }))).toBe(true)
  })
})

function asResponse(response: Response | void): Response {
  if (!response)
    throw new Error('Expected a response')

  return response
}

function createContext(url: string) {
  const request = new Request(url)
  return {
    locals: {},
    params: {},
    request,
    rewrite: vi.fn(),
    url: new URL(request.url),
  }
}

function htmlNext(body = '<p>Page</p>') {
  return vi.fn(async () => new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }))
}

describe('middleware tracking parameter redirects', () => {
  it('redirects campaign-tagged pages to their canonical form', async () => {
    const next = htmlNext()
    const response = asResponse(await onRequest(
      createContext('https://beet.select/posts/42?utm_source=feed&fbclid=abc&ref=home') as never,
      next,
    ))

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('/posts/42')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps real query parameters while dropping tracking ones', async () => {
    const response = asResponse(await onRequest(
      createContext('https://beet.select/search?q=hello&utm_medium=social') as never,
      htmlNext(),
    ))

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('/search?q=hello')
  })

  it('leaves canonical pages, feeds, and assets untouched', async () => {
    const urls = [
      'https://beet.select/posts/42',
      'https://beet.select/rss.xml?utm_source=feed',
      'https://beet.select/static/a.jpg?utm_source=feed',
    ]

    for (const url of urls) {
      const next = htmlNext()
      const response = asResponse(await onRequest(createContext(url) as never, next))
      expect(response.status).toBe(200)
      expect(next).toHaveBeenCalledTimes(1)
    }
  })
})

describe('middleware default cache header', () => {
  it('applies the shared page cache policy with stale-while-revalidate', async () => {
    const response = asResponse(await onRequest(createContext('https://beet.select/') as never, htmlNext()))

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=900, s-maxage=900, stale-while-revalidate=60')
    expect(response.headers.get('X-BC-Cache')).toBe('MISS')
    expect(response.headers.get('Speculation-Rules')).toBe('"/rules/prefetch.json"')
  })

  it('keeps cache headers set by the route itself', async () => {
    const next = vi.fn(async () => new Response('<rss/>', {
      headers: {
        'cache-control': 'public, max-age=3600',
        'content-type': 'text/html; charset=utf-8',
      },
    }))
    const response = asResponse(await onRequest(createContext('https://beet.select/rss.xml') as never, next))

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(response.headers.get('X-BC-Cache')).toBeNull()
  })
})

describe('middleware HTML cache', () => {
  it('serves a second GET from the Cache API without rendering again', async () => {
    setPlatformWaitUntil(null)
    const entries = new Map<string, Response>()
    setHtmlCache({
      async match(request: Request) {
        const hit = entries.get(request.url)
        return hit ? hit.clone() : undefined
      },
      async put(request: Request, response: Response) {
        entries.set(request.url, response.clone())
      },
    })

    const request = new Request('https://beet.select/posts/42')
    const next = vi.fn(async () => new Response('<p>Post</p>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))
    const context = {
      locals: {},
      params: {},
      request,
      rewrite: vi.fn(),
      url: new URL(request.url),
    }

    const first = asResponse(await onRequest(context as never, next))
    const second = asResponse(await onRequest(context as never, next))

    expect(next).toHaveBeenCalledTimes(1)
    expect(first.headers.get('X-BC-Cache')).toBe('MISS')
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=900, s-maxage=900, stale-while-revalidate=60')
    expect(second.headers.get('X-BC-Cache')).toBe('HIT')
    expect(await second.text()).toBe('<p>Post</p>')
    expect(await first.text()).toBe('<p>Post</p>')
  })

  it('defers the cache write with the Workers execution context', async () => {
    const writes: Promise<unknown>[] = []
    const bareWaitUntil = vi.fn()
    vi.stubGlobal('waitUntil', bareWaitUntil)
    setHtmlCache({
      async match() {
        return undefined
      },
      async put() {},
    })
    const request = new Request('https://beet.select/')
    const next = vi.fn(async () => new Response('<p>Home</p>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))
    const cfContext = {
      waitUntil(promise: Promise<unknown>) {
        expect(this).toBe(cfContext)
        writes.push(promise)
      },
    }
    const response = asResponse(await onRequest({
      locals: { cfContext },
      params: {},
      request,
      rewrite: vi.fn(),
      url: new URL(request.url),
    } as never, next))

    expect(response.headers.get('X-BC-Cache')).toBe('MISS')
    expect(writes).toHaveLength(1)
    expect(bareWaitUntil).not.toHaveBeenCalled()
    await writes[0]
  })

  it('does not render a tracking URL or store it', async () => {
    const puts: string[] = []
    setHtmlCache({
      async match() {
        return undefined
      },
      async put(request: Request) {
        puts.push(request.url)
      },
    })
    const next = htmlNext()
    const response = asResponse(await onRequest(
      createContext('https://beet.select/posts/42?utm_source=feed') as never,
      next,
    ))

    expect(response.status).toBe(301)
    expect(next).not.toHaveBeenCalled()
    expect(puts).toEqual([])
    expect(response.headers.get('X-BC-Cache')).toBeNull()
  })
})
