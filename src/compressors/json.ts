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
import type { CompressorOutput, ResolvedOptions } from '../types.js'
import { sample } from '../engine/utils.js'
import { computeOptimalK } from '../engine/sizer.js'

const MIN_ARRAY_ITEMS = 5

/** Compress a JSON string that has already been validated as parseable. */
export function compressJson(text: string, opts: ResolvedOptions): CompressorOutput {
  let data: unknown
  try {
    data = JSON.parse(text.trim())
  } catch {
    // Detector said JSON but it doesn't parse — leave it untouched.
    return { compressed: text, dropped: [], transforms: ['json:passthrough'] }
  }

  if (!Array.isArray(data)) {
    // Single object/value: pretty-print only, no semantic compression.
    return {
      compressed: JSON.stringify(data, null, 2),
      dropped: [],
      transforms: ['json:pretty'],
    }
  }

  const original = data.length
  if (original <= MIN_ARRAY_ITEMS) {
    return {
      compressed: JSON.stringify(data, null, 2),
      dropped: [],
      transforms: ['json:pretty'],
    }
  }

  // targetRatio is "fraction removed"; (1 - targetRatio) is the upper bound on
  // what we keep. Within that cap, the adaptive sizer decides how many records
  // are actually distinct enough to keep — a list of 500 near-identical rows
  // collapses hard, while 500 varied rows are barely touched.
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
    return {
      compressed: JSON.stringify(data, null, 2),
      dropped: [],
      transforms: ['json:pretty'],
    }
  }

  const headCount = Math.max(1, Math.floor(keepCount / 2))
  const tailCount = Math.max(1, Math.floor(keepCount / 4))
  const middleSlots = Math.max(0, keepCount - headCount - tailCount)

  const head = data.slice(0, headCount)
  const tail = tailCount > 0 ? data.slice(original - tailCount) : []

  // Evenly sample the middle region (between head and tail).
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

  // Emit compact JSON here (no indentation): the goal is fewer tokens, and
  // pretty-printing a crushed array can re-inflate the token count past the
  // original on minified input. Small arrays/objects still get pretty output.
  return {
    compressed: JSON.stringify(result),
    dropped: [
      {
        reason: 'repeated array items sampled',
        count: droppedCount,
        sample: sample(JSON.stringify(data[middleStart] ?? data[headCount])),
      },
    ],
    transforms: [`json:crush(${original}->${kept.length})`],
  }
}
