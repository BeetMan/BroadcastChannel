import { afterEach, describe, expect, it, vi } from 'vitest'
import { setHtmlCache } from './lib/html-cache'

vi.mock('astro:middleware', () => ({
  defineMiddleware: <T>(handler: T): T => handler,
}))

const { isHtmlResponse, onRequest, shouldApplyDefaultCache } = await import('./middleware')

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

describe('middleware HTML cache', () => {
  afterEach(() => {
    setHtmlCache(undefined)
  })

  it('serves a second GET from the Cache API without rendering again', async () => {
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
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=300')
    expect(second.headers.get('X-BC-Cache')).toBe('HIT')
    expect(await second.text()).toBe('<p>Post</p>')
    expect(await first.text()).toBe('<p>Post</p>')
  })

  it('defers the cache write with the Workers execution context', async () => {
    const writes: Promise<unknown>[] = []
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
    const response = asResponse(await onRequest({
      locals: {
        cfContext: {
          waitUntil(promise: Promise<unknown>) {
            writes.push(promise)
          },
        },
      },
      params: {},
      request,
      rewrite: vi.fn(),
      url: new URL(request.url),
    } as never, next))

    expect(response.headers.get('X-BC-Cache')).toBe('MISS')
    expect(writes).toHaveLength(1)
    await writes[0]
  })
})
