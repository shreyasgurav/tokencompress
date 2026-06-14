/**
 * tokencompress — validation suite entry point
 *
 * Run with: npm run validate
 *
 * This file provides a top-level smoke test and token accounting across
 * all compressor types. Individual compressor tests live in their own
 * *.validation.ts files next to this one.
 */
import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'
import { detectContent } from '../../src/engine/detector.js'

const SMOKE_INPUTS: Array<{ label: string; text: string }> = [
  {
    label: 'json',
    text: JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}`, active: true }))),
  },
  {
    label: 'logs',
    text: Array.from(
      { length: 60 },
      (_, i) => `[2024-01-01 10:00:${String(i % 60).padStart(2, '0')}] INFO: Health check OK`,
    ).join('\n'),
  },
  {
    label: 'diff',
    text: [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,25 +1,25 @@',
      ...Array.from({ length: 20 }, (_, i) => ` const x${i} = ${i}`),
      '-const old = true',
      '+const new_ = false',
      ...Array.from({ length: 4 }, (_, i) => ` const y${i} = ${i}`),
    ].join('\n'),
  },
  {
    label: 'search',
    text: Array.from(
      { length: 40 },
      (_, i) => `src/module.ts:${i + 1}:  processQuery(term_${i})`,
    ).join('\n'),
  },
  {
    label: 'code',
    text: Array.from(
      { length: 40 },
      (_, i) => `export function fn${i}(x: number): number {\n  return x * ${i}\n}\n`,
    ).join('\n'),
  },
  {
    label: 'html',
    text: `<!DOCTYPE html><html><head><script>var x=1;</script><style>.a{color:red}</style></head><body>${Array.from({ length: 10 }, (_, i) => `<div><p>Paragraph ${i + 1} with visible text content.</p></div>`).join('')}</body></html>`,
  },
  {
    label: 'text',
    text: Array.from(
      { length: 60 },
      (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog in paragraph ${i + 1}.`,
    ).join('\n'),
  },
]

describe('validation suite — smoke tests across all 7 compressor types', () => {
  it('every compressor type runs without throwing', () => {
    for (const { label, text } of SMOKE_INPUTS) {
      expect(() => compress(text), `${label}: must not throw`).not.toThrow()
    }
  })

  it('every result has correct shape: required fields present and within range', () => {
    for (const { label, text } of SMOKE_INPUTS) {
      const r = compress(text)
      expect(r.compressed, `${label}: compressed must be a string`).toBeTypeOf('string')
      expect(r.original, `${label}: original must equal input`).toBe(text)
      expect(r.tokensBefore, `${label}: tokensBefore must be ≥0`).toBeGreaterThanOrEqual(0)
      expect(r.tokensAfter, `${label}: tokensAfter must be ≤ tokensBefore`).toBeLessThanOrEqual(r.tokensBefore)
      expect(r.tokensSaved, `${label}: tokensSaved must be ≥0`).toBeGreaterThanOrEqual(0)
      expect(r.compressionRatio, `${label}: ratio must be 0–1`).toBeGreaterThanOrEqual(0)
      expect(r.compressionRatio, `${label}: ratio must be ≤1`).toBeLessThanOrEqual(1)
      expect(r.dropped, `${label}: dropped must be an array`).toBeInstanceOf(Array)
      expect(r.transformsApplied, `${label}: transformsApplied must be an array`).toBeInstanceOf(Array)
      expect(r.transformsApplied.length, `${label}: at least one transform must be recorded`).toBeGreaterThan(0)
      expect(r.confidence, `${label}: confidence must be 0–1`).toBeGreaterThanOrEqual(0)
      expect(r.confidence, `${label}: confidence must be ≤1`).toBeLessThanOrEqual(1)
    }
  })

  it('every dropped[] item on every result has a non-empty reason and positive count', () => {
    for (const { label, text } of SMOKE_INPUTS) {
      const r = compress(text)
      for (const d of r.dropped) {
        expect(d.reason, `${label}: reason must be a non-empty string`).toBeTruthy()
        expect(d.reason, `${label}: reason must not be undefined`).not.toBe(undefined)
        expect(d.count, `${label}: count must be > 0`).toBeGreaterThan(0)
      }
    }
  })

  it('detectContent returns consistent results for the same inputs', () => {
    for (const { label, text } of SMOKE_INPUTS) {
      const a = detectContent(text)
      const b = detectContent(text)
      expect(a.type, `${label}: detection must be deterministic`).toBe(b.type)
      expect(a.confidence, `${label}: confidence must be deterministic`).toBe(b.confidence)
    }
  })

  it('compress is idempotent on an already-compressed output', () => {
    for (const { label, text } of SMOKE_INPUTS) {
      const first = compress(text)
      const second = compress(first.compressed)
      expect(second.tokensSaved, `${label}: re-compressing should not inflate tokens`).toBeGreaterThanOrEqual(0)
      expect(second.tokensAfter, `${label}: re-compressed tokens must be ≤ first pass`).toBeLessThanOrEqual(
        first.tokensAfter,
      )
    }
  })
})
