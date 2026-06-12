/**
 * Document segmentation.
 *
 * Splits a single mixed-content document (the kind an LLM conversation
 * produces — prose with embedded code, JSON, and logs) into an ordered list
 * of typed blocks, so each block can be routed to the compressor that
 * understands it and the document rebuilt in place.
 *
 * Tiling invariant: concatenating every segment's `raw` reproduces the input
 * byte-for-byte. This is what makes lossless reassembly possible.
 *
 * Two tiers of boundary detection:
 *   1. Markdown fenced blocks (```lang … ```) — the dominant, unambiguous
 *      signal in AI chat. The info string maps to a content type.
 *   2. Unfenced structures inside prose — JSON objects/arrays (brace-matched
 *      and parse-validated) and runs of log lines (≥3 consecutive).
 * Everything else is prose, routed to the text compressor.
 */
import type { ContentType, SegmentKind } from '../types.js'
import { detectContent } from '../detector/content-detector.js'

/** A segment before compression. `fenceOpen + inner + fenceClose === raw`. */
export interface RawSegment {
  /** Exact original text of this segment. Segments tile the document. */
  raw: string
  /** Content type to compress this segment as. */
  type: ContentType
  /** How the boundary was identified. */
  kind: SegmentKind
  /** Fence language tag, if any. */
  fenceLanguage?: string
  /** Verbatim opening glue (fence line) — empty for unfenced segments. */
  fenceOpen: string
  /** The portion to compress. */
  inner: string
  /** Verbatim closing glue (fence line) — empty for unfenced segments. */
  fenceClose: string
}

/** Log-level keyword or HH:MM:SS timestamp — mirrors the content detector. */
const LOG_LINE = /\b(INFO|DEBUG|WARN|WARNING|ERROR|FATAL|CRITICAL|TRACE)\b|\d{2}:\d{2}:\d{2}/

/** Minimum characters for an unfenced JSON span to be split out of prose. */
const MIN_JSON_SPAN = 30
/** Minimum consecutive log lines to split out an unfenced log run. */
const MIN_LOG_RUN = 3

/** Map a fenced-block info string to a content type. */
const LANG_TO_TYPE: Record<string, ContentType> = {
  json: 'json',
  diff: 'diff',
  patch: 'diff',
  html: 'html',
  xml: 'html',
  svg: 'html',
  log: 'logs',
  logs: 'logs',
  js: 'code',
  javascript: 'code',
  jsx: 'code',
  ts: 'code',
  typescript: 'code',
  tsx: 'code',
  py: 'code',
  python: 'code',
  go: 'code',
  golang: 'code',
  rust: 'code',
  rs: 'code',
  java: 'code',
  kotlin: 'code',
  kt: 'code',
  c: 'code',
  cpp: 'code',
  'c++': 'code',
  cc: 'code',
  h: 'code',
  hpp: 'code',
  cs: 'code',
  csharp: 'code',
  php: 'code',
  ruby: 'code',
  rb: 'code',
  swift: 'code',
  scala: 'code',
  sql: 'code',
  sh: 'code',
  bash: 'code',
  shell: 'code',
  zsh: 'code',
}

/** Split text into lines, each retaining its trailing newline. Lossless. */
function splitLinesKeepEol(text: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/** Info string of a fence-open line (`` ```lang ``), or null if not a fence. */
function fenceInfo(line: string): string | null {
  const m = /^\s*```(.*)\r?\n?$/.exec(line)
  return m ? m[1].trim() : null
}

/** True if `line` is a bare closing fence (`` ``` `` with no info string). */
function isFenceClose(line: string): boolean {
  return /^\s*```\s*\r?\n?$/.test(line)
}

function languageToType(lang: string, inner: string): ContentType {
  const key = lang.toLowerCase().split(/\s+/)[0]
  if (key && LANG_TO_TYPE[key]) return LANG_TO_TYPE[key]
  // Unknown or empty language: fall back to detecting the inner content.
  return detectContent(inner).type
}

function isLogLine(line: string): boolean {
  return line.trim().length > 0 && LOG_LINE.test(line)
}

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

function makeUnfenced(raw: string, type: ContentType, kind: SegmentKind): RawSegment {
  return { raw, type, kind, fenceOpen: '', inner: raw, fenceClose: '' }
}

/**
 * Find the end (exclusive) of a balanced bracket structure beginning at
 * `start` (which must point at `{` or `[`). Respects JSON string literals and
 * escapes. Returns -1 if unbalanced.
 */
function matchBalanced(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function parsesAsJson(s: string): boolean {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

/** Char ranges of unfenced JSON structures embedded in a prose region. */
function findJsonSpans(region: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < region.length) {
    const c = region[i]
    if (c === '{' || c === '[') {
      // Require the bracket to be the first non-whitespace char on its line.
      let k = i - 1
      let atLineStart = true
      while (k >= 0 && region[k] !== '\n') {
        if (region[k] !== ' ' && region[k] !== '\t') {
          atLineStart = false
          break
        }
        k--
      }
      if (atLineStart) {
        const end = matchBalanced(region, i)
        if (end !== -1) {
          const span = region.slice(i, end)
          if (span.length >= MIN_JSON_SPAN && parsesAsJson(span)) {
            spans.push({ start: i, end })
            i = end
            continue
          }
        }
      }
    }
    i++
  }
  return spans
}

/** Count log lines in a run starting at `start` (blanks extend the run). */
function countLogRun(lines: string[], start: number): number {
  let count = 0
  for (let k = start; k < lines.length; k++) {
    if (isLogLine(lines[k])) count++
    else if (isBlank(lines[k]) && count > 0) continue
    else break
  }
  return count
}

/** Within a prose region (no JSON), split out runs of ≥3 log lines. */
function splitLineRuns(region: string): RawSegment[] {
  if (region.length === 0) return []
  const lines = splitLinesKeepEol(region)
  const segs: RawSegment[] = []
  let textStart = 0
  let i = 0

  const flushText = (end: number) => {
    if (end > textStart) {
      segs.push(makeUnfenced(lines.slice(textStart, end).join(''), 'text', 'text'))
    }
  }

  while (i < lines.length) {
    if (isLogLine(lines[i]) && countLogRun(lines, i) >= MIN_LOG_RUN) {
      flushText(i)
      // Consume the run up to and including the last log line; trailing blank
      // lines stay with the following text so glue is preserved naturally.
      let lastLog = i
      let k = i
      while (k < lines.length) {
        if (isLogLine(lines[k])) {
          lastLog = k
          k++
        } else if (isBlank(lines[k])) {
          k++
        } else break
      }
      const runEnd = lastLog + 1
      segs.push(makeUnfenced(lines.slice(i, runEnd).join(''), 'logs', 'logs'))
      i = runEnd
      textStart = runEnd
    } else {
      i++
    }
  }
  flushText(lines.length)
  return segs
}

/** Sub-segment a prose region: pull out unfenced JSON, then log runs. */
function splitProse(region: string): RawSegment[] {
  if (region.length === 0) return []
  const segs: RawSegment[] = []
  const jsonSpans = findJsonSpans(region)
  let cursor = 0
  for (const span of jsonSpans) {
    if (span.start > cursor) {
      segs.push(...splitLineRuns(region.slice(cursor, span.start)))
    }
    segs.push(makeUnfenced(region.slice(span.start, span.end), 'json', 'json'))
    cursor = span.end
  }
  if (cursor < region.length) {
    segs.push(...splitLineRuns(region.slice(cursor)))
  }
  return segs
}

/**
 * Segment a mixed-content document into ordered, typed blocks.
 *
 * Guarantees the tiling invariant: the concatenation of every returned
 * segment's `raw` equals `text` exactly.
 */
export function segmentDocument(text: string): RawSegment[] {
  if (text.length === 0) return []
  const lines = splitLinesKeepEol(text)
  const segments: RawSegment[] = []
  let prose: string[] = []

  const flushProse = () => {
    if (prose.length === 0) return
    segments.push(...splitProse(prose.join('')))
    prose = []
  }

  let i = 0
  while (i < lines.length) {
    const info = fenceInfo(lines[i])
    if (info !== null) {
      // Look for a closing fence.
      let close = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (isFenceClose(lines[j])) {
          close = j
          break
        }
      }
      if (close !== -1) {
        flushProse()
        const fenceOpen = lines[i]
        const inner = lines.slice(i + 1, close).join('')
        const fenceClose = lines[close]
        segments.push({
          raw: fenceOpen + inner + fenceClose,
          type: languageToType(info, inner),
          kind: 'fenced',
          fenceLanguage: info || undefined,
          fenceOpen,
          inner,
          fenceClose,
        })
        i = close + 1
        continue
      }
      // Unterminated fence: treat the line as ordinary prose.
    }
    prose.push(lines[i])
    i++
  }
  flushProse()
  return segments
}
