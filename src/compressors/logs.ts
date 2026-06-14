/**
 * Log compressor.
 *
 * Logs are dominated by repeated INFO/DEBUG lines that differ only in
 * timestamps, ids, and counts. We keep header + footer context, always
 * keep errors, deduplicate by a normalized "template" of each line, and
 * report how many lines were dropped at each priority level.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from '../engine/utils.js'

const MIN_LINES = 10
const HEAD_LINES = 5
const TAIL_LINES = 5

const HIGH = /\b(error|fatal|critical|exception|traceback|fail)\b/i
const MED = /\b(warn|warning)\b/i

const HIGH_MAX_PER_PATTERN = 5
const MED_MAX_PER_PATTERN = 2
const LOW_MAX_PER_PATTERN = 1

interface PatternStats {
  level: 'HIGH' | 'MED' | 'LOW'
  totalCount: number
  lastKeptIndex: number
  sample: string
}

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
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<IP>')
    .replace(/\b(?:req(?:uest)?_id|user_id|session_id|trace_id|client_id|tx_id)=?[^\s"]+/gi, '<ID>')
    .replace(/\b(?:status|code|error_code)=?\s*(\d+)\b/gi, '___STATUS_$1___')
    .replace(/\d+/g, '<N>')
    .replace(/___STATUS_(\d+)___/g, 'status=$1')
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

  const patterns = new Map<string, PatternStats>()
  const kept: string[] = []

  let highDropped = 0
  let medDropped = 0
  let lowDropped = 0
  let highSample: string | undefined
  let medSample: string | undefined
  let lowSample: string | undefined

  for (const line of body) {
    const key = normalizeKey(line)
    let stats = patterns.get(key)
    if (!stats) {
      let level: 'HIGH' | 'MED' | 'LOW' = 'LOW'
      if (HIGH.test(line)) level = 'HIGH'
      else if (MED.test(line)) level = 'MED'
      
      stats = { level, totalCount: 0, lastKeptIndex: -1, sample: line }
      patterns.set(key, stats)
    }
    
    stats.totalCount++
    
    const limit = stats.level === 'HIGH' ? HIGH_MAX_PER_PATTERN : (stats.level === 'MED' ? MED_MAX_PER_PATTERN : LOW_MAX_PER_PATTERN)
    if (stats.totalCount <= limit) {
      kept.push(line)
      stats.lastKeptIndex = kept.length - 1
    } else {
      if (stats.level === 'HIGH') {
        highDropped++
        if (!highSample) highSample = sample(line)
      } else if (stats.level === 'MED') {
        medDropped++
        if (!medSample) medSample = sample(line)
      } else {
        lowDropped++
        if (!lowSample) lowSample = sample(line)
      }
    }
  }

  const insertions = new Map<number, string>()
  for (const stats of patterns.values()) {
    const limit = stats.level === 'HIGH' ? HIGH_MAX_PER_PATTERN : (stats.level === 'MED' ? MED_MAX_PER_PATTERN : LOW_MAX_PER_PATTERN)
    if (stats.totalCount > limit && stats.lastKeptIndex !== -1) {
      insertions.set(stats.lastKeptIndex, `[COUNT=${stats.totalCount}]`)
    }
  }

  const out: string[] = [...head]
  for (let i = 0; i < kept.length; i++) {
    out.push(kept[i])
    if (insertions.has(i)) {
      out.push(insertions.get(i)!)
    }
  }
  out.push(...tail)

  const dropped: DroppedItem[] = []
  if (highDropped > 0) {
    dropped.push({
      reason: 'repeated ERROR/FATAL lines (kept 5 of each unique pattern)',
      count: highDropped,
      sample: highSample,
    })
  }
  if (medDropped > 0) {
    dropped.push({
      reason: 'repeated WARN lines (kept 2 of each unique pattern)',
      count: medDropped,
      sample: medSample,
    })
  }
  if (lowDropped > 0) {
    dropped.push({
      reason: 'repeated INFO/DEBUG lines (kept 1 of each unique pattern)',
      count: lowDropped,
      sample: lowSample,
    })
  }

  return {
    compressed: out.join('\n'),
    dropped,
    transforms: [`logs:dedup(${lines.length}->${out.length})`],
  }
}
