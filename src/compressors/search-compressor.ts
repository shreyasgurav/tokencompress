/**
 * Search-results compressor.
 *
 * grep/ripgrep output (`file:line:content`) tends to have many matches per
 * file. We group by file, keep the first N matches per file (N derived from
 * targetRatio), and replace the remainder with a one-line summary per file.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from './shared.js'

/** filename:linenum:content — first colon-delimited segment is the file. */
const SEARCH_LINE = /^([^\s:]+):(\d+):(.*)$/

export function compressSearch(text: string, opts: ResolvedOptions): CompressorOutput {
  const lines = text.split('\n')

  // Keep max matches per file scaled by targetRatio (10 * (1 - ratio)), floor 3.
  const maxPerFile = Math.max(3, Math.floor(10 * Math.max(0.05, 1 - opts.targetRatio)))

  // Preserve insertion order of files.
  const fileOrder: string[] = []
  const perFile = new Map<string, string[]>()
  const nonResult: string[] = []

  for (const line of lines) {
    const m = line.trim().match(SEARCH_LINE)
    if (m) {
      const file = m[1]
      if (!perFile.has(file)) {
        perFile.set(file, [])
        fileOrder.push(file)
      }
      perFile.get(file)!.push(line)
    } else {
      nonResult.push(line)
    }
  }

  if (perFile.size === 0) {
    return { compressed: text, dropped: [], transforms: ['search:passthrough'] }
  }

  const out: string[] = []
  // Keep leading non-result lines (headers) — usually few.
  out.push(...nonResult)

  const dropped: DroppedItem[] = []
  let totalKept = 0
  let totalOriginal = 0

  for (const file of fileOrder) {
    const matches = perFile.get(file)!
    totalOriginal += matches.length
    const keep = matches.slice(0, maxPerFile)
    out.push(...keep)
    totalKept += keep.length

    if (matches.length > maxPerFile) {
      const omitted = matches.length - maxPerFile
      out.push(`[... ${omitted} more matches in ${file} ...]`)
      dropped.push({
        reason: `additional matches in ${file}`,
        count: omitted,
        sample: sample(matches[maxPerFile]),
      })
    }
  }

  return {
    compressed: out.join('\n'),
    dropped,
    transforms: [`search:truncate(${totalOriginal}->${totalKept})`],
  }
}
