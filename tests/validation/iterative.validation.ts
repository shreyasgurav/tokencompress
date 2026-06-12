import { describe, it, expect } from 'vitest'
import { compressIterative } from '../../src/compressors/iterative-compressor.js'
import { resolveOptions } from '../../src/types.js'
import { countTokens } from '../../src/tokens/counter.js'

describe('Iterative compressor — validation', () => {
  it('stops if maxPasses is reached or improvement is below threshold', () => {
    // Generate large repetitive text
    let text = ''
    for (let i = 0; i < 500; i++) {
      text += 'The system architecture requires careful consideration. '
      text += 'It is a sunny day outside. '
      text += 'This is an arbitrary filler sentence that has no meaning. '
      text += 'Database queries should be optimized. '
    }

    const opts = resolveOptions({
      targetRatio: 0.5,
      iterative: {
        enabled: true,
        maxPasses: 3,
        minImprovementPercent: 5,
        minSentenceRetention: 0.1,
        minSentenceChangePercent: 1, // keep it low to avoid stopping early on change
      },
    })

    const result = compressIterative(text, opts)
    
    // It should have compressed
    expect(countTokens(result.compressed, opts.model)).toBeLessThan(countTokens(text, opts.model))
    // We should get iterative metadata
    expect(result.metrics?.passCount).toBeGreaterThan(0)
    expect(result.metrics?.passCount).toBeLessThanOrEqual(3)
  })

  it('stops if semantic stability check triggers (sentence change < minSentenceChangePercent)', () => {
    // Create text where it drops a bunch on pass 1, but then stops
    let text = ''
    for (let i = 0; i < 200; i++) {
      text += 'Important feature number one. '
      text += 'Minor detail. '
    }

    const opts = resolveOptions({
      targetRatio: 0.3,
      iterative: {
        enabled: true,
        maxPasses: 5,
        minImprovementPercent: 1, // very low
        minSentenceRetention: 0.1,
        minSentenceChangePercent: 5, // if sentences change < 5%, stop
      },
    })

    const result = compressIterative(text, opts)
    expect(result.metrics?.convergenceReached).toBe(true)
  })

  it('stops if sentence retention floor is reached', () => {
    let text = ''
    for (let i = 0; i < 100; i++) {
      // Use sentences with meaningful numbers (prices) so importance signal fires
      text += 'The product costs $' + (100 + i) + ' and has a 4.5% discount rate. '
    }

    const opts = resolveOptions({
      targetRatio: 0.8, // Try to drop 80%
      iterative: {
        enabled: true,
        maxPasses: 5,
        minImprovementPercent: 1,
        minSentenceRetention: 0.5, // Don't allow dropping below 50%
        minSentenceChangePercent: 1,
      },
    })

    const result = compressIterative(text, opts)
    
    // Should have stopped because keeping < 50% was requested
    expect(result.metrics?.retainedSentenceCount).toBeGreaterThanOrEqual(50)
  })

  it('already compressed text stops after first pass', () => {
    const text = 'This is short. It is already compressed.'
    
    const opts = resolveOptions({
      iterative: {
        enabled: true,
      },
    })

    const result = compressIterative(text, opts)
    
    // Pass count is 0 because it falls back to passthrough or single pass
    expect(result.metrics?.passCount).toBe(0)
  })
})
