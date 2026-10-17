import type { ChannelInfo, GetChannelInfoParams, Post } from '../../types'
import { getBooleanEnv, getEnv, getStaticProxy, getTelegramHost } from '../env'
import { modifyHTMLContent } from './content'
import { extractPost } from './parse'
import {
  channelInfoCacheKey,
  channelPostCacheKey,
  isCachedChannelInfo,
  readParsedJson,
  writeParsedJson,
} from './parsed-cache'
import { loadChannelDocument } from './request'
import { normalizeUrlAttribute } from './url'

export function isRenderablePost(post: Post | null | undefined): post is Post {
  return Boolean(post?.id && post.type === 'text' && post.content)
}

interface ParsedCacheIdentity {
  channel: string
  telegramHost: string
  staticProxy: string
  reactions: boolean
}

const inflightChannelInfo = new Map<string, Promise<ChannelInfo>>()
const inflightChannelPost = new Map<string, Promise<Post | null>>()

function requiredChannel(): string {
  const channel = getEnv(import.meta.env, 'CHANNEL')
  if (!channel)
    throw new Error('Missing required env: CHANNEL')

  return channel
}

function parsedCacheIdentity(channel: string): ParsedCacheIdentity {
  return {
    channel,
    telegramHost: getTelegramHost(import.meta.env),
    staticProxy: getStaticProxy(import.meta.env),
    reactions: getBooleanEnv(import.meta.env, 'REACTIONS') === true,
  }
}

async function loadChannelInfo(params: GetChannelInfoParams, cacheKey: string): Promise<ChannelInfo> {
  const { before = '', after = '', q = '' } = params
  const { $, channel, telegramHost, staticProxy, reactionsEnabled } = await loadChannelDocument({ before, after, q })
  const postNodes = $('.tgme_channel_history .tgme_widget_message_wrap').toArray()
  const avatar = $('.tgme_page_photo_image img').attr('src')
  const posts = (await Promise.all(
    postNodes.map((item, index) => extractPost($, item, { channel, telegramHost, staticProxy, index, reactionsEnabled })),
  ))
    .reverse()
    .filter(isRenderablePost)

  const channelInfo: ChannelInfo = {
    posts,
    title: $('.tgme_channel_info_header_title').text(),
    description: $('.tgme_channel_info_description').text(),
    descriptionHTML: (await modifyHTMLContent($, $('.tgme_channel_info_description'), { telegramHost, staticProxy })).html(),
    avatar: avatar ? normalizeUrlAttribute(avatar) : avatar,
  }

  await writeParsedJson(cacheKey, channelInfo)
  return channelInfo
}

export async function getChannelPost(id: string): Promise<Post | null> {
  const identity = parsedCacheIdentity(requiredChannel())
  const cacheKey = channelPostCacheKey({ ...identity, id })
  const cached = await readParsedJson<Post>(cacheKey)
  if (isRenderablePost(cached))
    return cached

  const pending = inflightChannelPost.get(cacheKey)
  if (pending)
    return pending

  const promise = loadChannelDocument({ id })
    .then(async ({ $, channel, telegramHost, staticProxy, reactionsEnabled }) => {
      const post = await extractPost($, null, { channel, telegramHost, staticProxy, reactionsEnabled })
      const result = isRenderablePost(post) ? post : null
      if (result)
        await writeParsedJson(cacheKey, result)

      return result
    })
    .finally(() => {
      inflightChannelPost.delete(cacheKey)
    })

  inflightChannelPost.set(cacheKey, promise)
  return promise
}

export async function getChannelInfo(params: GetChannelInfoParams = {}): Promise<ChannelInfo> {
  const { before = '', after = '', q = '' } = params
  const identity = parsedCacheIdentity(requiredChannel())
  const cacheKey = channelInfoCacheKey({ ...identity, before, after, q })
  const cached = await readParsedJson<ChannelInfo>(cacheKey)
  if (isCachedChannelInfo(cached))
    return cached

  const pending = inflightChannelInfo.get(cacheKey)
  if (pending)
    return pending

  const promise = loadChannelInfo(params, cacheKey).finally(() => {
    inflightChannelInfo.delete(cacheKey)
  })
  inflightChannelInfo.set(cacheKey, promise)
  return promise
}
