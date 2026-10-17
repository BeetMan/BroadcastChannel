import type { CheerioAPI } from 'cheerio'
import type { IndexedStaticProxyOptions, MessageSelection, StaticProxyOptions } from './types'
import { getCustomEmojiImage } from './emoji'
import { normalizeUrlAttribute, normalizeUrlAttributes, proxyStyleUrls } from './url'

interface ModifyHTMLContentOptions extends IndexedStaticProxyOptions {
  telegramHost?: string
  normalizeUrls?: boolean
}

interface HydrateTgEmojiOptions extends StaticProxyOptions {
  telegramHost?: string
}

const LANGUAGE_CLASS_REGEX = /(?:^|\s)language-([\w+-]+)/

async function hydrateTgEmoji($: CheerioAPI, content: MessageSelection, options: HydrateTgEmojiOptions = {}): Promise<void> {
  const { telegramHost, staticProxy = '' } = options

  for (const emojiNode of content.find('tg-emoji').toArray()) {
    const emojiId = $(emojiNode).attr('emoji-id')
    const imageUrl = getCustomEmojiImage(emojiId, { telegramHost, staticProxy })

    if (imageUrl) {
      $(emojiNode).replaceWith(`<img class="tg-emoji" src="${imageUrl}" alt="" loading="lazy" width="20" height="20" />`)
    }
  }
}

function languageFromClass(className: string | undefined): string | undefined {
  return className?.match(LANGUAGE_CLASS_REGEX)?.[1]
}

/**
 * Keep `<pre>` readable without flourite or Prism. Those ran once per code
 * block inside `extractPost` and were the heaviest part of a cache miss.
 * Text is escaped; a `language-*` class is copied only when the source
 * markup already declared one.
 */
function wrapPreAsPlainCode($: CheerioAPI, content: MessageSelection): void {
  for (const preNode of content.find('pre').toArray()) {
    const pre = $(preNode)
    pre.addClass('code')
    pre.find('br').replaceWith('\n')

    const existing = pre.find('code').first()
    const language = languageFromClass(existing.attr('class'))
      || languageFromClass(pre.attr('class'))
      || 'text'
    const code = pre.text()
    const codeEl = $(`<code class="language-${language}"></code>`)
    codeEl.text(code)
    pre.empty().append(codeEl)
  }
}

export async function modifyHTMLContent($: CheerioAPI, content: MessageSelection, options: ModifyHTMLContentOptions = {}): Promise<MessageSelection> {
  const { index = 0, telegramHost, staticProxy = '', normalizeUrls = true } = options

  await hydrateTgEmoji($, content, { telegramHost, staticProxy })
  if (normalizeUrls) {
    normalizeUrlAttributes($, content)
  }
  proxyStyleUrls($, content, staticProxy)
  content.find('.emoji').removeAttr('style')

  for (const linkNode of content.find('a').toArray()) {
    const link = $(linkNode)
    const href = link.attr('href')

    if (href && normalizeUrls) {
      link.attr('href', normalizeUrlAttribute(href))
    }

    link.attr('title', link.text()).removeAttr('onclick')
  }

  for (const [blockquoteIndex, blockquoteNode] of content.find('blockquote[expandable]').toArray().entries()) {
    const innerHTML = $(blockquoteNode).html() ?? ''
    const expandId = `expand-${index}-${blockquoteIndex}`
    const expandContentId = `${expandId}-content`
    const expandable = `<div class="tg-expandable">
      <input type="checkbox" id="${expandId}" class="tg-expandable__checkbox" aria-label="Toggle hidden content" aria-controls="${expandContentId}">
      <div id="${expandContentId}" class="tg-expandable__content">${innerHTML}</div>
      <label for="${expandId}" class="tg-expandable__toggle"><span class="sr-only">Toggle hidden content</span></label>
    </div>`

    $(blockquoteNode).replaceWith(expandable)
  }

  for (const [spoilerIndex, spoilerNode] of content.find('tg-spoiler').toArray().entries()) {
    const spoiler = $(spoilerNode)
    const spoilerId = `spoiler-${index}-${spoilerIndex}`
    const spoilerInput = `<input type="checkbox" aria-label="Toggle spoiler" aria-controls="${spoilerId}" />`

    spoiler.attr('id', spoilerId).wrap('<label class="spoiler-button"></label>').before(spoilerInput)
  }

  wrapPreAsPlainCode($, content)

  return content
}
