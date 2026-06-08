import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function repeatedLogs(): string {
  const lines: string[] = []
  lines.push('[2024-06-07 10:23:45] INFO: Starting server on port 8080')
  lines.push('[2024-06-07 10:23:46] INFO: Database connection established')
  for (let i = 0; i < 50; i++) {
    lines.push(`[2024-06-07 10:24:${10 + (i % 50)}] INFO: GET /api/products 200 ${i}ms`)
  }
  lines.push('[2024-06-07 10:25:00] ERROR: Connection pool exhausted')
  lines.push('[2024-06-07 10:25:01] WARN: Retrying in 5s')
  return lines.join('\n')
}

describe('log compressor', () => {
  it('passes through short logs unchanged', () => {
    const short = '[2024-06-07 10:00:00] INFO: a\n[2024-06-07 10:00:01] INFO: b'
    const r = compress(short)
    expect(r.contentType).toBe('logs')
    expect(r.dropped).toHaveLength(0)
  })

  it('deduplicates repeated lines and reports drops', () => {
    const r = compress(repeatedLogs())
    expect(r.contentType).toBe('logs')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    const totalDropped = r.dropped.reduce((n, d) => n + d.count, 0)
    expect(totalDropped).toBeGreaterThan(0)
    expect(r.compressed).toContain('repeated lines omitted')
  })

  it('always keeps ERROR lines', () => {
    const r = compress(repeatedLogs())
    expect(r.compressed).toContain('ERROR: Connection pool exhausted')
  })
})
