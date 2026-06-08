import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

const SAMPLE = `import os
import sys

// this is a full-line comment
function doThing() {
  /* a block comment
     spanning lines */
  const x = 1 // inline comment stays
  return x
}



# a python style comment
def helper():
    return 2
`

describe('code compressor', () => {
  it('strips comments and collapses blanks, reporting drops', () => {
    const r = compress(SAMPLE)
    expect(r.contentType).toBe('code')
    expect(r.tokensAfter).toBeLessThanOrEqual(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    // full-line comments removed
    expect(r.compressed).not.toContain('full-line comment')
    expect(r.compressed).not.toContain('block comment')
    // inline comment preserved (we never touch inline comments)
    expect(r.compressed).toContain('inline comment stays')
  })

  it('handles code with no comments gracefully', () => {
    const code = 'const a = 1\nconst b = 2\nexport { a, b }'
    const r = compress(code)
    expect(r.compressed).toContain('const a = 1')
  })
})
