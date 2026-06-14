import { describe, it, expect } from 'vitest'
import {
  computeOptimalK,
  findKnee,
  uniqueBigramCurve,
  countUnique,
} from '../src/engine/sizer.js'

describe('computeOptimalK', () => {
  it('returns all items for trivially small inputs', () => {
    expect(computeOptimalK(['a', 'b', 'c'])).toBe(3)
    expect(computeOptimalK(Array.from({ length: 8 }, (_, i) => `item ${i}`))).toBe(8)
  })

  it('keeps few when items are near-duplicates', () => {
    const items = Array.from({ length: 100 }, () => 'connection established to server pool')
    const k = computeOptimalK(items, { minK: 3 })
    expect(k).toBeLessThanOrEqual(5)
    expect(k).toBeGreaterThanOrEqual(3)
  })

  it('keeps many when items are all distinct', () => {
    const items = Array.from({ length: 50 }, (_, i) => `unique line number ${i} with text ${i * 7}`)
    const k = computeOptimalK(items)
    expect(k).toBeGreaterThan(25)
  })

  it('respects minK and maxK bounds', () => {
    const items = Array.from({ length: 100 }, () => 'same same same')
    const k = computeOptimalK(items, { minK: 10, maxK: 20 })
    expect(k).toBeGreaterThanOrEqual(10)
    expect(k).toBeLessThanOrEqual(20)
  })
})

describe('findKnee', () => {
  it('returns null for a straight line (no saturation)', () => {
    expect(findKnee([0, 1, 2, 3, 4, 5])).toBeNull()
  })

  it('finds the bend in a saturating curve', () => {
    const knee = findKnee([0, 5, 9, 10, 10, 10, 10, 10])
    expect(knee).not.toBeNull()
    expect(knee).toBeLessThanOrEqual(4)
  })
})

describe('uniqueBigramCurve', () => {
  it('is monotonically non-decreasing', () => {
    const curve = uniqueBigramCurve(['the quick brown', 'the quick fox', 'jumps over lazy'])
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1])
    }
  })
})

describe('countUnique', () => {
  it('collapses near-identical strings', () => {
    const items = [
      '2024-01-01 10:00:00 request handled in 12ms',
      '2024-01-01 10:00:01 request handled in 15ms',
      '2024-01-01 10:00:02 request handled in 9ms',
    ]
    expect(countUnique(items)).toBeLessThanOrEqual(2)
  })

  it('counts genuinely different strings separately', () => {
    const items = ['apple pie recipe', 'quantum field theory', 'database migration plan']
    expect(countUnique(items)).toBe(3)
  })
})
