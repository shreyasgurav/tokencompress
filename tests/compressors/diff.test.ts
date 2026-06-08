import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function bigDiff(): string {
  const lines = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index abc123..def456 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,40 +1,40 @@',
  ]
  for (let i = 0; i < 30; i++) lines.push(` unchanged context line ${i}`)
  lines.push('-removed line')
  lines.push('+added line')
  for (let i = 0; i < 30; i++) lines.push(` more context ${i}`)
  return lines.join('\n')
}

describe('diff compressor', () => {
  it('passes through small diffs unchanged', () => {
    const small = [
      'diff --git a/f b/f',
      '--- a/f',
      '+++ b/f',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    const r = compress(small)
    expect(r.contentType).toBe('diff')
    expect(r.dropped).toHaveLength(0)
  })

  it('strips excess context and keeps change lines', () => {
    const r = compress(bigDiff())
    expect(r.contentType).toBe('diff')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.dropped[0].reason).toContain('context')
    expect(r.compressed).toContain('-removed line')
    expect(r.compressed).toContain('+added line')
    expect(r.compressed).toContain('unchanged context lines omitted')
  })
})
