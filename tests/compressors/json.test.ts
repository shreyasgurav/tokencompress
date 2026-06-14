import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function bigArray(n: number): string {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      status: i % 3 === 0 ? 'active' : 'inactive',
      description: 'Repeated description text used to pad each record out.',
    })),
  )
}

describe('json compressor', () => {
  it('passes through small arrays unchanged', () => {
    const r = compress('[1,2,3]')
    expect(r.contentType).toBe('json')
    expect(r.dropped).toHaveLength(0)
  })

  it('pretty-prints a single object without dropping', () => {
    const r = compress('{"a":1,"b":2}')
    expect(r.contentType).toBe('json')
    expect(r.dropped).toHaveLength(0)
    expect(r.transformsApplied).toContain('json:pretty')
  })

  it('crushes a large array and reports what was dropped', () => {
    const r = compress(bigArray(100))
    expect(r.contentType).toBe('json')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.dropped[0].count).toBeGreaterThan(0)
    expect(r.compressed).toContain('_tokencompress')
  })

  it('crushes large arrays nested inside objects recursively', () => {
    const payload = {
      metadata: { env: 'prod' },
      users: JSON.parse(bigArray(100)),
      orders: JSON.parse(bigArray(200)),
    }
    const r = compress(JSON.stringify(payload), { targetRatio: 0.8 })
    expect(r.contentType).toBe('json')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.dropped.length).toBeGreaterThan(0)
    // It should have crushed both nested arrays
    expect(r.dropped[0].count).toBeGreaterThan(100)
    const compressedObj = JSON.parse(r.compressed)
    expect(compressedObj.metadata.env).toBe('prod') // unaffected
    expect(compressedObj.users.length).toBeLessThan(100)
    expect(compressedObj.orders.length).toBeLessThan(200)
    // The marker should be present at the end of the arrays
    expect(compressedObj.users[compressedObj.users.length - 1]).toHaveProperty('_tokencompress')
    expect(compressedObj.orders[compressedObj.orders.length - 1]).toHaveProperty('_tokencompress')
  })

  it('respects targetRatio (more aggressive drops more)', () => {
    const gentle = compress(bigArray(100), { targetRatio: 0.2 })
    const aggressive = compress(bigArray(100), { targetRatio: 0.8 })
    expect(aggressive.tokensAfter).toBeLessThan(gentle.tokensAfter)
  })
})
