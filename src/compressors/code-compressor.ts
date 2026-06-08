/**
 * Code compressor.
 *
 * Source code sent to a model for context often carries comments and
 * docstrings that cost tokens without changing behaviour understanding much.
 * We strip block comments, full-line single-line comments, and collapse
 * runs of blank lines. We deliberately do NOT touch inline comments or
 * collapse function bodies — too risky for correctness.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { sample } from './shared.js'

/** Count newlines inside a string region. */
function countLines(s: string): number {
  if (s.length === 0) return 0
  return s.split('\n').length
}

export function compressCode(text: string, _opts: ResolvedOptions): CompressorOutput {
  void _opts
  let working = text
  let blockCommentLines = 0
  let blockSample: string | undefined

  // ── Pass 1: block comments ──────────────────────────────────────────────
  // C-style /* ... */ and /** ... */ (JSDoc). Non-greedy, multiline.
  working = working.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    blockCommentLines += countLines(match)
    if (!blockSample) blockSample = sample(match)
    return ''
  })

  // Python triple-quoted docstrings that sit on their own (line starts with
  // optional indent then the quotes). Conservative: only standalone blocks.
  working = working.replace(/^[ \t]*("""[\s\S]*?"""|'''[\s\S]*?''')[ \t]*$/gm, (match) => {
    blockCommentLines += countLines(match)
    if (!blockSample) blockSample = sample(match)
    return ''
  })

  // ── Pass 2: full-line single-line comments ──────────────────────────────
  // Only lines that are ENTIRELY a comment (optional leading whitespace).
  // Inline comments (code then comment) are left alone.
  let lineCommentCount = 0
  let lineSample: string | undefined
  const afterPass2 = working
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      const isPureComment =
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('--')
      if (isPureComment) {
        lineCommentCount++
        if (!lineSample) lineSample = sample(line)
        return false
      }
      return true
    })
    .join('\n')

  // ── Pass 3: collapse blank-line runs (3+ → 1) ───────────────────────────
  let blankRemoved = 0
  const collapsed = afterPass2.replace(/\n[ \t]*\n([ \t]*\n)+/g, (match) => {
    // match contains the run; we collapse to a single blank line ("\n\n").
    const blanks = countLines(match) - 1
    blankRemoved += Math.max(0, blanks - 1)
    return '\n\n'
  })

  const dropped: DroppedItem[] = []
  if (blockCommentLines > 0) {
    dropped.push({
      reason: 'block comments / docstrings',
      count: blockCommentLines,
      sample: blockSample,
    })
  }
  if (lineCommentCount > 0) {
    dropped.push({
      reason: 'full-line comments',
      count: lineCommentCount,
      sample: lineSample,
    })
  }
  if (blankRemoved > 0) {
    dropped.push({ reason: 'excess blank lines', count: blankRemoved })
  }

  const compressed = collapsed.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')

  return {
    compressed,
    dropped,
    transforms: [`code:strip(comments:${blockCommentLines + lineCommentCount} blanks:${blankRemoved})`],
  }
}
