/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    SITE_URL: string
    RSS_URL: string
    RSS_PREFIX: string
  }
}

declare module 'sanitize-html' {
  export interface SanitizeHtmlFrame {
    tag: string
    attribs: Record<string, string>
  }

  export interface SanitizeHtmlOptions {
    allowedTags?: string[]
    allowedAttributes?: Record<string, string[]>
    exclusiveFilter?: (frame: SanitizeHtmlFrame) => boolean
  }

  interface SanitizeHtml {
    (dirty: string, options?: SanitizeHtmlOptions): string
    defaults: {
      allowedTags: string[]
      allowedAttributes: Record<string, string[]>
    }
  }

  const sanitizeHtml: SanitizeHtml

  export default sanitizeHtml
}

// Present only in the Cloudflare Workers runtime. Parsed-post caching imports
// it dynamically so other adapters still build.
declare module 'cloudflare:workers' {
  interface WorkersEnv {
    SESSION?: {
      get: (key: string, type?: 'json') => Promise<unknown>
      put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>
    }
  }

  export const env: WorkersEnv
}
