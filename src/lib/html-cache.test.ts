import { afterEach, describe, expect, it } from 'vitest'
import {
  isCacheableHtmlPath,
  matchCachedHtml,
  setHtmlCache,
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
      'cache-control': 'public, max-age=300, s-maxage=300',
      ...headers,
    },
  })
}

describe('html response cache', () => {
  afterEach(() => {
    setHtmlCache(undefined)
  })

  it('caches public HTML pages and skips feeds, assets, and metadata', () => {
    expect(isCacheableHtmlPath('/')).toBe(true)
    expect(isCacheableHtmlPath('/posts/42')).toBe(true)
    expect(isCacheableHtmlPath('/before/10')).toBe(true)
    expect(isCacheableHtmlPath('/search/result')).toBe(true)
    expect(isCacheableHtmlPath('/rss.xml')).toBe(false)
    expect(isCacheableHtmlPath('/rss.json')).toBe(false)
    expect(isCacheableHtmlPath('/sitemap.xml')).toBe(false)
    expect(isCacheableHtmlPath('/sitemap/10.xml')).toBe(false)
    expect(isCacheableHtmlPath('/static/a.jpg')).toBe(false)
    expect(isCacheableHtmlPath('/rules/prefetch.json')).toBe(false)
    expect(isCacheableHtmlPath('/site.webmanifest')).toBe(false)
  })

  it('stores a 200 HTML response and reads it back as a hit', async () => {
    const { cache } = memoryCache()
    setHtmlCache(cache)
    const request = new Request('https://beet.select/posts/42')
    const response = htmlResponse('<p>Post</p>')

    expect(await matchCachedHtml(request, '/posts/42')).toBeNull()
    await storeCachedHtml(request, '/posts/42', response)

    const hit = await matchCachedHtml(request, '/posts/42')
    expect(hit).not.toBeNull()
    const marked = withHtmlCacheStatus(hit as Response, 'HIT')
    expect(marked.headers.get('X-BC-Cache')).toBe('HIT')
    expect(await marked.text()).toBe('<p>Post</p>')
  })

  it('does not store errors, private responses, non-html, or no-cache reloads', async () => {
    const { entries, cache } = memoryCache()
    setHtmlCache(cache)
    const request = new Request('https://beet.select/')

    await storeCachedHtml(request, '/', htmlResponse('missing', 404))
    await storeCachedHtml(request, '/', htmlResponse('<p>private</p>', 200, {
      'cache-control': 'private, no-store',
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
})
