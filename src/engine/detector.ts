/**
 * Content type detection.
 *
 * Given a raw string, decide which of the six content categories it best
 * matches. Detection runs in priority order — the first rule that fires
 * wins — so more specific/structured formats are checked before looser
 * heuristics like "code" or "text".
 */
import type { ContentType, DetectionResult } from '../types.js'

/** filename:linenum:content — ripgrep/grep output. Ensure we don't match ISO timestamps by checking it doesn't look like a date. */
const SEARCH_LINE = /^(?!\d{4}-\d{2}-\d{2}T)[^\s:]+:\d+:/
/** Git diff structural markers. */
const DIFF_MARKERS = [/^diff --git /m, /^--- a\//m, /^\+\+\+ b\//m, /^@@ /m]
/** Log level keywords or HH:MM:SS timestamps. */
const LOG_PATTERN = /\b(INFO|DEBUG|WARN|WARNING|ERROR|FATAL|CRITICAL|TRACE)\b|\d{2}:\d{2}:\d{2}/
/** Code structure keywords at the start of a (trimmed) line. */
const CODE_PATTERN =
  /^(def |function |class |import |from |export |const |let |var |pub fn |fn |func |#include|public |private |protected |async )/
/** Strong HTML signals. */
const HTML_DOCTYPE = /^\s*<!doctype\s+html/i
const HTML_ROOT = /<html[\s>]/i
const HTML_STRUCTURAL =
  /<(div|span|script|style|link|meta|nav|header|footer|aside|article|section|main|p|a|img|ul|li|table)[\s>]/gi

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
 * Detect the content type of `text` with a confidence score and metadata.
 *
 * Priority order: JSON → diff → HTML → search → logs → code → text. The first
 * rule that fires above its confidence threshold wins.
 */
export function detectContent(text: string): DetectionResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { type: 'text', confidence: 0, metadata: {} }

  // 1. JSON — strongest signal: starts with a container and parses.
  if (looksLikeJson(trimmed)) {
    const isArray = trimmed.startsWith('[')
    return { type: 'json', confidence: 1, metadata: { isArray } }
  }

  // 2. Diff — structural markers in the first chunk.
  const head = trimmed.slice(0, 2000)
  const diffHits = DIFF_MARKERS.reduce((n, re) => n + (re.test(head) ? 1 : 0), 0)
  if (diffHits >= 2) {
    return {
      type: 'diff',
      confidence: Math.min(1, 0.5 + diffHits * 0.15),
      metadata: { markers: diffHits },
    }
  }

  // 3. HTML — doctype/<html> or several structural tags.
  const htmlSample = trimmed.slice(0, 3000)
  const hasDoctype = HTML_DOCTYPE.test(htmlSample)
  const hasRoot = HTML_ROOT.test(htmlSample)
  const structural = (htmlSample.match(HTML_STRUCTURAL) ?? []).length
  if (hasDoctype || hasRoot || structural >= 3) {
    let confidence = 0
    if (hasDoctype) confidence += 0.5
    if (hasRoot) confidence += 0.3
    confidence += Math.min(0.6, structural * 0.1)
    if (confidence >= 0.5) {
      return {
        type: 'html',
        confidence: Math.min(1, confidence),
        metadata: { structuralTags: structural },
      }
    }
  }

  const lines = trimmed.split('\n')

  // 4. Conversation — >30% match speaker pattern and >= 3 speakers, OR strong speaker in first 50 lines.
  // Matches: "Name:", "**Name**:", "**Name**", "## Name:"
  const SPEAKER_PATTERN = /^(?:\*\*([A-Z][a-zA-Z]+)\*\*(?::\s|\s*$)|([A-Z][a-zA-Z]+):\s|##\s*([A-Z][a-zA-Z]+):(?:\s|$))/i
  const STRONG_SPEAKER_PATTERN = /^(?:\*\*?)?(User|You|Human|Assistant|ChatGPT|Claude|AI)(?:\*\*?)?(?::\s|\s*$)|##\s*(Prompt|Response|User|Assistant|AI):(?:\s|$)/i
  const first50 = lines.slice(0, 50)
  
  const speakers = new Set<string>()
  let speakerHits = 0
  let hasStrongSpeaker = false

  for (const l of first50) {
    const trimmedLine = l.trim()
    const m = trimmedLine.match(SPEAKER_PATTERN)
    if (m) {
      speakerHits++
      // The name is in group 1, 2, or 3
      speakers.add((m[1] || m[2] || m[3]).toLowerCase())
    }
    if (STRONG_SPEAKER_PATTERN.test(trimmedLine)) {
      hasStrongSpeaker = true
    }
  }

  const speakerFrac = first50.length > 0 ? speakerHits / first50.length : 0
  if ((speakerFrac > 0.3 && speakers.size >= 3) || hasStrongSpeaker) {
    const confidence = (speakerFrac > 0.3 && speakers.size >= 3) ? 0.85 : 0.65
    return { type: 'conversation', confidence, metadata: { speakers: Array.from(speakers) } }
  }

  // 6. Logs — >30% of the first 50 lines carry a log level or timestamp.
  const logFrac = fractionMatching(first50, (l) => LOG_PATTERN.test(l))
  if (logFrac > 0.3) {
    return { type: 'logs', confidence: Math.min(1, 0.4 + logFrac * 0.6), metadata: {} }
  }

  // 7. Search results — >30% of the first 30 lines look like file:line: matches.
  const first30 = lines.slice(0, 30)
  const searchFrac = fractionMatching(first30, (l) => SEARCH_LINE.test(l.trim()))
  if (searchFrac > 0.3) {
    return { type: 'search', confidence: Math.min(1, 0.4 + searchFrac * 0.6), metadata: {} }
  }

  // 8. Code — >20% of non-empty lines start with a code keyword.
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  const codeFrac = fractionMatching(nonEmpty, (l) => CODE_PATTERN.test(l.trimStart()))
  if (codeFrac > 0.2) {
    return { type: 'code', confidence: Math.min(1, 0.4 + codeFrac * 0.6), metadata: {} }
  }

  // 9. Default.
  return { type: 'text', confidence: 0.5, metadata: {} }
}

/**
 * Detect the content type of `text`.
 *
 * Thin wrapper over {@link detectContent} that returns just the type, for
 * callers that don't need the confidence score.
 */
export function detectType(text: string): ContentType {
  return detectContent(text).type
}
