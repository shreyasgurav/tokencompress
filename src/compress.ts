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
  ResolvedOptions,
} from './types.js'
import { resolveOptions } from './types.js'
import { detectType } from './detector/content-detector.js'
import { countTokens } from './tokens/counter.js'
import { compressJson } from './compressors/json-compressor.js'
import { compressLogs } from './compressors/log-compressor.js'
import { compressDiff } from './compressors/diff-compressor.js'
import { compressSearch } from './compressors/search-compressor.js'
import { compressCode } from './compressors/code-compressor.js'
import { compressText } from './compressors/text-compressor.js'

type CompressorFn = (text: string, opts: ResolvedOptions) => CompressorOutput

const COMPRESSORS: Record<ContentType, CompressorFn> = {
  json: compressJson,
  logs: compressLogs,
  diff: compressDiff,
  search: compressSearch,
  code: compressCode,
  text: compressText,
}

function buildResult(
  original: string,
  contentType: ContentType,
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
    dropped: output.dropped,
    transformsApplied: [`detector:${contentType}`, ...output.transforms],
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
      dropped: [],
      transformsApplied: ['detector:text', 'text:passthrough'],
    }
  }

  const contentType = detectType(text)
  const compressor = COMPRESSORS[contentType]

  try {
    const output = compressor(text, opts)
    return buildResult(text, contentType, output, opts)
  } catch {
    // Fail open: never break the caller. Return original untouched.
    const tokens = countTokens(text, opts.model)
    return {
      compressed: text,
      original: text,
      tokensBefore: tokens,
      tokensAfter: tokens,
      tokensSaved: 0,
      compressionRatio: 0,
      contentType,
      dropped: [],
      transformsApplied: [`detector:${contentType}`, 'error:passthrough'],
    }
  }
}

/**
 * Compress each message's content in a chat-messages array, preserving the
 * array structure and roles. Useful for piping straight into an OpenAI /
 * Anthropic request body.
 */
export function compressMessages(
  messages: Message[],
  options?: CompressOptions,
): Message[] {
  return messages.map((msg) => ({
    ...msg,
    content: compress(msg.content, options).compressed,
  }))
}
