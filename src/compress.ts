/**
 * Main compression pipeline.
 *
 *   input → detect type → route to compressor → count tokens → result
 *
 * Fail-open guarantee: if any compressor throws, we return the original
 * text unchanged with an empty `dropped` array, rather than propagating an
 * error. Compression should never break the caller's request.
 */
import type {
  CompressOptions,
  CompressResult,
  CompressorOutput,
  ContentType,
  Message,
  MessageCompressOptions,
  ResolvedOptions,
} from './types.js'
import { resolveOptions } from './types.js'
import { detectContent } from './detector/content-detector.js'
import { countTokens } from './tokens/counter.js'
import { compressJson } from './compressors/json-compressor.js'
import { compressLogs } from './compressors/log-compressor.js'
import { compressDiff } from './compressors/diff-compressor.js'
import { compressSearch } from './compressors/search-compressor.js'
import { compressCode } from './compressors/code-compressor.js'
import { compressHtml } from './compressors/html-compressor.js'
import { compressConversation } from './compressors/conversation-compressor.js'
import { compressText } from './compressors/text-compressor.js'
import { compressIterative } from './compressors/iterative-compressor.js'

type CompressorFn = (text: string, opts: ResolvedOptions) => CompressorOutput

/** Below this token saving, TF-IDF isn't worth it — fall back to truncation. */
const TFIDF_MIN_SAVINGS = 0.05

/**
 * Prose route: Iterative extractive compression first, falling back to the
 * legacy whitespace+truncation compressor if it saves less than 20% of
 * tokens. This never regresses below the old behaviour.
 */
function compressTextRouted(text: string, opts: ResolvedOptions): CompressorOutput {
  const before = countTokens(text, opts.model)
  const iterative = compressIterative(text, opts)
  const after = countTokens(iterative.compressed, opts.model)
  const savings = before > 0 ? (before - after) / before : 0
  if (savings >= TFIDF_MIN_SAVINGS) return iterative
  return compressText(text, opts)
}

const COMPRESSORS: Record<ContentType, CompressorFn> = {
  json: compressJson,
  logs: compressLogs,
  diff: compressDiff,
  search: compressSearch,
  code: compressCode,
  html: compressHtml,
  conversation: compressConversation,
  text: compressTextRouted,
}

/**
 * Run a specific compressor, bypassing detection, and build a full result.
 * Used by the segmenter (which already decided each segment's type). Fails
 * open: a throwing compressor yields the original text with empty `dropped`.
 */
export function compressAs(
  text: string,
  contentType: ContentType,
  confidence: number,
  options?: CompressOptions,
): CompressResult {
  const opts = resolveOptions(options)
  try {
    const output = COMPRESSORS[contentType](text, opts)
    return buildResult(text, contentType, confidence, output, opts)
  } catch {
    const tokens = countTokens(text, opts.model)
    return {
      compressed: text,
      original: text,
      tokensBefore: tokens,
      tokensAfter: tokens,
      tokensSaved: 0,
      compressionRatio: 0,
      contentType,
      confidence,
      dropped: [],
      transformsApplied: [`detector:${contentType}`, 'error:passthrough'],
    }
  }
}

function buildResult(
  original: string,
  contentType: ContentType,
  confidence: number,
  output: CompressorOutput,
  opts: ResolvedOptions,
): CompressResult {
  const tokensBefore = countTokens(original, opts.model)
  // Guard against pathological cases where output is somehow larger.
  const rawAfter = countTokens(output.compressed, opts.model)
  const tokensAfter = Math.min(rawAfter, tokensBefore)
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter)

  return {
    compressed: output.compressed,
    original,
    tokensBefore,
    tokensAfter,
    tokensSaved,
    compressionRatio: tokensBefore > 0 ? tokensSaved / tokensBefore : 0,
    contentType,
    confidence,
    dropped: output.dropped,
    transformsApplied: [`detector:${contentType}`, ...output.transforms],
    metrics: output.metrics,
  }
}

/**
 * Compress a raw string.
 *
 * Detects the content type, routes to the matching compressor, and returns
 * a full {@link CompressResult} including the `dropped` report.
 */
export function compress(text: string, options?: CompressOptions): CompressResult {
  const opts = resolveOptions(options)

  if (!text || text.trim().length === 0) {
    return {
      compressed: text,
      original: text,
      tokensBefore: 0,
      tokensAfter: 0,
      tokensSaved: 0,
      compressionRatio: 0,
      contentType: 'text',
      confidence: 0,
      dropped: [],
      transformsApplied: ['detector:text', 'text:passthrough'],
    }
  }

  const detection = detectContent(text)
  console.log('Detected type:', detection.type, 'confidence:', detection.confidence)
  return compressAs(text, detection.type, detection.confidence, opts)
}

/**
 * Compress each message's content in a chat-messages array, preserving the
 * array structure and roles. Useful for piping straight into an OpenAI /
 * Anthropic request body.
 *
 * A message-level policy controls what gets touched:
 *   - `protectRecent` leaves the last N messages alone (the active turn).
 *   - `compressUserMessages` / `compressSystemMessages` gate by role.
 *   - `minTokensToCompress` skips content too small to be worth it.
 *
 * Defaults compress every message, preserving the previous behaviour.
 */
export function compressMessages(
  messages: Message[],
  options?: MessageCompressOptions,
): Message[] {
  const protectRecent = Math.max(0, options?.protectRecent ?? 0)
  const compressUser = options?.compressUserMessages ?? true
  const compressSystem = options?.compressSystemMessages ?? true
  const minTokens = Math.max(0, options?.minTokensToCompress ?? 0)
  const model = options?.model ?? 'gpt-4o'

  const protectedFrom = messages.length - protectRecent

  return messages.map((msg, i) => {
    const isProtectedByPosition = i >= protectedFrom
    const roleAllowed =
      (msg.role !== 'user' || compressUser) &&
      (msg.role !== 'system' || compressSystem)
    const bigEnough = minTokens === 0 || countTokens(msg.content, model) >= minTokens

    if (isProtectedByPosition || !roleAllowed || !bigEnough) {
      return { ...msg }
    }
    return { ...msg, content: compress(msg.content, options).compressed }
  })
}
