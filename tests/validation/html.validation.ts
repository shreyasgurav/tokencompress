import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function makeFullHtmlPage(): string {
  const scriptLines = Array.from({ length: 18 }, (_, i) => `    var _analytics_${i} = trackEvent('page', ${i});`).join('\n')
  const styleLines = Array.from(
    { length: 28 },
    (_, i) => `  .class-${i} { display: flex; color: #${String(i).padStart(3, '0')}; margin: ${i}px; }`,
  ).join('\n')
  const navItems = Array.from({ length: 10 }, (_, i) => `    <li><a href="/section${i}">Section ${i}</a></li>`).join('\n')
  const articles = Array.from(
    { length: 3 },
    (_, i) => `
    <article>
      <h2>Article Title ${i + 1}</h2>
      <p>This is paragraph one of article ${i + 1} with important content about topic ${i + 1}.</p>
      <p>Paragraph two provides additional context and detail for article ${i + 1}.</p>
      <p>Paragraph three concludes the discussion in article ${i + 1}.</p>
    </article>`,
  ).join('\n')
  const bottomScriptLines = Array.from({ length: 18 }, (_, i) => `  function init${i}() { setup(${i}); }`).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Page</title>
  <script type="text/javascript">
${scriptLines}
  </script>
  <style>
${styleLines}
  </style>
</head>
<body>
  <nav>
    <ul>
${navItems}
    </ul>
  </nav>
  <main>
${articles}
  </main>
  <footer>
    <p>Copyright 2024 Example Corp. All rights reserved.</p>
  </footer>
  <script>
${bottomScriptLines}
  </script>
</body>
</html>`
}

function makeContentOnlyHtml(): string {
  return `<article>
  <h1>Important Title</h1>
  <p>Paragraph one with important information about the topic.</p>
  <p>Paragraph two provides more context and detailed analysis.</p>
  <p>Paragraph three concludes with actionable recommendations.</p>
  <ul>
    <li>Key point alpha</li>
    <li>Key point beta</li>
    <li>Key point gamma</li>
  </ul>
</article>`
}

function makeHtmlFragment(): string {
  return `<div class="container" id="main-content">
  <h2>Section Title</h2>
  <p>The first paragraph of this section contains useful text.</p>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
    <li>Item 3</li>
  </ul>
  <p>The second paragraph provides closing thoughts.</p>
</div>`
}

describe('HTML compressor — validation', () => {
  it('full webpage (200 lines, scripts + styles + articles): ≥60% tokens saved, script/style reported, article text kept', () => {
    const input = makeFullHtmlPage()
    const r = compress(input)

    expect(r.contentType, 'should detect as html').toBe('html')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥60% tokens on script/style-heavy HTML').toBeGreaterThanOrEqual(0.6)

    const scriptDropped = r.dropped.find(d => d.reason.includes('<script>'))
    expect(scriptDropped, 'script blocks must be reported as dropped').toBeDefined()
    expect(scriptDropped!.count, 'script line count must be positive').toBeGreaterThan(0)

    const styleDropped = r.dropped.find(d => d.reason.includes('<style>'))
    expect(styleDropped, 'style blocks must be reported as dropped').toBeDefined()
    expect(styleDropped!.count, 'style line count must be positive').toBeGreaterThan(0)

    expect(r.compressed, 'article h2 text must be in output').toContain('Article Title 1')
    expect(r.compressed, 'article paragraph text must be in output').toContain('important content about topic 1')
    expect(r.compressed, 'nav link text must survive').toContain('Section 0')

    expect(r.dropped.every(d => !!d.reason), 'every dropped entry must have a reason string').toBe(true)
    expect(r.dropped.every(d => d.count > 0), 'every dropped entry must have positive count').toBe(true)
  })

  it('HTML with only content, no scripts or styles: text preserved, tag markup stripped', () => {
    const input = makeContentOnlyHtml()
    const r = compress(input)

    expect(r.contentType).toBe('html')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)

    const tagDropped = r.dropped.find(d => d.reason.includes('tags'))
    expect(tagDropped, 'tags must be reported as dropped even without scripts').toBeDefined()
    expect(tagDropped!.count, 'tag count must be positive').toBeGreaterThan(0)

    expect(r.compressed, 'h1 text must survive tag stripping').toContain('Important Title')
    expect(r.compressed, 'paragraph text must survive').toContain('important information about the topic')
    expect(r.compressed, 'list item text must survive').toContain('Key point alpha')
  })

  it('HTML fragment (no DOCTYPE): detected as html, text preserved, tokens saved', () => {
    const input = makeHtmlFragment()
    const r = compress(input)

    expect(r.contentType, 'fragment with 6+ structural tags must detect as html').toBe('html')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)

    expect(r.compressed, 'h2 text must be preserved').toContain('Section Title')
    expect(r.compressed, 'list items must be preserved').toContain('Item 1')
    expect(r.compressed, 'list items must be preserved').toContain('Item 2')
    expect(r.compressed, 'list items must be preserved').toContain('Item 3')
    expect(r.compressed, 'paragraph text must be preserved').toContain('closing thoughts')

    expect(r.compressed, 'raw HTML tags must be stripped').not.toContain('<div')
    expect(r.compressed, 'raw HTML tags must be stripped').not.toContain('<ul>')
  })
})
