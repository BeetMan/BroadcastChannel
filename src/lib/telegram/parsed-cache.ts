import type { ChannelInfo } from '../../types'

/**
 * Read-only lookup of parsed Telegram JSON in the Cloudflare SESSION KV binding.
 *
 * Cold parses used to `put` `bc:parsed:*` keys on every miss. The Workers free
 * plan allows 1,000 KV writes per day, and this binding is also what Astro
 * sessions use, so those cache puts exhausted the quota and then failed open.
 * HTML is cached separately (Workers Cache plus the Cache API). Existing keys
 * are still honored until they expire; this module never writes.
 *
 * `cloudflare:workers` is imported dynamically so Node, Vercel, Netlify, and
 * EdgeOne builds keep working when the module is absent. Astro 6+ removed
 * `locals.runtime.env`.
 */
const CACHE_VERSION = 'v1'
const KV_KEY_LIMIT = 512

export interface SessionKv {
  get: (key: string, type: 'json') => Promise<unknown>
}

interface WorkersModule {
  env?: {
    SESSION?: SessionKv
  }
}

let kvOverride: SessionKv | null | undefined
let platformKv: SessionKv | null | undefined

/** Test and local override. `undefined` uses the platform binding. */
export function setParsedCacheKv(kv: SessionKv | null | undefined): void {
  kvOverride = kv
}

async function loadPlatformKv(): Promise<SessionKv | null> {
  if (platformKv !== undefined)
    return platformKv

  try {
    const specifier = 'cloudflare:workers'
    const mod = await import(/* @vite-ignore */ specifier) as WorkersModule
    const kv = mod.env?.SESSION
    platformKv = kv && typeof kv.get === 'function' ? kv : null
  }
  catch {
    platformKv = null
  }

  return platformKv
}

async function getSessionKv(): Promise<SessionKv | null> {
  if (kvOverride !== undefined)
    return kvOverride

  return loadPlatformKv()
}

function fnv1a(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function fitKvKey(prefix: string, parts: string[]): string {
  const key = `${prefix}:${parts.map(part => encodeURIComponent(part)).join(':')}`
  if (key.length <= KV_KEY_LIMIT)
    return key

  return `${prefix}:${fnv1a(key)}`
}

export interface ParsedCacheScope {
  channel: string
  telegramHost?: string
  staticProxy?: string
  reactions?: boolean
}

export function channelInfoCacheKey(params: ParsedCacheScope & {
  before?: string
  after?: string
  q?: string
}): string {
  return fitKvKey(`bc:parsed:${CACHE_VERSION}:info`, [
    params.channel,
    params.telegramHost ?? '',
    params.staticProxy ?? '',
    params.reactions ? '1' : '0',
    params.before ?? '',
    params.after ?? '',
    params.q ?? '',
  ])
}

export function channelPostCacheKey(params: ParsedCacheScope & {
  id: string
}): string {
  return fitKvKey(`bc:parsed:${CACHE_VERSION}:post`, [
    params.channel,
    params.id,
    params.telegramHost ?? '',
    params.staticProxy ?? '',
    params.reactions ? '1' : '0',
  ])
}

export function isCachedChannelInfo(value: unknown): value is ChannelInfo {
  if (!value || typeof value !== 'object')
    return false

  const info = value as ChannelInfo
  return Array.isArray(info.posts) && typeof info.title === 'string'
}

export async function readParsedJson<T>(key: string): Promise<T | null> {
  const kv = await getSessionKv()
  if (!kv)
    return null

  try {
    const value = await kv.get(key, 'json')
    return (value ?? null) as T | null
  }
  catch {
    return null
  }
}
