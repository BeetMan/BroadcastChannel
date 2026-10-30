/**
 * Shared HTTP cache policy for the Workers deployment.
 *
 * The Workers free plan grants 10 ms of CPU per invocation, which a real
 * Astro + cheerio render cannot fit into. Workers Cache serves stored
 * responses before the Worker runs, so the page TTL is the main lever for
 * staying under the limit: every extra minute of freshness is one less
 * expensive render per URL.
 */
export const PAGE_CACHE_SECONDS = 900

const PAGE_CACHE_CONTROL = `public, max-age=${PAGE_CACHE_SECONDS}, s-maxage=${PAGE_CACHE_SECONDS}, stale-while-revalidate=60`

const TRACKING_PARAM_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', 'vero_']

const TRACKING_PARAMS = new Set([
  '_rsc',
  'dclid',
  'fbclid',
  'gbraid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ref',
  'ref_src',
  'ref_url',
  'share_source',
  'si',
  'source',
  'spm',
  'twclid',
  'wbraid',
  'yclid',
])

const HOUR_SECONDS = 3600
const DAY_SECONDS = 24 * HOUR_SECONDS

/** Sitemap pages whose newest post is older than this are treated as settled. */
export const SITEMAP_SETTLED_AFTER_MS = 7 * DAY_SECONDS * 1000

const SITEMAP_FRESH_CACHE_CONTROL = `public, max-age=${HOUR_SECONDS}, s-maxage=${HOUR_SECONDS}, stale-while-revalidate=${DAY_SECONDS}`
const SITEMAP_SETTLED_CACHE_CONTROL = `public, max-age=${DAY_SECONDS}, s-maxage=${30 * DAY_SECONDS}, stale-while-revalidate=${7 * DAY_SECONDS}`

export function getPageCacheControl(): string {
  return PAGE_CACHE_CONTROL
}

/**
 * Crawlers fetch hundreds of `/sitemap/<cursor>.xml` pages, so settled ones
 * must stay cached. A page is settled when its newest post is older than
 * `SITEMAP_SETTLED_AFTER_MS`. An empty page may be a bucket ahead of the
 * latest post that fills later, so it stays fresh.
 */
export function getSitemapCacheControl(newestPostDatetime: string | undefined, now = Date.now()): string {
  const time = newestPostDatetime ? Date.parse(newestPostDatetime) : Number.NaN
  if (Number.isNaN(time) || now - time < SITEMAP_SETTLED_AFTER_MS)
    return SITEMAP_FRESH_CACHE_CONTROL

  return SITEMAP_SETTLED_CACHE_CONTROL
}

/** Sitemap index and webmanifest: cheap to keep, rarely changes. */
export function getMetadataCacheControl(): string {
  return SITEMAP_FRESH_CACHE_CONTROL
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

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase()
  return TRACKING_PARAMS.has(key) || TRACKING_PARAM_PREFIXES.some(prefix => key.startsWith(prefix))
}

/**
 * Returns the canonical URL with tracking parameters removed, or null when the
 * URL is already canonical.
 *
 * Crawlers and share links append campaign parameters (`?utm_source=`,
 * `?fbclid=`, ...). Workers Cache keys on the full URL, so every variant is a
 * guaranteed cache miss and therefore a full render — the exact path that
 * exceeds the free plan CPU budget.
 */
export function stripTrackingParams(input: string | URL): URL | null {
  const url = new URL(input)
  let changed = false

  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) {
      url.searchParams.delete(name)
      changed = true
    }
  }

  return changed ? url : null
}
