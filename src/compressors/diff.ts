/**
 * Diff compressor.
 *
 * Git diffs carry a lot of unchanged context lines (leading space) that the
 * model rarely needs in full. We keep all file/hunk headers and all added/
 * removed lines, but cap consecutive unchanged context at 3 lines per run.
 */
import type { CompressorOutput, ResolvedOptions } from '../types.js'
import { sample } from '../engine/utils.js'

const MIN_LINES = 20
const MAX_CONTEXT_RUN = 3

const HEADER = /^(diff |index |--- |\+\+\+ |@@ )/

export function compressDiff(text: string, _opts: ResolvedOptions): CompressorOutput {
  void _opts
  const lines = text.split('\n')
  if (lines.length < MIN_LINES) {
    return { compressed: text, dropped: [], transforms: ['diff:passthrough'] }
  }

  const kept: string[] = []
  let contextRun = 0
  let skipped = 0
  let firstSkippedSample: string | undefined

  for (const line of lines) {
    const isHeader = HEADER.test(line)
    const isChange =
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')

    if (isHeader || isChange) {
      kept.push(line)
      contextRun = 0
    } else if (line.startsWith(' ')) {
      // Unchanged context line.
      if (contextRun < MAX_CONTEXT_RUN) {
        kept.push(line)
      } else {
        skipped++
        if (!firstSkippedSample) firstSkippedSample = sample(line)
      }
      contextRun++
    } else {
      // Blank lines, "\ No newline at end of file", etc — keep as-is.
      kept.push(line)
      contextRun = 0
    }
  }

  if (skipped > 0) {
    kept.push(`[... ${skipped} unchanged context lines omitted ...]`)
  }

  return {
    compressed: kept.join('\n'),
    dropped:
      skipped > 0
        ? [{ reason: 'unchanged context lines', count: skipped, sample: firstSkippedSample }]
        : [],
    transforms: [`diff:trim(${lines.length}->${kept.length})`],
  }
}
