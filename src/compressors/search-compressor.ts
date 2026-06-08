/**
 * Search-results compressor.
 *
 * grep/ripgrep output (`file:line:content`) tends to have many matches per
 * file. We group by file, keep the first N matches per file (N derived from
 * targetRatio), and replace the remainder with a one-line summary per file.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from './shared.js'
import { computeOptimalK } from '../adaptive/sizer.js'

/** filename:linenum:content — first colon-delimited segment is the file. */
const SEARCH_LINE = /^([^\s:]+):(\d+):(.*)$/

export function compressSearch(text: string, opts: ResolvedOptions): CompressorOutput {
  const lines = text.split('\n')

  // Upper bound on matches kept per file, scaled by targetRatio. The adaptive
  // sizer chooses the actual count per file within this cap based on how much
  // genuinely new information each match adds.
  const maxPerFile = Math.max(3, Math.floor(10 * Math.max(0.05, 1 - opts.targetRatio)))
  // Aggressive ratios bias toward keeping fewer; gentle ratios keep more.
  const bias = 0.7 + (1 - opts.targetRatio) * 0.6

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
    // Adaptively size the keep-count: near-duplicate matches collapse, while
    // a file with many distinct matches keeps more (up to maxPerFile).
    const keepCount =
      matches.length <= maxPerFile
        ? matches.length
        : computeOptimalK(matches, { bias, minK: 3, maxK: maxPerFile })
    const keep = matches.slice(0, keepCount)
    out.push(...keep)
    totalKept += keep.length

    if (matches.length > keep.length) {
      const omitted = matches.length - keep.length
      out.push(`[... ${omitted} more matches in ${file} ...]`)
      dropped.push({
        reason: `additional matches in ${file}`,
        count: omitted,
        sample: sample(matches[keep.length]),
      })
    }
  }

  return {
    compressed: out.join('\n'),
    dropped,
    transforms: [`search:truncate(${totalOriginal}->${totalKept})`],
  }
}
