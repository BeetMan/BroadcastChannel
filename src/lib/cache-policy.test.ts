import { describe, expect, it } from 'vitest'
import {
  getPageCacheControl,
  isCacheableHtmlPath,
  isTrackingParam,
  PAGE_CACHE_SECONDS,
  stripTrackingParams,
} from './cache-policy'

describe('cache policy', () => {
  it('uses a 15 minute page TTL with stale-while-revalidate', () => {
    expect(PAGE_CACHE_SECONDS).toBe(900)
    expect(getPageCacheControl()).toBe('public, max-age=900, s-maxage=900, stale-while-revalidate=60')
  })

  it('treats HTML pages as cacheable and skips feeds, assets, and metadata', () => {
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

  it('recognises campaign and click identifiers', () => {
    expect(isTrackingParam('utm_source')).toBe(true)
    expect(isTrackingParam('UTM_Campaign')).toBe(true)
    expect(isTrackingParam('fbclid')).toBe(true)
    expect(isTrackingParam('gclid')).toBe(true)
    expect(isTrackingParam('_rsc')).toBe(true)
    expect(isTrackingParam('q')).toBe(false)
    expect(isTrackingParam('tag')).toBe(false)
    expect(isTrackingParam('before')).toBe(false)
  })

  it('strips tracking parameters while preserving real ones', () => {
    const canonical = stripTrackingParams('https://beet.select/search?q=a%20b&tag=news&utm_source=x&fbclid=1')

    expect(canonical).not.toBeNull()
    expect(canonical?.pathname).toBe('/search')
    expect(canonical?.searchParams.get('q')).toBe('a b')
    expect(canonical?.searchParams.get('tag')).toBe('news')
    expect(canonical?.searchParams.has('utm_source')).toBe(false)
    expect(canonical?.searchParams.has('fbclid')).toBe(false)
  })

  it('returns null when the URL is already canonical', () => {
    expect(stripTrackingParams('https://beet.select/posts/42')).toBeNull()
    expect(stripTrackingParams('https://beet.select/search?q=hello')).toBeNull()
  })
})
