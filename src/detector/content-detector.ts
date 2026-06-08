/**
 * Content type detection.
 *
 * Given a raw string, decide which of the six content categories it best
 * matches. Detection runs in priority order — the first rule that fires
 * wins — so more specific/structured formats are checked before looser
 * heuristics like "code" or "text".
 */
import type { ContentType } from '../types.js'

/** filename:linenum:content — ripgrep/grep output (also matches Windows C:\ paths). */
const SEARCH_LINE = /^[^\s:]+:\d+:/
/** Git diff structural markers. */
const DIFF_MARKERS = [/^diff --git /m, /^--- a\//m, /^\+\+\+ b\//m, /^@@ /m]
/** Log level keywords or HH:MM:SS timestamps. */
const LOG_PATTERN = /\b(INFO|DEBUG|WARN|WARNING|ERROR|FATAL|CRITICAL|TRACE)\b|\d{2}:\d{2}:\d{2}/
/** Code structure keywords at the start of a (trimmed) line. */
const CODE_PATTERN =
  /^(def |function |class |import |from |export |const |let |var |pub fn |fn |func |#include|public |private |protected |async )/

/** Does the text begin with a JSON container and parse cleanly? */
function looksLikeJson(trimmed: string): boolean {
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function fractionMatching(lines: string[], test: (line: string) => boolean): number {
  if (lines.length === 0) return 0
  let hits = 0
  for (const line of lines) {
    if (test(line)) hits++
  }
  return hits / lines.length
}

/**
 * Detect the content type of `text`.
 *
 * Priority order: JSON → diff → search → logs → code → text.
 */
export function detectType(text: string): ContentType {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 'text'

  // 1. JSON — strongest signal: starts with a container and parses.
  if (looksLikeJson(trimmed)) return 'json'

  // 2. Diff — 2+ structural markers in the first chunk.
  const head = trimmed.slice(0, 2000)
  const diffHits = DIFF_MARKERS.reduce((n, re) => n + (re.test(head) ? 1 : 0), 0)
  if (diffHits >= 2) return 'diff'

  const lines = trimmed.split('\n')

  // 3. Search results — >30% of the first 30 lines look like file:line: matches.
  const first30 = lines.slice(0, 30)
  if (fractionMatching(first30, (l) => SEARCH_LINE.test(l.trim())) > 0.3) {
    return 'search'
  }

  // 4. Logs — >30% of the first 50 lines carry a log level or timestamp.
  const first50 = lines.slice(0, 50)
  if (fractionMatching(first50, (l) => LOG_PATTERN.test(l)) > 0.3) {
    return 'logs'
  }

  // 5. Code — >20% of non-empty lines start with a code keyword.
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (fractionMatching(nonEmpty, (l) => CODE_PATTERN.test(l.trimStart())) > 0.2) {
    return 'code'
  }

  // 6. Default.
  return 'text'
}
