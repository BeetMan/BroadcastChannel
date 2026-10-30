import { loadChannelHtml } from './request'

/**
 * Sitemap entries straight from Telegram HTML, without cheerio or `extractPost`.
 *
 * Search crawlers walk every `/sitemap/<cursor>.xml` page, and a full post parse
 * per page cost 100-350 ms of Workers CPU. A sitemap only needs each post's id
 * and date, so a string scan over the message wrappers is enough.
 */
export const SITEMAP_PAGE_SIZE = 20

export interface SitemapEntry {
  id: number
  datetime: string
}

const MESSAGE_WRAP = '<div class="tgme_widget_message_wrap'
const MESSAGE_ATTRS = /<div class="(tgme_widget_message\b[^"]*)"[^>]*\sdata-post="([^"]+)"/
const MESSAGE_DATE = /class="tgme_widget_message_date"[^>]*>\s*<time\s[^>]*?datetime="([^"]+)"/

export function parseSitemapEntries(html: string, channel: string): SitemapEntry[] {
  const prefix = `${channel.toLowerCase()}/`
  const entries: SitemapEntry[] = []

  for (const chunk of html.split(MESSAGE_WRAP).slice(1)) {
    const message = MESSAGE_ATTRS.exec(chunk)
    if (!message || message[1].includes('service_message'))
      continue

    const post = message[2]
    if (!post.toLowerCase().startsWith(prefix))
      continue

    const id = Number(post.slice(prefix.length))
    const datetime = MESSAGE_DATE.exec(chunk)?.[1]
    if (!Number.isInteger(id) || id <= 0 || !datetime)
      continue

    entries.push({ id, datetime })
  }

  return entries.sort((a, b) => b.id - a.id)
}

/**
 * Cursors are aligned to the page size so sitemap URLs stay the same when new
 * posts arrive; only the newest bucket changes. The first cursor is above the
 * latest id so the latest post is listed too.
 */
export function getSitemapCursors(latestId: number, pageSize = SITEMAP_PAGE_SIZE): number[] {
  if (!Number.isInteger(latestId) || latestId <= 0)
    return []

  const cursors: number[] = []
  for (let cursor = (Math.floor(latestId / pageSize) + 1) * pageSize; cursor > 0; cursor -= pageSize)
    cursors.push(cursor)

  return cursors
}

export function parseSitemapCursor(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw))
    return null

  const cursor = Number(raw)
  return Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null
}

export async function getLatestSitemapEntries(): Promise<SitemapEntry[]> {
  const { html, channel } = await loadChannelHtml()
  return parseSitemapEntries(html, channel)
}

/**
 * Posts in `[cursor - pageSize, cursor)`. Telegram's `before` page reaches
 * further back when posts were deleted; those belong to the next bucket.
 */
export async function getSitemapPageEntries(cursor: number, pageSize = SITEMAP_PAGE_SIZE): Promise<SitemapEntry[]> {
  const { html, channel } = await loadChannelHtml({ before: String(cursor) })
  return parseSitemapEntries(html, channel)
    .filter(entry => entry.id < cursor && entry.id >= cursor - pageSize)
}
