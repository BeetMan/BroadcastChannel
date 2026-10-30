import { describe, expect, it } from 'vitest'
import { getSitemapCursors, parseSitemapCursor, parseSitemapEntries } from './sitemap'

function message(post: string, datetime: string, extraClass = 'js-widget_message'): string {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message ${extraClass}" data-post="${post}" data-view="x">
  <div class="tgme_widget_message_reply"><time datetime="2000-01-01T00:00:00+00:00"></time></div>
  <div class="tgme_widget_message_info"><a class="tgme_widget_message_date" href="https://t.me/${post}"><time datetime="${datetime}" class="time">12:00</time></a></div>
</div></div>`
}

describe('sitemap entries', () => {
  it('reads post ids and message dates, newest first', () => {
    const html = `<section class="tgme_channel_history">${[
      message('BeetMan/41', '2026-10-01T08:00:00+00:00'),
      message('BeetMan/42', '2026-10-02T08:00:00+00:00'),
    ].join('')}</section>`

    expect(parseSitemapEntries(html, 'BeetMan')).toEqual([
      { id: 42, datetime: '2026-10-02T08:00:00+00:00' },
      { id: 41, datetime: '2026-10-01T08:00:00+00:00' },
    ])
  })

  it('skips service messages, other channels, and posts without a date', () => {
    const html = [
      message('beetman/10', '2026-10-01T08:00:00+00:00', 'service_message js-widget_message'),
      message('OtherChannel/11', '2026-10-01T08:00:00+00:00'),
      '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="beetman/12"></div></div>',
      message('beetman/13', '2026-10-01T08:00:00+00:00'),
    ].join('')

    expect(parseSitemapEntries(html, 'BeetMan').map(entry => entry.id)).toEqual([13])
  })
})

describe('sitemap cursors', () => {
  it('uses page-aligned cursors that include the latest post', () => {
    expect(getSitemapCursors(45, 20)).toEqual([60, 40, 20])
    expect(getSitemapCursors(40, 20)).toEqual([60, 40, 20])
    expect(getSitemapCursors(19101).slice(0, 2)).toEqual([19120, 19100])
    expect(getSitemapCursors(19101).at(-1)).toBe(20)
  })

  it('keeps cursors stable while new posts stay in the newest bucket', () => {
    expect(getSitemapCursors(19105)).toEqual(getSitemapCursors(19101))
  })

  it('returns no cursors without a valid latest id', () => {
    expect(getSitemapCursors(0)).toEqual([])
    expect(getSitemapCursors(Number.NaN)).toEqual([])
  })

  it('accepts only positive integer cursors', () => {
    expect(parseSitemapCursor('19100')).toBe(19100)
    expect(parseSitemapCursor('19101')).toBe(19101)
    expect(parseSitemapCursor('0')).toBeNull()
    expect(parseSitemapCursor('-1')).toBeNull()
    expect(parseSitemapCursor('12abc')).toBeNull()
    expect(parseSitemapCursor(undefined)).toBeNull()
  })
})
