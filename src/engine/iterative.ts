import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { countTokens } from './counter.js'
import { compressTfidf } from './tfidf.js'

export function compressIterative(text: string, opts: ResolvedOptions): CompressorOutput {
  if (!opts.iterative.enabled) {
    return compressTfidf(text, opts)
  }

  const maxPasses = opts.iterative.maxPasses
  const minImprovement = opts.iterative.minImprovementPercent / 100
  const minSentenceRetention = opts.iterative.minSentenceRetention
  const minSentenceChange = opts.iterative.minSentenceChangePercent / 100

  let currentText = text
  const initialTokens = countTokens(text, opts.model)
  
  let passCount = 0
  let convergenceReached = false
  let totalDropped: number = 0
  
  let lastValidResult: CompressorOutput | null = null
  let originalSentenceCount = 0
  let previousRetainedCount = 0

  while (passCount < maxPasses) {
    const tokensBefore = countTokens(currentText, opts.model)
    const result = compressTfidf(currentText, opts)
    const tokensAfter = countTokens(result.compressed, opts.model)
    
    const metrics = result.metrics
    if (metrics && typeof metrics.retainedSentenceCount === 'number' && typeof metrics.originalSentenceCount === 'number') {
      if (passCount === 0) {
        originalSentenceCount = metrics.originalSentenceCount
      }
      const retainedCount = metrics.retainedSentenceCount
      
      // Stop condition 3: Sentence Retention Floor
      const minAllowedSentences = Math.ceil(originalSentenceCount * minSentenceRetention)
      if (retainedCount < minAllowedSentences) {
        break
      }

      // Stop condition 4: Semantic Stability Check (retainedSentenceCount change < 5%)
      if (passCount > 0 && previousRetainedCount > 0) {
        const changedCount = Math.abs(previousRetainedCount - retainedCount)
        const changePercent = changedCount / previousRetainedCount
        if (changePercent < minSentenceChange) {
          convergenceReached = true
          break
        }
      }
      
      previousRetainedCount = retainedCount
    }

    const improvement = tokensBefore > 0 ? (tokensBefore - tokensAfter) / tokensBefore : 0
    
    // If output somehow grew or didn't compress at all, stop and don't accept this pass
    if (tokensAfter >= tokensBefore || improvement <= 0) {
      break
    }

    passCount++
    lastValidResult = result
    currentText = result.compressed
    
    // Stop condition 2: Convergence (Improvement below threshold)
    if (improvement < minImprovement) {
      convergenceReached = true
      break
    }
  }

  if (passCount === 0 || !lastValidResult) {
    // If even the first pass failed constraints, return the standard single-pass result
    const result = compressTfidf(text, opts)
    return {
      ...result,
      transforms: [...result.transforms, 'iterative:0passes'],
      metrics: {
        passCount: 0,
        perPassSavings: 0,
        convergenceReached: false,
        originalSentenceCount: result.metrics?.originalSentenceCount ?? 0,
        retainedSentenceCount: result.metrics?.retainedSentenceCount ?? 0,
      }
    }
  }

  const tokensFinal = countTokens(lastValidResult.compressed, opts.model)
  const perPassSavings = initialTokens > 0 ? (initialTokens - tokensFinal) / initialTokens / passCount : 0

  // Accumulate total dropped items across all valid passes.
  // We don't have perfect tracking for all intermediate dropped arrays if we don't save them,
  // but we can just report the final pass's dropped reasons + the iterative summary.
  const finalDropped: DroppedItem[] = []
  
  // To get a true totalDropped, we can just use the difference in originalSentenceCount and final retainedSentenceCount,
  // but it's cleaner to report the overall summary.
  if (originalSentenceCount > previousRetainedCount) {
    totalDropped = originalSentenceCount - previousRetainedCount
    finalDropped.push({
      reason: `Iterative compression completed after ${passCount} passes`,
      count: totalDropped,
    })
  }

  for (const d of lastValidResult.dropped) {
    if (!d.reason.includes('removed')) {
      finalDropped.push(d)
    }
  }

  return {
    compressed: lastValidResult.compressed,
    dropped: finalDropped,
    transforms: [...lastValidResult.transforms, `iterative:${passCount}passes`],
    metrics: {
      passCount,
      perPassSavings,
      convergenceReached,
      originalSentenceCount,
      retainedSentenceCount: previousRetainedCount,
    }
  }
}

