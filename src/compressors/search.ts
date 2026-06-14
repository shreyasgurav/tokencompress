/**
 * Search-results compressor.
 *
 * grep/ripgrep output (`file:line:content`) tends to have many matches per
 * file. We group by file, keep the first N matches per file (N derived from
 * targetRatio), and replace the remainder with a one-line summary per file.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from '../engine/utils.js'
import { computeOptimalK } from '../engine/sizer.js'

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

  // Separate non-result lines into leading (before first result) and trailing
  // (after last result) so they stay in their original positions.
  const leadingNonResult: string[] = []
  const trailingNonResult: string[] = []

  // First pass: find boundaries of search result lines.
  let firstResultIdx = -1
  let lastResultIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (SEARCH_LINE.test(lines[i].trim())) {
      if (firstResultIdx === -1) firstResultIdx = i
      lastResultIdx = i
    }
  }

  // Second pass: classify each line.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(SEARCH_LINE)
    if (m) {
      const file = m[1]
      if (!perFile.has(file)) {
        perFile.set(file, [])
        fileOrder.push(file)
      }
      perFile.get(file)!.push(lines[i])
    } else if (firstResultIdx === -1 || i < firstResultIdx) {
      leadingNonResult.push(lines[i])
    } else if (i > lastResultIdx) {
      trailingNonResult.push(lines[i])
    }
    // Non-result lines between results are dropped (usually blank separators)
  }

  if (perFile.size === 0) {
    return { compressed: text, dropped: [], transforms: ['search:passthrough'] }
  }

  const out: string[] = []
  // Keep leading non-result lines (headers) at the start.
  out.push(...leadingNonResult)

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

  // Append trailing non-result lines (footers) at the end.
  if (trailingNonResult.length > 0) {
    out.push(...trailingNonResult)
  }

  return {
    compressed: out.join('\n'),
    dropped,
    transforms: [`search:truncate(${totalOriginal}->${totalKept})`],
  }
}
