import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function makeHomogeneousArray(n: number): string {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      status: 'active',
      score: parseFloat((Math.sin(i) * 0.5 + 0.5).toFixed(4)),
      tags: ['a', 'b', 'c'],
      createdAt: '2024-01-01',
    })),
  )
}

function makeAnomalyArray(normalCount: number): string {
  const items: object[] = []
  for (let i = 0; i < 5; i++) {
    items.push({ errorId: `ERR-${i}`, status: 'error', code: 500, msg: `Database error ${i}` })
  }
  for (let i = 0; i < normalCount; i++) {
    items.push({ id: i, status: 'ok', value: i * 2, label: `item-${i}` })
  }
  for (let i = 0; i < 5; i++) {
    items.push({ warnId: `WARN-${i}`, status: 'warning', code: 429, msg: `Rate limit ${i}` })
  }
  return JSON.stringify(items)
}

describe('JSON compressor — validation', () => {
  it('large homogeneous array (1000 items): real compression, ≥60% tokens saved, ≥800 dropped', () => {
    const input = makeHomogeneousArray(1000)
    const r = compress(input, { targetRatio: 0.8 })

    expect(r.contentType, 'should detect as json').toBe('json')
    expect(r.compressed.length, 'output must be shorter').toBeLessThan(r.original.length)
    expect(r.tokensAfter, 'tokens must decrease').toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥60% tokens').toBeGreaterThanOrEqual(0.6)

    expect(r.dropped.length, 'must report dropped items').toBeGreaterThan(0)
    expect(r.dropped[0].count, 'dropped count must be real').toBeGreaterThan(0)
    expect(r.dropped[0].count, 'must drop ≥800 items').toBeGreaterThanOrEqual(800)
    expect(r.dropped[0].reason, 'reason must be a non-empty string').toBeTruthy()

    expect(r.compressed, 'sentinel must be present').toContain('_tokencompress')
    expect(r.compressed, 'first item (id:0) must be kept').toContain('"id":0')
  })

  it('array with anomalies (5 errors at front): error items preserved, ≥40% tokens saved', () => {
    const input = makeAnomalyArray(490)
    const r = compress(input, { targetRatio: 0.6 })

    expect(r.contentType).toBe('json')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio).toBeGreaterThanOrEqual(0.4)

    for (let i = 0; i < 5; i++) {
      expect(r.compressed, `error item ERR-${i} must be in head`).toContain(`ERR-${i}`)
    }
  })

  it('nested object (not array): passes through with zero dropped items', () => {
    const input = '{"user":{"id":1,"name":"test","config":{"theme":"dark","lang":"en"}}}'
    const r = compress(input)

    expect(r.contentType).toBe('json')
    expect(r.dropped.length, 'objects are never semantically compressed').toBe(0)
    expect(r.tokensSaved, 'no tokens removed — pretty-print may add but buildResult caps it').toBe(0)
  })

  it('small array (4 items): passes through unchanged, nothing dropped', () => {
    const input = JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }])
    const r = compress(input)

    expect(r.contentType).toBe('json')
    expect(r.dropped.length).toBe(0)
    expect(r.tokensSaved).toBe(0)
    expect(r.transformsApplied).toContain('json:pretty')
  })

  it('invalid JSON string: no throw, detected as non-json, original returned', () => {
    const input = '{name: "invalid json", value: undefined, bad: }'
    let r: ReturnType<typeof compress> | undefined

    expect(() => { r = compress(input) }).not.toThrow()
    expect(r).toBeDefined()
    expect(r!.contentType, 'invalid JSON is not detected as json').not.toBe('json')
    expect(r!.compressed, 'output must be a string').toBeTypeOf('string')
    expect(r!.dropped.every(d => d.reason && d.count > 0), 'every dropped item must be valid').toBe(true)
  })
})
