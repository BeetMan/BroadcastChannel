import type { APIRoute } from 'astro'
import { getMetadataCacheControl } from '../lib/cache-policy'
import { getSitemapUrl, resolveSiteUrl } from '../lib/seo'
import { getLatestSitemapEntries, getSitemapCursors } from '../lib/telegram/sitemap'

export const GET: APIRoute = async (Astro) => {
  const siteUrl = resolveSiteUrl(Astro.locals.SITE_URL, Astro.url.origin)
  const entries = await getLatestSitemapEntries()

  const sitemaps = getSitemapCursors(entries[0]?.id ?? 0).map((cursor) => {
    return `
<sitemap>
  <loc>${getSitemapUrl(siteUrl, `sitemap/${cursor}.xml`)}</loc>
</sitemap>`
  })

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemaps.join('')}
</sitemapindex>`, {
    headers: {
      'Cache-Control': getMetadataCacheControl(),
      'Content-Type': 'application/xml',
    },
  })
}
