import { isCacheableHtmlPath } from './cache-policy'

/**
 * Cache API for full HTML responses (`X-BC-Cache`).
 *
 * Workers Cache (`cache.enabled`) can serve a stored response before the Worker
 * runs. This path covers requests that still reach the Worker: a hit returns
 * the stored page before Astro renders. `caches.default` is per colo and is
 * independent of Workers Cache.
 *
 * Puts must be registered with the request's execution context. A bare
 * `waitUntil(...)` is not that context. `locals.cfContext` is the Worker
 * `ExecutionContext`; `cloudflare:workers` `waitUntil` is the platform
 * fallback. Both keep the put alive after the response is returned.
 */
const HTML_CACHE_HEADER = 'X-BC-Cache'

export interface HtmlCache {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

export interface CacheWriteLocals {
  cfContext?: {
    waitUntil?: (promise: Promise<unknown>) => void
  }
}

type WaitUntil = (promise: Promise<unknown>) => void

interface WorkersModule {
  waitUntil?: WaitUntil
}

let cacheOverride: HtmlCache | null | undefined
let platformWaitUntilOverride: WaitUntil | null | undefined
let platformWaitUntil: WaitUntil | null | undefined

/** Test and local override. `undefined` uses `caches.default`. */
export function setHtmlCache(cache: HtmlCache | null | undefined): void {
  cacheOverride = cache
}

/**
 * Test override for the platform `waitUntil`.
 * `undefined` loads `cloudflare:workers`. `null` skips it and awaits the put.
 */
export function setPlatformWaitUntil(waitUntil: WaitUntil | null | undefined): void {
  platformWaitUntilOverride = waitUntil
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

/**
 * Cache API `put`/`match` do not support `stale-while-revalidate` or
 * `stale-if-error`. Drop those directives on the stored copy. The response
 * returned to the client keeps the full `Cache-Control` for Workers Cache.
 */
function cacheApiResponse(response: Response): Response {
  const headers = new Headers(response.headers)
  const cacheControl = headers.get('cache-control')
  if (cacheControl) {
    const directives = cacheControl
      .split(',')
      .map(part => part.trim())
      .filter(part => part && !/^stale-(?:while-revalidate|if-error)\b/i.test(part))

    if (directives.length > 0)
      headers.set('cache-control', directives.join(', '))
    else
      headers.delete('cache-control')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function shouldStoreHtml(request: Request, pathname: string, response: Response): boolean {
  return request.method === 'GET'
    && response.status === 200
    && isCacheableHtmlPath(pathname)
    && isHtmlResponse(response)
    && allowsSharedCache(response)
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
  if (!shouldStoreHtml(request, pathname, response))
    return

  const cache = resolveCache()
  if (!cache)
    return

  try {
    await cache.put(cacheKeyRequest(request), cacheApiResponse(response.clone()))
  }
  catch {
    // A cache write must not fail the page.
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

function contextWaitUntil(locals: CacheWriteLocals): WaitUntil | undefined {
  const cfContext = locals.cfContext
  if (!cfContext || typeof cfContext.waitUntil !== 'function')
    return undefined

  // Keep the execution-context receiver. An unbound call throws or drops the task.
  return cfContext.waitUntil.bind(cfContext)
}

async function loadPlatformWaitUntil(): Promise<WaitUntil | null> {
  if (platformWaitUntil !== undefined)
    return platformWaitUntil

  try {
    const specifier = 'cloudflare:workers'
    const mod = await import(/* @vite-ignore */ specifier) as WorkersModule
    platformWaitUntil = typeof mod.waitUntil === 'function' ? mod.waitUntil : null
  }
  catch {
    platformWaitUntil = null
  }

  return platformWaitUntil
}

/**
 * Register a Cache API put with the Cloudflare execution context.
 * Awaits only when neither `locals.cfContext.waitUntil` nor the platform
 * `waitUntil` is available, which is the Node, test, and non-Workers case.
 */
export async function scheduleCachePut(locals: CacheWriteLocals, task: Promise<unknown>): Promise<void> {
  const fromContext = contextWaitUntil(locals)
  if (fromContext) {
    try {
      fromContext(task)
    }
    catch {
      await task
    }
    return
  }

  const fromPlatform = platformWaitUntilOverride !== undefined
    ? platformWaitUntilOverride
    : await loadPlatformWaitUntil()

  if (fromPlatform) {
    try {
      fromPlatform(task)
    }
    catch {
      await task
    }
    return
  }

  await task
}
