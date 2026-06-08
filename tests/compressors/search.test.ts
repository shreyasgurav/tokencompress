import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function manyMatches(): string {
  const lines: string[] = []
  for (let i = 0; i < 30; i++) lines.push(`src/a.ts:${i}:match in a number ${i}`)
  for (let i = 0; i < 30; i++) lines.push(`src/b.ts:${i}:match in b number ${i}`)
  return lines.join('\n')
}

describe('search compressor', () => {
  it('caps matches per file and reports omissions', () => {
    const r = compress(manyMatches())
    expect(r.contentType).toBe('search')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.compressed).toContain('more matches in src/a.ts')
    expect(r.compressed).toContain('more matches in src/b.ts')
  })

  it('keeps few-match results unchanged', () => {
    const small = ['src/a.ts:1:x', 'src/a.ts:2:y'].join('\n')
    const r = compress(small)
    expect(r.contentType).toBe('search')
    expect(r.dropped).toHaveLength(0)
  })
})
