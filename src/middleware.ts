import { defineMiddleware } from 'astro:middleware'
import { isCacheableHtmlPath, matchCachedHtml, storeCachedHtml, withHtmlCacheStatus } from './lib/html-cache'

function getEncodedTagSearchQuery(pathname: string): string {
  if (!pathname.startsWith('/search/%23')) {
    return ''
  }

  try {
    return decodeURIComponent(pathname.slice('/search/'.length))
  }
  catch {
    return ''
  }
}

export function isHtmlResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('text/html') ?? false
}

export function shouldApplyDefaultCache(response: Response): boolean {
  return response.status >= 200 && response.status < 400 && !response.headers.has('Cache-Control')
}

function getWaitUntil(locals: App.Locals): ((promise: Promise<unknown>) => void) | undefined {
  const cfContext = (locals as { cfContext?: { waitUntil?: (promise: Promise<unknown>) => void } }).cfContext
  if (!cfContext || typeof cfContext.waitUntil !== 'function')
    return undefined

  return cfContext.waitUntil.bind(cfContext)
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.SITE_URL = `${import.meta.env.SITE ?? ''}${import.meta.env.BASE_URL}`
  context.locals.RSS_URL = `${context.locals.SITE_URL}rss.xml`
  context.locals.RSS_PREFIX = ''

  const querySearch = context.url.searchParams.get('q') || ''
  const legacyTagSearch = getEncodedTagSearchQuery(context.url.pathname)
  const pathSearch = context.params.q || ''
  const searchQuery = querySearch || legacyTagSearch || pathSearch

  if (context.url.pathname.startsWith('/search') && searchQuery.startsWith('#')) {
    const tag = searchQuery.replace('#', '')
    context.locals.RSS_URL = `${context.locals.SITE_URL}rss.xml?tag=${encodeURIComponent(tag)}`
    context.locals.RSS_PREFIX = `${tag} | `
  }

  if (isCacheableHtmlPath(context.url.pathname)) {
    const cached = await matchCachedHtml(context.request, context.url.pathname)
    if (cached)
      return withHtmlCacheStatus(cached, 'HIT')
  }

  const response = legacyTagSearch
    ? await context.rewrite(`/search/result?q=${encodeURIComponent(legacyTagSearch)}`)
    : await next()

  if (!response.bodyUsed) {
    if (isHtmlResponse(response)) {
      response.headers.set('Speculation-Rules', '"/rules/prefetch.json"')
    }

    if (shouldApplyDefaultCache(response)) {
      response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300')
    }

    if (isCacheableHtmlPath(context.url.pathname) && isHtmlResponse(response) && response.status === 200) {
      response.headers.set('X-BC-Cache', 'MISS')
      const put = storeCachedHtml(context.request, context.url.pathname, response)
      // `locals.runtime.ctx` throws on Astro 6+. `cfContext` is the Workers ExecutionContext.
      const waitUntil = getWaitUntil(context.locals)
      if (waitUntil)
        waitUntil(put)
      else
        await put
    }
  }
  return response
})
