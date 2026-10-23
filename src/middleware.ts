import { defineMiddleware } from 'astro:middleware'
import { getPageCacheControl, isCacheableHtmlPath, stripTrackingParams } from './lib/cache-policy'
import { matchCachedHtml, scheduleCachePut, shouldStoreHtml, storeCachedHtml, withHtmlCacheStatus } from './lib/html-cache'

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

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.SITE_URL = `${import.meta.env.SITE ?? ''}${import.meta.env.BASE_URL}`
  context.locals.RSS_URL = `${context.locals.SITE_URL}rss.xml`
  context.locals.RSS_PREFIX = ''

  // Send campaign-tagged URLs to their canonical form so cache keys stay bounded.
  if ((context.request.method === 'GET' || context.request.method === 'HEAD')
    && isCacheableHtmlPath(context.url.pathname)) {
    const canonical = stripTrackingParams(context.url)
    if (canonical) {
      return new Response(null, {
        status: 301,
        headers: {
          'Location': `${canonical.pathname}${canonical.search}`,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }

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
      response.headers.set('Cache-Control', getPageCacheControl())
    }

    if (shouldStoreHtml(context.request, context.url.pathname, response)) {
      response.headers.set('X-BC-Cache', 'MISS')
      const put = storeCachedHtml(context.request, context.url.pathname, response)
      await scheduleCachePut(context.locals, put)
    }
  }

  return response
})
