import { describe, it, expect } from 'vitest'
import { compressHtml } from '../../src/compressors/html.js'
import { DEFAULT_OPTIONS } from '../../src/types.js'

describe('compressHtml', () => {
  it('drops scripts, styles, and tags but keeps visible text', () => {
    const html = [
      '<!DOCTYPE html>',
      '<html><head><style>body{color:red}</style>',
      '<script>console.log("noise")</script></head>',
      '<body><h1>Title</h1><p>Hello <b>world</b></p></body></html>',
    ].join('\n')
    const out = compressHtml(html, DEFAULT_OPTIONS)
    expect(out.compressed).toContain('Title')
    expect(out.compressed).toContain('Hello')
    expect(out.compressed).toContain('world')
    expect(out.compressed).not.toContain('console.log')
    expect(out.compressed).not.toContain('color:red')
    expect(out.compressed).not.toContain('<p>')
  })

  it('reports what was dropped', () => {
    const html = '<html><body><script>x()</script><!-- c --><p>hi</p></body></html>'
    const out = compressHtml(html, DEFAULT_OPTIONS)
    const reasons = out.dropped.map((d) => d.reason)
    expect(reasons.some((r) => r.includes('script'))).toBe(true)
    expect(reasons.some((r) => r.includes('tags'))).toBe(true)
  })

  it('decodes common entities', () => {
    const html = '<p>a &amp; b &lt; c</p>'
    const out = compressHtml(html, DEFAULT_OPTIONS)
    expect(out.compressed).toContain('a & b < c')
  })
})
