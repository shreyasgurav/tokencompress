import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

describe('text compressor', () => {
  it('returns empty input unchanged', () => {
    const r = compress('')
    expect(r.compressed).toBe('')
    expect(r.dropped).toHaveLength(0)
    expect(r.tokensSaved).toBe(0)
  })

  it('normalizes excess blank lines (3+ blank lines collapse to at most 2)', () => {
    const text = 'paragraph one\n\n\n\n\nparagraph two'
    const r = compress(text)
    expect(r.contentType).toBe('text')
    // At most 2 blank lines remain → never 3+ consecutive blank lines (4+ \n).
    expect(r.compressed).not.toContain('\n\n\n\n')
    expect(r.dropped.some((d) => d.reason.includes('blank'))).toBe(true)
  })

  it('truncates very long prose and reports it', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `This is sentence number ${i} of the document.`)
    const r = compress(lines.join('\n'), { targetRatio: 0.6 })
    expect(r.contentType).toBe('text')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.some((d) => d.reason.includes('truncated'))).toBe(true)
    expect(r.compressed).toContain('lines omitted')
  })
})
