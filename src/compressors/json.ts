/**
 * JSON compressor.
 *
 * Large JSON arrays are the highest-leverage compression target: agents
 * routinely paste hundreds of near-identical records. We keep a
 * representative sample (head + tail + evenly-spaced middle) and drop the
 * rest, recording exactly how many records were omitted.
 *
 * Objects are only pretty-printed — we never guess which keys are safe to
 * drop from a single object.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from '../engine/utils.js'
import { computeOptimalK } from '../engine/sizer.js'

const MIN_ARRAY_ITEMS = 5

interface CompressionStats {
  droppedCount: number
  samples: string[]
}

function compressArray(data: unknown[], opts: ResolvedOptions): { array: unknown[]; dropped: number; sample?: string } {
  const original = data.length
  if (original <= MIN_ARRAY_ITEMS) {
    return { array: data, dropped: 0 }
  }

  const keepFraction = Math.max(0.05, 1 - opts.targetRatio)
  const maxKeep = Math.max(MIN_ARRAY_ITEMS, Math.floor(original * keepFraction))
  const bias = 0.7 + (1 - opts.targetRatio) * 0.6
  const itemStrings = data.map((item) => JSON.stringify(item))
  const keepCount = computeOptimalK(itemStrings, {
    bias,
    minK: MIN_ARRAY_ITEMS,
    maxK: maxKeep,
  })

  if (keepCount >= original) {
    return { array: data, dropped: 0 }
  }

  const headCount = Math.max(1, Math.floor(keepCount / 2))
  const tailCount = Math.max(1, Math.floor(keepCount / 4))
  const middleSlots = Math.max(0, keepCount - headCount - tailCount)

  const head = data.slice(0, headCount)
  const tail = tailCount > 0 ? data.slice(original - tailCount) : []

  const middleStart = headCount
  const middleEnd = original - tailCount
  const middleRegion = data.slice(middleStart, middleEnd)
  const middle: unknown[] = []
  if (middleSlots > 0 && middleRegion.length > 0) {
    const step = middleRegion.length / middleSlots
    for (let i = 0; i < middleSlots; i++) {
      const idx = Math.min(middleRegion.length - 1, Math.floor(i * step))
      middle.push(middleRegion[idx])
    }
  }

  const kept = [...head, ...middle, ...tail]
  const droppedCount = original - kept.length

  const result: unknown[] = [...kept]
  if (droppedCount > 0) {
    result.push({ _tokencompress: `${droppedCount} similar items omitted` })
  }

  return { array: result, dropped: droppedCount, sample: itemStrings[middleStart] }
}

function traverseAndCompress(obj: unknown, opts: ResolvedOptions, stats: CompressionStats): unknown {
  if (Array.isArray(obj)) {
    if (obj.length > MIN_ARRAY_ITEMS) {
      const { array, dropped, sample } = compressArray(obj, opts)
      stats.droppedCount += dropped
      if (sample) stats.samples.push(sample)
      return array.map(item => traverseAndCompress(item, opts, stats))
    } else {
      return obj.map(item => traverseAndCompress(item, opts, stats))
    }
  } else if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = traverseAndCompress(v, opts, stats)
    }
    return result
  }
  return obj
}

/** Compress a JSON string that has already been validated as parseable. */
export function compressJson(text: string, opts: ResolvedOptions): CompressorOutput {
  let data: unknown
  try {
    data = JSON.parse(text.trim())
  } catch {
    // Detector said JSON but it doesn't parse — leave it untouched.
    return { compressed: text, dropped: [], transforms: ['json:passthrough'] }
  }

  const stats: CompressionStats = { droppedCount: 0, samples: [] }
  const result = traverseAndCompress(data, opts, stats)

  if (stats.droppedCount === 0) {
    return {
      compressed: JSON.stringify(result, null, 2),
      dropped: [],
      transforms: ['json:pretty'],
    }
  }

  const dropped: DroppedItem[] = [
    {
      reason: 'repeated array items sampled',
      count: stats.droppedCount,
      sample: sample(stats.samples[0] || ''),
    },
  ]

  // Emit compact JSON here (no indentation): the goal is fewer tokens, and
  // pretty-printing a crushed array can re-inflate the token count past the
  // original on minified input. Small arrays/objects still get pretty output.
  return {
    compressed: JSON.stringify(result),
    dropped,
    transforms: [`json:recursiveCrush(dropped=${stats.droppedCount})`],
  }
}
