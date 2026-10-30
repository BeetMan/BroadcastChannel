import type { GetChannelInfoParams } from '../../types'
import type { LoadedChannelDocument } from './types'
import * as cheerio from 'cheerio'
import { defineCachedFunction } from 'ocache'
import { $fetch } from 'ofetch'
import { PAGE_CACHE_SECONDS } from '../cache-policy'
import { getBooleanEnv, getEnv, getStaticProxy, getTelegramHost } from '../env'

interface TelegramHtmlParams {
  host: string
  channel: string
  id?: string
  before?: string
  after?: string
  q?: string
  headers: Record<string, string>
}

function getRequiredEnv(name: string): string {
  const value = getEnv(import.meta.env, name)
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

export function getTelegramRequestHeaders(): Record<string, string> {
  return {
    'accept': 'text/html,application/xhtml+xml',
    'user-agent': 'BroadcastChannel/0.2.0',
  }
}

async function fetchTelegramHtml({ host, channel, id, before, after, q, headers }: TelegramHtmlParams): Promise<string> {
  const requestUrl = id
    ? `https://${host}/${channel}/${id}?embed=1&mode=tme`
    : `https://${host}/s/${channel}`

  return await $fetch<string, 'text'>(requestUrl, {
    headers,
    query: {
      before: before || undefined,
      after: after || undefined,
      q: q || undefined,
    },
    responseType: 'text',
    timeout: 8000,
    // Retries burn CPU on the Workers free plan without producing a response.
    retry: 1,
    retryDelay: 200,
  })
}

const loadTelegramHtml = defineCachedFunction(fetchTelegramHtml, {
  name: 'telegram-html',
  maxAge: PAGE_CACHE_SECONDS,
  // A detached refresh has no Cloudflare waitUntil context and can leave a stuck pending promise.
  swr: false,
  getKey: ({ host, channel, id, before, after, q }) => JSON.stringify({
    host,
    channel,
    id: id || '',
    before: before || '',
    after: after || '',
    q: q || '',
  }),
})

/**
 * Raw Telegram HTML without a cheerio parse. Callers that only need a few
 * attributes (the sitemap) use this to stay cheap on the Workers CPU budget.
 */
export async function loadChannelHtml(
  params: GetChannelInfoParams & { id?: string } = {},
): Promise<{ html: string, channel: string }> {
  const { before, after, q, id } = params
  const channel = getRequiredEnv('CHANNEL')
  const html = await loadTelegramHtml({
    host: getTelegramHost(import.meta.env),
    channel,
    id,
    before,
    after,
    q,
    headers: getTelegramRequestHeaders(),
  })

  return { html, channel }
}

export async function loadChannelDocument(
  params: GetChannelInfoParams & { id?: string } = {},
): Promise<LoadedChannelDocument> {
  const { html, channel } = await loadChannelHtml(params)

  return {
    $: cheerio.load(html, {}, false),
    channel,
    telegramHost: getTelegramHost(import.meta.env),
    staticProxy: getStaticProxy(import.meta.env),
    reactionsEnabled: getBooleanEnv(import.meta.env, 'REACTIONS'),
  }
}
