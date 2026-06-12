import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

const LOREM =
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'

function makeLongProse(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, i) => `${LOREM} — paragraph ${i + 1} of ${lineCount}.`,
  ).join('\n')
}

function makeExcessiveWhitespace(): string {
  const paragraphs: string[] = []
  for (let i = 0; i < 20; i++) {
    paragraphs.push(
      `Paragraph ${i + 1}: ${LOREM} This is the main body of paragraph ${i + 1} with enough text to be meaningful.`,
    )
  }
  return paragraphs.join('\n\n\n\n\n')
}

function makeShortText(): string {
  return ['Line one of the document.', 'Line two with more content.', 'Third line here.', 'Fourth line.', 'Fifth and final line.'].join('\n')
}

function makeHeadTailDocument(): string {
  const lines: string[] = []
  lines.push('CRITICAL ALERT: System failure detected at 2024-01-01T10:00:00Z')
  for (let i = 0; i < 500; i++) {
    lines.push(`${LOREM} — routine log entry ${i + 1}.`)
  }
  lines.push('End of report — action required immediately')
  return lines.join('\n')
}

describe('Text compressor — validation', () => {
  it('long prose document (500 lines): output shorter, first and last lines preserved', () => {
    const input = makeLongProse(500)
    const r = compress(input, { targetRatio: 0.5 })

    expect(r.contentType, 'should detect as text').toBe('text')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥15% tokens').toBeGreaterThanOrEqual(0.15)

    expect(r.compressed, 'first line must be in head section').toContain('paragraph 1 of 500')
    expect(r.compressed, 'last line must be in tail section').toContain('paragraph 500 of 500')

    const truncDropped = r.dropped.find(d => d.reason.includes('truncated') || d.reason.includes('omitted'))
    expect(truncDropped, 'must report truncated middle section').toBeDefined()
    expect(truncDropped!.count, 'must drop a positive number of lines').toBeGreaterThan(0)
  })

  it('document with excessive whitespace (5+ blank lines between each paragraph): blanks collapsed', () => {
    const input = makeExcessiveWhitespace()
    const r = compress(input)

    expect(r.compressed.length).toBeLessThan(r.original.length)

    // Should report some form of compression (blank lines collapsed or TF-IDF extraction)
    expect(r.dropped.length, 'must report some compression').toBeGreaterThan(0)

    // Regardless of compression method, 3+ consecutive blank lines should not survive
    const maxConsecutiveBlanks = (r.compressed.match(/\n(\n)+/g) ?? []).reduce(
      (max, run) => Math.max(max, run.length - 1),
      0,
    )
    expect(maxConsecutiveBlanks, 'blank runs must be collapsed to at most 2').toBeLessThanOrEqual(2)
  })

  it('short text (5 lines): passes through unchanged — truncation never fires on small inputs', () => {
    const input = makeShortText()
    const r = compress(input)

    expect(r.tokensSaved, 'short text should not be truncated').toBe(0)
    expect(r.dropped.length, 'nothing dropped from short text').toBe(0)
    expect(r.compressed.trim()).toBe(r.original.trim())
  })

  it('head/tail preservation: first and last landmark lines present in compressed output', () => {
    const input = makeHeadTailDocument()
    const r = compress(input, { targetRatio: 0.5 })

    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥15% tokens').toBeGreaterThanOrEqual(0.15)

    expect(r.compressed, 'critical first line must be in head').toContain(
      'CRITICAL ALERT: System failure detected',
    )
    expect(r.compressed, 'final action-required line must be in tail').toContain(
      'End of report — action required immediately',
    )
  })
})
