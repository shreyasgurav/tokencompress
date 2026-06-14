/**
 * Mixed-content compression.
 *
 *   document → segment into typed blocks → compress each with its compressor
 *            → reassemble in place → SegmentedCompressResult
 *
 * Unlike {@link compress}, which detects one type for the whole input, this
 * handles documents that interleave prose, code, JSON, and logs — the shape
 * of a real LLM conversation turn. Every block is compressed by the engine
 * that understands it, then stitched back together in original order.
 *
 * The `dropped` explainability guarantee extends here: the result carries a
 * per-segment breakdown (`segments[]`) plus an aggregated `dropped[]`.
 */
import type {
  CompressOptions,
  DroppedItem,
  SegmentInfo,
  SegmentedCompressResult,
} from '../types.js'
import { resolveOptions } from '../types.js'
import { compressAs } from '../compress.js'
import { countTokens } from './counter.js'
import { segmentDocument } from './segmenter.js'
import { detectContent } from './detector.js'

/** Merge dropped items that share a reason, summing counts. */
function mergeDropped(items: DroppedItem[]): DroppedItem[] {
  const byReason = new Map<string, DroppedItem>()
  for (const item of items) {
    const existing = byReason.get(item.reason)
    if (existing) {
      existing.count += item.count
      if (!existing.sample && item.sample) existing.sample = item.sample
    } else {
      byReason.set(item.reason, { ...item })
    }
  }
  return [...byReason.values()]
}

function emptyResult(text: string, model: string): SegmentedCompressResult {
  const tokens = countTokens(text, model)
  return {
    compressed: text,
    original: text,
    tokensBefore: tokens,
    tokensAfter: tokens,
    tokensSaved: 0,
    compressionRatio: 0,
    segments: [],
    dropped: [],
    transformsApplied: ['segmenter:0 blocks'],
  }
}

/**
 * Segment a mixed-content document, compress each block with the matching
 * compressor, and reassemble the document in place.
 *
 * Fenced blocks keep their fence markers; the closing fence is guaranteed to
 * sit on its own line so the rebuilt markdown stays valid. If nothing is
 * removed, the output is byte-identical to the input.
 */
export function segmentAndCompress(
  text: string,
  options?: CompressOptions,
): SegmentedCompressResult {
  const opts = resolveOptions(options)

  if (!text || text.trim().length === 0) {
    return emptyResult(text, opts.model)
  }

  const rawSegments = segmentDocument(text)
  if (rawSegments.length === 0) {
    return emptyResult(text, opts.model)
  }

  const segments: SegmentInfo[] = []
  const allDropped: DroppedItem[] = []
  const transforms: string[] = [`segmenter:${rawSegments.length} blocks`]
  const parts: string[] = []

  const globalStartMs = Date.now()
  const docType = detectContent(text)

  const telemetry: import('../types.js').TelemetryData = {
    totalTimeMs: 0,
    compressors: {}
  }

  rawSegments.forEach((seg, index) => {
    const startMs = Date.now()
    const effectiveType = (seg.type === 'text' && docType.type === 'conversation') ? 'conversation' : seg.type
    const res = compressAs(seg.inner, effectiveType, 1, opts)
    const timeMs = Date.now() - startMs

    let rebuilt: string
    if (seg.kind === 'fenced') {
      if (res.compressed.length === 0) {
        rebuilt = seg.fenceOpen + seg.fenceClose
      } else {
        // Keep the closing fence on its own line for valid markdown.
        const body = res.compressed.endsWith('\n') ? res.compressed : `${res.compressed}\n`
        rebuilt = seg.fenceOpen + body + seg.fenceClose
      }
    } else {
      rebuilt = res.compressed
    }
    parts.push(rebuilt)

    segments.push({
      index,
      type: seg.type,
      kind: seg.kind,
      fenceLanguage: seg.fenceLanguage,
      tokensBefore: res.tokensBefore,
      tokensAfter: res.tokensAfter,
      tokensSaved: res.tokensSaved,
      dropped: res.dropped,
    })

    if (!telemetry.compressors[seg.type]) {
      telemetry.compressors[seg.type] = {
        timeMs: 0,
        blocksProcessed: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      }
    }
    const cTel = telemetry.compressors[seg.type]
    cTel.timeMs += timeMs
    cTel.blocksProcessed += 1
    cTel.tokensBefore += res.tokensBefore
    cTel.tokensAfter += res.tokensAfter
    if (res.metrics?.sentenceCount !== undefined) {
      cTel.sentenceCount = (cTel.sentenceCount || 0) + res.metrics.sentenceCount
    }

    for (const d of res.dropped) allDropped.push(d)
    for (const t of res.transformsApplied) {
      transforms.push(`[${index}:${seg.kind}] ${t}`)
    }
  })

  telemetry.totalTimeMs = Date.now() - globalStartMs

  const compressed = parts.join('')
  const tokensBefore = countTokens(text, opts.model)
  const rawAfter = countTokens(compressed, opts.model)
  const tokensAfter = Math.min(rawAfter, tokensBefore)
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter)

  return {
    compressed,
    original: text,
    tokensBefore,
    tokensAfter,
    tokensSaved,
    compressionRatio: tokensBefore > 0 ? tokensSaved / tokensBefore : 0,
    segments,
    dropped: mergeDropped(allDropped),
    transformsApplied: transforms,
    telemetry,
  }
}

import { compressAsAsync } from '../compress.js'

/**
 * Async version of segmentAndCompress.
 * Processes all segments concurrently (using Promise.all) for maximum speed.
 */
export async function segmentAndCompressAsync(
  text: string,
  options?: CompressOptions,
): Promise<SegmentedCompressResult> {
  const opts = resolveOptions(options)
  const docType = detectContent(text)

  if (!text || text.trim().length === 0) {
    return emptyResult(text, opts.model)
  }

  const rawSegments = segmentDocument(text)
  if (rawSegments.length === 0) {
    return emptyResult(text, opts.model)
  }

  const segments: SegmentInfo[] = []
  const allDropped: DroppedItem[] = []
  const transforms: string[] = [`segmenter:${rawSegments.length} blocks`]
  const parts: string[] = new Array(rawSegments.length)

  // Run all compressors in parallel
  const globalStartMs = Date.now()
  const asyncResults = await Promise.all(
    rawSegments.map(async (seg, index) => {
      if (opts.signal?.aborted) {
        return Promise.reject(new Error('Compression aborted by user'))
      }
      const segmentOpts = {
        ...opts,
        onProgress: opts.onProgress 
          ? (p: number, m?: string) => opts.onProgress!(p, m, index, seg.type)
          : undefined
      }
      const startMs = Date.now()
      const effectiveType = (seg.type === 'text' && docType.type === 'conversation') ? 'conversation' : seg.type
      const res = await compressAsAsync(seg.inner, effectiveType, 1, segmentOpts)
      const timeMs = Date.now() - startMs
      return { seg, index, res, timeMs }
    })
  )

  const telemetry: import('../types.js').TelemetryData = {
    totalTimeMs: Date.now() - globalStartMs,
    compressors: {}
  }

  asyncResults.forEach(({ seg, index, res, timeMs }) => {
    let rebuilt: string
    if (seg.kind === 'fenced') {
      if (res.compressed.length === 0) {
        rebuilt = seg.fenceOpen + seg.fenceClose
      } else {
        const body = res.compressed.endsWith('\n') ? res.compressed : `${res.compressed}\n`
        rebuilt = seg.fenceOpen + body + seg.fenceClose
      }
    } else {
      rebuilt = res.compressed
    }
    parts[index] = rebuilt

    segments.push({
      index,
      type: seg.type,
      kind: seg.kind,
      fenceLanguage: seg.fenceLanguage,
      tokensBefore: res.tokensBefore,
      tokensAfter: res.tokensAfter,
      tokensSaved: res.tokensSaved,
      dropped: res.dropped,
    })

    if (!telemetry.compressors[seg.type]) {
      telemetry.compressors[seg.type] = {
        timeMs: 0,
        blocksProcessed: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      }
    }
    const cTel = telemetry.compressors[seg.type]
    cTel.timeMs += timeMs
    cTel.blocksProcessed += 1
    cTel.tokensBefore += res.tokensBefore
    cTel.tokensAfter += res.tokensAfter
    if (res.metrics?.sentenceCount !== undefined) {
      cTel.sentenceCount = (cTel.sentenceCount || 0) + res.metrics.sentenceCount
    }

    for (const d of res.dropped) allDropped.push(d)
    for (const t of res.transformsApplied) {
      transforms.push(`[${index}:${seg.kind}] ${t}`)
    }
  })

  const compressed = parts.join('')
  const tokensBefore = countTokens(text, opts.model)
  const rawAfter = countTokens(compressed, opts.model)
  const tokensAfter = Math.min(rawAfter, tokensBefore)
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter)

  return {
    compressed,
    original: text,
    tokensBefore,
    tokensAfter,
    tokensSaved,
    compressionRatio: tokensBefore > 0 ? tokensSaved / tokensBefore : 0,
    segments,
    dropped: mergeDropped(allDropped),
    transformsApplied: transforms,
    telemetry,
  }
}
