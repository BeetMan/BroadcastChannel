/**
 * Cache API for full HTML responses.
 *
 * Workers do not cache HTML at the edge from Cache-Control alone, so the
 * existing `s-maxage=300` header still runs SSR on every request. A hit here
 * returns the stored page before Astro renders. The cache is per colo;
 * parsed JSON in SESSION KV covers misses in other colos.
 *
 * Use the global `caches` object. Astro 6+ removed `locals.runtime.caches`.
 */
const HTML_CACHE_HEADER = 'X-BC-Cache'

export interface HtmlCache {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

let cacheOverride: HtmlCache | null | undefined

/** Test and local override. `undefined` uses `caches.default`. */
export function setHtmlCache(cache: HtmlCache | null | undefined): void {
  cacheOverride = cache
}

export function isCacheableHtmlPath(pathname: string): boolean {
  if (pathname.startsWith('/_') || pathname.startsWith('/static') || pathname.startsWith('/rules/'))
    return false

  if (pathname === '/rss.xml' || pathname === '/rss.json' || pathname === '/site.webmanifest')
    return false

  if (pathname === '/sitemap.xml' || pathname.startsWith('/sitemap/'))
    return false

  const leaf = pathname.split('/').pop() ?? ''
  return !leaf.includes('.')
}

function resolveCache(): HtmlCache | null {
  if (cacheOverride !== undefined)
    return cacheOverride

  try {
    const storage = (globalThis as { caches?: { default?: HtmlCache } }).caches
    return storage?.default ?? null
  }
  catch {
    return null
  }
}

function cacheKeyRequest(request: Request): Request {
  return new Request(request.url, { method: 'GET' })
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('text/html') ?? false
}

function allowsSharedCache(response: Response): boolean {
  if (response.headers.has('set-cookie'))
    return false

  const cacheControl = response.headers.get('cache-control') ?? ''
  return !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(cacheControl)
}

export async function matchCachedHtml(request: Request, pathname: string): Promise<Response | null> {
  if (request.method !== 'GET' || !isCacheableHtmlPath(pathname))
    return null

  if (request.headers.get('cache-control')?.includes('no-cache'))
    return null

  const cache = resolveCache()
  if (!cache)
    return null

  try {
    return (await cache.match(cacheKeyRequest(request))) ?? null
  }
  catch {
    return null
  }
}

export async function storeCachedHtml(request: Request, pathname: string, response: Response): Promise<void> {
  if (request.method !== 'GET' || response.status !== 200 || !isCacheableHtmlPath(pathname))
    return

  if (!isHtmlResponse(response) || !allowsSharedCache(response))
    return

  const cache = resolveCache()
  if (!cache)
    return

  try {
    await cache.put(cacheKeyRequest(request), response.clone())
  }
  catch {
    // Cache API unavailable, or the runtime rejected the response.
  }
}

export function withHtmlCacheStatus(response: Response, status: 'HIT' | 'MISS'): Response {
  const headers = new Headers(response.headers)
  headers.set(HTML_CACHE_HEADER, status)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
