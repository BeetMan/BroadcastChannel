import type { APIRoute } from 'astro'
import { getSitemapCacheControl } from '../../lib/cache-policy'
import { getSitemapUrl, resolveSiteUrl } from '../../lib/seo'
import { getSitemapPageEntries, parseSitemapCursor } from '../../lib/telegram/sitemap'

export const GET: APIRoute = async (Astro) => {
  const cursor = parseSitemapCursor(Astro.params.cursor)
  if (!cursor)
    return new Response('Not found', { status: 404 })

  const siteUrl = resolveSiteUrl(Astro.locals.SITE_URL, Astro.url.origin)
  const entries = await getSitemapPageEntries(cursor)

  const xmlUrls = entries.map(entry => `
    <url>
      <loc>${getSitemapUrl(siteUrl, `posts/${entry.id}`)}</loc>
      <lastmod>${new Date(entry.datetime).toISOString()}</lastmod>
    </url>
  `).join('')

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${xmlUrls}
</urlset>`, {
    headers: {
      'Cache-Control': getSitemapCacheControl(entries[0]?.datetime),
      'Content-Type': 'application/xml',
    },
  })
}
