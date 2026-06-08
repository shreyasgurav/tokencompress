/**
 * Text compressor (fallback for plain prose).
 *
 * Two passes:
 *   1. Whitespace normalization — collapse 3+ blank lines to 2, trim
 *      trailing whitespace.
 *   2. Truncation — only if the text is still large relative to the target,
 *      keep the first 60% and last 20% of lines and replace the middle.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { countTokens } from '../tokens/counter.js'

const TRUNCATE_TRIGGER_RATIO = 1.5

export function compressText(text: string, opts: ResolvedOptions): CompressorOutput {
  // ── Pass 1: whitespace normalization ────────────────────────────────────
  const rawLines = text.split('\n')
  const trimmedLines = rawLines.map((l) => l.replace(/[ \t]+$/, ''))

  const normalizedLines: string[] = []
  let blankRun = 0
  let whitespaceRemoved = 0
  for (const line of trimmedLines) {
    if (line.trim() === '') {
      blankRun++
      if (blankRun <= 2) {
        normalizedLines.push(line)
      } else {
        whitespaceRemoved++
      }
    } else {
      blankRun = 0
      normalizedLines.push(line)
    }
  }

  const dropped: DroppedItem[] = []
  const transforms: string[] = []
  if (whitespaceRemoved > 0) {
    dropped.push({ reason: 'excess blank lines', count: whitespaceRemoved })
  }

  // ── Pass 2: truncation (only if still too long) ─────────────────────────
  const normalized = normalizedLines.join('\n')
  const tokensNow = countTokens(normalized, opts.model)

  // Determine a token budget. If maxTokens given, use it; otherwise derive a
  // budget from targetRatio relative to the (post-normalization) size.
  const budget =
    opts.maxTokens ?? Math.floor(tokensNow * Math.max(0.05, 1 - opts.targetRatio))

  const needsTruncation = tokensNow > budget * TRUNCATE_TRIGGER_RATIO && normalizedLines.length > 10

  if (!needsTruncation) {
    transforms.push(whitespaceRemoved > 0 ? 'text:normalize' : 'text:passthrough')
    return { compressed: normalized, dropped, transforms }
  }

  // Keep first 60%, last 20% of lines; drop the middle 20%+ to hit budget.
  const total = normalizedLines.length
  const headCount = Math.max(1, Math.floor(total * 0.6))
  const tailCount = Math.max(1, Math.floor(total * 0.2))
  const droppedLines = total - headCount - tailCount

  if (droppedLines <= 0) {
    transforms.push(whitespaceRemoved > 0 ? 'text:normalize' : 'text:passthrough')
    return { compressed: normalized, dropped, transforms }
  }

  const head = normalizedLines.slice(0, headCount)
  const tail = normalizedLines.slice(total - tailCount)
  const compressed = [
    ...head,
    `[... ${droppedLines} lines omitted — middle section truncated ...]`,
    ...tail,
  ].join('\n')

  dropped.push({ reason: 'middle section truncated', count: droppedLines })
  transforms.push(`text:truncate(${total}->${headCount + tailCount})`)

  return { compressed, dropped, transforms }
}
