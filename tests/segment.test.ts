import { describe, it, expect } from 'vitest'
import { segmentDocument } from '../src/segment/segmenter.js'
import { segmentAndCompress } from '../src/segment/segment-compress.js'

/** A realistic mixed AI-chat turn: prose + fenced logs + fenced JSON + fenced code. */
function makeFencedMixedDoc(): string {
  const logLines = Array.from(
    { length: 40 },
    (_, i) => `[2024-01-01 10:00:${String(i % 60).padStart(2, '0')}] INFO: handled request /r${i}`,
  ).join('\n')
  const jsonArray = JSON.stringify(
    Array.from({ length: 50 }, (_, i) => ({ id: i, name: `user${i}`, active: true })),
  )
  return [
    "Here's the error I'm seeing in the logs:",
    '',
    '```log',
    logLines,
    '[2024-01-01 10:01:00] ERROR: database connection lost',
    '```',
    '',
    'The config response looked like this:',
    '',
    '```json',
    jsonArray,
    '```',
    '',
    'And here is the relevant handler code:',
    '',
    '```ts',
    '// connect to the database using the provided config',
    'function connect(config: Config): Connection {',
    '  /* establish the pool */',
    '  return db.connect(config.host, config.port)',
    '}',
    '```',
    '',
    'Let me know if you need the full trace.',
  ].join('\n')
}

/** Same content but pasted inline, without markdown fences. */
function makeUnfencedMixedDoc(): string {
  const logLines = Array.from(
    { length: 30 },
    (_, i) => `[2024-01-01 12:00:${String(i % 60).padStart(2, '0')}] INFO: cache hit for key-${i}`,
  ).join('\n')
  const jsonObj = JSON.stringify(
    { host: 'localhost', port: 5432, pool: 100, options: { ssl: true, timeout: 30 } },
    null,
    2,
  )
  return [
    'Here are the startup logs:',
    logLines,
    '[2024-01-01 12:01:00] ERROR: pool exhausted',
    '',
    'And the config object:',
    jsonObj,
    '',
    'That should explain the behavior.',
  ].join('\n')
}

describe('segmentDocument — tiling invariant', () => {
  it('fenced mixed document: segments concatenate back to the exact original', () => {
    const doc = makeFencedMixedDoc()
    const segs = segmentDocument(doc)
    expect(segs.map((s) => s.raw).join(''), 'segments must tile the document losslessly').toBe(doc)
  })

  it('unfenced mixed document: segments concatenate back to the exact original', () => {
    const doc = makeUnfencedMixedDoc()
    const segs = segmentDocument(doc)
    expect(segs.map((s) => s.raw).join('')).toBe(doc)
  })

  it('fence reconstruction: fenceOpen + inner + fenceClose === raw for every fenced segment', () => {
    const segs = segmentDocument(makeFencedMixedDoc())
    const fenced = segs.filter((s) => s.kind === 'fenced')
    expect(fenced.length, 'should find the 3 fenced blocks').toBe(3)
    for (const s of fenced) {
      expect(s.fenceOpen + s.inner + s.fenceClose).toBe(s.raw)
    }
  })

  it('plain prose with no structure stays a single text segment', () => {
    const doc = 'Just a normal sentence.\nAnd another one here.\nNothing structured at all.'
    const segs = segmentDocument(doc)
    expect(segs.length).toBe(1)
    expect(segs[0].kind).toBe('text')
    expect(segs.map((s) => s.raw).join('')).toBe(doc)
  })
})

describe('segmentDocument — routing', () => {
  it('routes fenced blocks to the right content types', () => {
    const segs = segmentDocument(makeFencedMixedDoc())
    const types = segs.filter((s) => s.kind === 'fenced').map((s) => s.type)
    expect(types).toContain('logs')
    expect(types).toContain('json')
    expect(types).toContain('code')
  })

  it('detects unfenced JSON and unfenced log runs inside prose', () => {
    const segs = segmentDocument(makeUnfencedMixedDoc())
    const kinds = segs.map((s) => s.kind)
    expect(kinds, 'unfenced JSON object should be split out').toContain('json')
    expect(kinds, 'unfenced log run should be split out').toContain('logs')
    expect(kinds, 'surrounding prose should remain text').toContain('text')
  })
})

describe('segmentAndCompress', () => {
  it('compresses a fenced mixed document, saving tokens while keeping every block', () => {
    const doc = makeFencedMixedDoc()
    const r = segmentAndCompress(doc)

    expect(r.tokensAfter, 'tokens should drop').toBeLessThan(r.tokensBefore)
    expect(r.tokensSaved).toBeGreaterThan(0)
    expect(r.compressed.length).toBeLessThan(r.original.length)

    // All three fenced languages still present in the rebuilt document.
    expect(r.compressed).toContain('```log')
    expect(r.compressed).toContain('```json')
    expect(r.compressed).toContain('```ts')

    // Prose glue preserved.
    expect(r.compressed).toContain("Here's the error I'm seeing")
    expect(r.compressed).toContain('Let me know if you need the full trace.')

    // The ERROR line must survive log compression.
    expect(r.compressed).toContain('database connection lost')
  })

  it('produces a per-segment breakdown and an aggregated dropped[] report', () => {
    const r = segmentAndCompress(makeFencedMixedDoc())

    expect(r.segments.length).toBeGreaterThan(3)
    for (const s of r.segments) {
      expect(s.tokensBefore).toBeGreaterThanOrEqual(0)
      expect(s.tokensSaved).toBeGreaterThanOrEqual(0)
      expect(s.tokensAfter).toBeLessThanOrEqual(s.tokensBefore)
    }

    // At least one structured block actually compressed.
    const compressedSegments = r.segments.filter((s) => s.tokensSaved > 0)
    expect(compressedSegments.length).toBeGreaterThan(0)

    expect(r.dropped.length, 'aggregated dropped[] should be non-empty').toBeGreaterThan(0)
    for (const d of r.dropped) {
      expect(d.count).toBeGreaterThan(0)
      expect(typeof d.reason).toBe('string')
      expect(d.reason.length).toBeGreaterThan(0)
    }
  })

  it('compresses an unfenced mixed document and preserves the rebuilt structure', () => {
    const doc = makeUnfencedMixedDoc()
    const r = segmentAndCompress(doc)

    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressed).toContain('pool exhausted')
    expect(r.compressed).toContain('Here are the startup logs:')
    expect(r.compressed).toContain('That should explain the behavior.')
  })

  it('is a no-op for plain prose that has nothing to compress', () => {
    const doc = 'A short note with no logs, code, or JSON to speak of.'
    const r = segmentAndCompress(doc)
    expect(r.compressed).toBe(doc)
    expect(r.tokensSaved).toBe(0)
  })

  it('handles empty input without throwing', () => {
    const r = segmentAndCompress('')
    expect(r.compressed).toBe('')
    expect(r.segments.length).toBe(0)
  })
})
