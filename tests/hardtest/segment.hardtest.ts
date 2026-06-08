/**
 * Hard test for segmentAndCompress() on a single massive mixed document.
 *
 * Document layout (9 segments: 4 fenced + 5 prose):
 *   [0] prose  — 3-line introduction
 *   [1] fenced ```json  — 200-item homogeneous array
 *   [2] prose  — 3-line transition
 *   [3] fenced ```log   — 300 lines (280 repeated INFO + 10 unique ERROR + 10 unique WARN)
 *   [4] prose  — 3-line transition
 *   [5] fenced ```typescript — 5 functions, each with 10+ JSDoc comment lines
 *   [6] prose  — 3-line transition
 *   [7] fenced ```diff  — 3 hunks, each with 20 context lines + 2 changed lines
 *   [8] prose  — 3-line conclusion
 */
import { describe, it, expect } from 'vitest'
import { segmentAndCompress } from '../../src/segment/segment-compress.js'
import { segmentDocument } from '../../src/segment/segmenter.js'

// ---------------------------------------------------------------------------
// Document generators
// ---------------------------------------------------------------------------

function makeJsonBody(): string {
  return JSON.stringify(
    Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `user-${i}`,
      status: 'active',
      score: i * 2,
    })),
    null,
    2,
  )
}

function makeLogBody(): string {
  const lines: string[] = []
  for (let i = 0; i < 10; i++) {
    lines.push(
      `[2024-01-01 09:${String(i).padStart(2, '0')}:00] ERROR: Critical failure in module-${i} during startup`,
    )
  }
  for (let i = 0; i < 10; i++) {
    lines.push(
      `[2024-01-01 09:${String(i + 10).padStart(2, '0')}:00] WARN: Degraded performance in subsystem-${i}`,
    )
  }
  for (let i = 0; i < 280; i++) {
    lines.push(`[2024-01-01 10:00:00] INFO: Request processed successfully by the main handler`)
  }
  return lines.join('\n')
}

function makeTsBody(): string {
  const fns = [
    ['processData', 'input: string, options: ProcessOptions', 'string'],
    ['validateSchema', 'data: unknown, schema: Schema', 'ValidationResult'],
    ['transformPayload', 'payload: RawPayload, ctx: Context', 'Payload'],
    ['aggregateMetrics', 'events: MetricEvent[], window: number', 'Metrics'],
    ['formatOutput', 'result: Result, format: OutputFormat', 'string'],
  ] as const

  return fns
    .map(
      ([name, params, ret]) => `
/**
 * ${name}: processes input through the main pipeline.
 *
 * @param ${params.split(',')[0].trim().split(':')[0].trim()} - Primary input parameter for ${name}
 * @param ${params.split(',')[1]?.trim().split(':')[0].trim() ?? 'opts'} - Secondary configuration parameter
 * @returns ${ret} — the processed output value
 * @throws {Error} If input validation fails at any stage
 * @since 1.0.0
 * @internal
 */
function ${name}(${params}): ${ret} {
  return null as unknown as ${ret}
}`,
    )
    .join('\n')
}

function makeDiffBody(): string {
  const contextLine = (i: number) => ` const contextLine${i} = computeValue(${i}) // context`
  const hunk = (n: number) =>
    [
      `@@ -${n * 30 + 1},22 +${n * 30 + 1},22 @@ export function handler${n}() {`,
      ...Array.from({ length: 20 }, (_, i) => contextLine(i + 1)),
      `-  oldBehavior_hunk${n}: 'previous implementation of handler ${n}',`,
      `+  newBehavior_hunk${n}: 'updated implementation of handler ${n}',`,
    ].join('\n')

  return [
    'diff --git a/src/handlers.ts b/src/handlers.ts',
    'index abc1234..def5678 100644',
    '--- a/src/handlers.ts',
    '+++ b/src/handlers.ts',
    hunk(0),
    hunk(1),
    hunk(2),
  ].join('\n')
}

function makeMassiveMixedDoc(): string {
  const parts = [
    'This is the plain prose introduction to the diagnostic report.',
    'It summarises the system state and provides context for what follows.',
    'The report covers JSON data, application logs, source code, and a diff.',
    '',
    '```json',
    makeJsonBody(),
    '```',
    '',
    'The above JSON represents the full user dataset from the production database.',
    'Each record has a consistent shape and the array can be sampled for analysis.',
    'A plain prose transition sentence bridging the JSON block to the log block.',
    '',
    '```log',
    makeLogBody(),
    '```',
    '',
    'The logs above show the startup sequence, degraded-performance warnings, and errors.',
    'All error lines represent distinct failure events that require investigation.',
    'A plain prose transition sentence bridging the log block to the code block.',
    '',
    '```typescript',
    makeTsBody(),
    '```',
    '',
    'The TypeScript functions above form the core request-handling pipeline.',
    'Each function is documented with JSDoc and types are fully annotated.',
    'A plain prose transition sentence bridging the code block to the diff block.',
    '',
    '```diff',
    makeDiffBody(),
    '```',
    '',
    'The diff above shows three refactoring hunks applied to the handler module.',
    'Each hunk replaces one implementation with an updated equivalent.',
    'This is the plain prose conclusion — action required immediately.',
  ]
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Build the document and compress it once — shared by all assertions
// ---------------------------------------------------------------------------

const DOC = makeMassiveMixedDoc()
const RESULT = segmentAndCompress(DOC)

// Helper: find a fenced segment by its fence language tag
function fencedSeg(lang: string) {
  return RESULT.segments.find((s) => s.kind === 'fenced' && s.fenceLanguage === lang)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('segmentAndCompress() — massive mixed document hard test', () => {
  it('does not throw and returns a defined result', () => {
    expect(RESULT).toBeDefined()
    expect(RESULT.compressed).toBeDefined()
    expect(typeof RESULT.compressed).toBe('string')
  })

  it('segments.length === 9 (4 fenced + 5 prose)', () => {
    expect(RESULT.segments.length).toBe(9)
  })

  it('re-segmenting the compressed output produces the same segment count', () => {
    const r2 = segmentAndCompress(RESULT.compressed)
    expect(r2.segments.length).toBe(RESULT.segments.length)
  })

  it('total tokensSaved is at least 40% of original', () => {
    const ratio = RESULT.tokensSaved / RESULT.tokensBefore
    expect(
      ratio,
      `expected ≥40% savings, got ${(ratio * 100).toFixed(1)}% (saved ${RESULT.tokensSaved} of ${RESULT.tokensBefore})`,
    ).toBeGreaterThanOrEqual(0.4)
  })

  it('JSON segment saved at least 50% — 200 homogeneous items should compress heavily', () => {
    const seg = fencedSeg('json')
    expect(seg, 'fenced json segment should exist').toBeDefined()
    const ratio = seg!.tokensSaved / seg!.tokensBefore
    expect(
      ratio,
      `expected JSON ≥50% savings, got ${(ratio * 100).toFixed(1)}%`,
    ).toBeGreaterThanOrEqual(0.5)
  })

  it('log segment saved at least 60% — 280 repeated INFO lines should collapse', () => {
    const seg = fencedSeg('log')
    expect(seg, 'fenced log segment should exist').toBeDefined()
    const ratio = seg!.tokensSaved / seg!.tokensBefore
    expect(
      ratio,
      `expected log ≥60% savings, got ${(ratio * 100).toFixed(1)}%`,
    ).toBeGreaterThanOrEqual(0.6)
  })

  it('code segment saved at least 20% — JSDoc comments should be stripped', () => {
    const seg = fencedSeg('typescript')
    expect(seg, 'fenced typescript segment should exist').toBeDefined()
    const ratio = seg!.tokensSaved / seg!.tokensBefore
    expect(
      ratio,
      `expected code ≥20% savings, got ${(ratio * 100).toFixed(1)}%`,
    ).toBeGreaterThanOrEqual(0.2)
  })

  it('diff segment saved at least 30% — 20 context lines per hunk should be capped to 3', () => {
    const seg = fencedSeg('diff')
    expect(seg, 'fenced diff segment should exist').toBeDefined()
    const ratio = seg!.tokensSaved / seg!.tokensBefore
    expect(
      ratio,
      `expected diff ≥30% savings, got ${(ratio * 100).toFixed(1)}%`,
    ).toBeGreaterThanOrEqual(0.3)
  })

  it('all 10 ERROR lines are present in the compressed output', () => {
    for (let i = 0; i < 10; i++) {
      expect(
        RESULT.compressed,
        `ERROR line ${i} (module-${i}) should survive log compression`,
      ).toContain(`Critical failure in module-${i}`)
    }
  })

  it('all 5 TypeScript function signatures are present in the compressed output', () => {
    const signatures = [
      'processData',
      'validateSchema',
      'transformPayload',
      'aggregateMetrics',
      'formatOutput',
    ]
    for (const name of signatures) {
      expect(
        RESULT.compressed,
        `function ${name} should survive comment stripping`,
      ).toContain(`function ${name}(`)
    }
  })

  it('all changed diff lines (+newBehavior / -oldBehavior) are present in the compressed output', () => {
    for (let n = 0; n < 3; n++) {
      expect(RESULT.compressed, `-oldBehavior_hunk${n} should survive diff compression`).toContain(
        `-  oldBehavior_hunk${n}`,
      )
      expect(RESULT.compressed, `+newBehavior_hunk${n} should survive diff compression`).toContain(
        `+  newBehavior_hunk${n}`,
      )
    }
  })

  it('prose introduction and conclusion are present verbatim', () => {
    expect(RESULT.compressed).toContain(
      'This is the plain prose introduction to the diagnostic report.',
    )
    expect(RESULT.compressed).toContain(
      'This is the plain prose conclusion — action required immediately.',
    )
  })

  it('every segment has valid token counts (0 <= tokensAfter <= tokensBefore)', () => {
    for (const seg of RESULT.segments) {
      expect(seg.tokensBefore, `segment ${seg.index} tokensBefore`).toBeGreaterThanOrEqual(0)
      expect(seg.tokensAfter, `segment ${seg.index} tokensAfter`).toBeGreaterThanOrEqual(0)
      expect(
        seg.tokensAfter,
        `segment ${seg.index} tokensAfter should not exceed tokensBefore`,
      ).toBeLessThanOrEqual(seg.tokensBefore)
    }
  })

  it('top-level dropped[] is non-empty and every item has a non-empty reason and positive count', () => {
    expect(RESULT.dropped.length, 'dropped[] should be non-empty').toBeGreaterThan(0)
    for (const d of RESULT.dropped) {
      expect(typeof d.reason).toBe('string')
      expect(d.reason.length, `dropped reason should not be empty`).toBeGreaterThan(0)
      expect(d.count, `dropped count should be positive`).toBeGreaterThan(0)
    }
  })

  it('tiling invariant — concatenating all segment.raw values equals the original input exactly', () => {
    const rawSegs = segmentDocument(DOC)
    const reconstructed = rawSegs.map((s) => s.raw).join('')
    expect(reconstructed.length).toBe(DOC.length)
    expect(reconstructed).toBe(DOC)
  })
})
