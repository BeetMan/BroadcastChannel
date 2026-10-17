import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { sanitizeContentHtml, sanitizeFeedHtml } from '../sanitize'
import { modifyHTMLContent } from './content'

describe('telegram HTML content', () => {
  it('emits escaped code blocks without server highlighting', async () => {
    const $ = load('<div class="message"><pre>def greet(name):<br>    return f"Hello {name}"\nif (a &lt; b) alert(1)</pre></div>')
    const content = $('.message')

    await modifyHTMLContent($, content)

    const html = content.html() ?? ''
    const pre = content.find('pre')
    const code = pre.children('code')

    expect(pre.hasClass('code')).toBe(true)
    expect(code.attr('class')).toBe('language-text')
    expect(code.find('.token')).toHaveLength(0)
    expect(code.text()).toContain('def greet(name):\n    return f"Hello {name}"')
    expect(code.text()).toContain('if (a < b) alert(1)')
    expect(html).toContain('if (a &lt; b) alert(1)')
    expect(html).not.toContain('<script>')
    expect(sanitizeContentHtml(html)).toContain('<pre class="code"><code class="language-text">')
    expect(sanitizeFeedHtml(html)).toContain('<pre class="code"><code class="language-text">')
    expect(sanitizeFeedHtml(html)).not.toContain('class="token')
  })

  it('preserves a language class that the source markup already declared', async () => {
    const $ = load('<div class="message"><pre><code class="language-python">print(1)</code></pre></div>')
    const content = $('.message')

    await modifyHTMLContent($, content)

    const code = content.find('pre > code')
    expect(code.attr('class')).toBe('language-python')
    expect(code.text()).toBe('print(1)')
    expect(code.find('.token')).toHaveLength(0)
  })
})
