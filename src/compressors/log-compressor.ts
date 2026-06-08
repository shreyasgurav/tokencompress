/**
 * Log compressor.
 *
 * Logs are dominated by repeated INFO/DEBUG lines that differ only in
 * timestamps, ids, and counts. We keep header + footer context, always
 * keep errors, deduplicate by a normalized "template" of each line, and
 * report how many lines were dropped at each priority level.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from './shared.js'

const MIN_LINES = 10
const HEAD_LINES = 5
const TAIL_LINES = 5

const HIGH = /\b(error|fatal|critical|exception|traceback|fail)\b/i
const MED = /\b(warn|warning)\b/i

const MED_MAX_PER_PATTERN = 2
const LOW_MAX_PER_PATTERN = 1

/**
 * Normalize a log line into a dedup key by stripping the volatile parts:
 * timestamps, UUIDs, hex addresses, and standalone numbers.
 */
function normalizeKey(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '<TS>')
    .replace(/\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '<TS>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/0x[0-9a-fA-F]+/g, '<HEX>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<HASH>')
    .replace(/\d+/g, '<N>')
    .trim()
}

export function compressLogs(text: string, _opts: ResolvedOptions): CompressorOutput {
  void _opts
  const lines = text.split('\n')
  if (lines.length < MIN_LINES) {
    return { compressed: text, dropped: [], transforms: ['logs:passthrough'] }
  }

  const head = lines.slice(0, HEAD_LINES)
  const tail = lines.slice(lines.length - TAIL_LINES)
  const body = lines.slice(HEAD_LINES, lines.length - TAIL_LINES)

  const seen = new Map<string, number>()
  const kept: string[] = []

  let highKept = 0
  let medDropped = 0
  let lowDropped = 0
  let medSample: string | undefined
  let lowSample: string | undefined

  for (const line of body) {
    const key = normalizeKey(line)
    const count = seen.get(key) ?? 0

    if (HIGH.test(line)) {
      // Always keep errors — no dedup.
      kept.push(line)
      seen.set(key, count + 1)
      highKept++
    } else if (MED.test(line)) {
      if (count < MED_MAX_PER_PATTERN) {
        kept.push(line)
        seen.set(key, count + 1)
      } else {
        medDropped++
        if (!medSample) medSample = sample(line)
      }
    } else {
      if (count < LOW_MAX_PER_PATTERN) {
        kept.push(line)
        seen.set(key, count + 1)
      } else {
        lowDropped++
        if (!lowSample) lowSample = sample(line)
      }
    }
  }

  const totalDropped = medDropped + lowDropped
  const out: string[] = [...head]
  if (totalDropped > 0) {
    out.push(`[... ${totalDropped} repeated lines omitted ...]`)
  }
  out.push(...kept, ...tail)

  const dropped: DroppedItem[] = []
  if (lowDropped > 0) {
    dropped.push({
      reason: 'repeated INFO/DEBUG lines (kept 1 of each unique pattern)',
      count: lowDropped,
      sample: lowSample,
    })
  }
  if (medDropped > 0) {
    dropped.push({
      reason: 'repeated WARN lines (kept 2 of each unique pattern)',
      count: medDropped,
      sample: medSample,
    })
  }

  void highKept
  return {
    compressed: out.join('\n'),
    dropped,
    transforms: [`logs:dedup(${lines.length}->${out.length})`],
  }
}
