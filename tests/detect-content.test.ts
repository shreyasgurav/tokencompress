import { describe, it, expect } from 'vitest'
import { detectContent } from '../src/engine/detector.js'

describe('detectContent', () => {
  it('returns full confidence for valid JSON', () => {
    const d = detectContent('[{"a":1},{"b":2}]')
    expect(d.type).toBe('json')
    expect(d.confidence).toBe(1)
    expect(d.metadata.isArray).toBe(true)
  })

  it('detects HTML documents', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div><p>hi</p></div></body></html>'
    const d = detectContent(html)
    expect(d.type).toBe('html')
    expect(d.confidence).toBeGreaterThan(0.5)
  })

  it('detects HTML fragments with several structural tags', () => {
    const frag = '<div><nav></nav><section><article><p>x</p></article></section><footer></footer></div>'
    const d = detectContent(frag)
    expect(d.type).toBe('html')
  })

  it('gives diffs a confidence proportional to markers', () => {
    const diff = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    const d = detectContent(diff)
    expect(d.type).toBe('diff')
    expect(d.confidence).toBeGreaterThan(0.7)
  })

  it('falls back to text with moderate confidence', () => {
    const d = detectContent('just some ordinary prose here')
    expect(d.type).toBe('text')
    expect(d.confidence).toBeGreaterThan(0)
  })
})
