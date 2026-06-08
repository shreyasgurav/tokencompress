/**
 * Shared types for tokencompress.
 *
 * The defining feature of this library is the `dropped` array on every
 * result: we never remove content silently. Every compressor must report
 * exactly what it removed and why.
 */

/** The content categories tokencompress knows how to compress. */
export type ContentType = 'json' | 'logs' | 'diff' | 'search' | 'code' | 'text'

/**
 * A record of something the compressor removed. This is the core
 * differentiator of tokencompress — full explainability.
 */
export interface DroppedItem {
  /** Human-readable explanation of why this content was dropped. */
  reason: string
  /** How many lines / items / matches were dropped under this reason. */
  count: number
  /** Optional first dropped line/item as a representative example (truncated). */
  sample?: string
}

/** The full result of a single `compress()` call. */
export interface CompressResult {
  /** The compressed output text. */
  compressed: string
  /** The original input text, unchanged. */
  original: string
  /** Token count of the original input. */
  tokensBefore: number
  /** Token count of the compressed output. */
  tokensAfter: number
  /** Tokens saved (tokensBefore - tokensAfter, never negative). */
  tokensSaved: number
  /** Fraction of tokens removed, 0.0 to 1.0. */
  compressionRatio: number
  /** The detected content type that determined which compressor ran. */
  contentType: ContentType
  /** Exactly what was dropped and why — never empty if content was removed. */
  dropped: DroppedItem[]
  /** Ordered list of transform identifiers applied (e.g. `logs:dedup(320->84)`). */
  transformsApplied: string[]
}

/** Options controlling compression behaviour. */
export interface CompressOptions {
  /** Model used for token counting. Default `gpt-4o`. */
  model?: string
  /** How aggressive to compress, 0.1 (gentle) to 0.9 (aggressive). Default 0.3. */
  targetRatio?: number
  /** Optional hard cap on output tokens (used by text truncation). */
  maxTokens?: number
}

/** An OpenAI/Anthropic-style chat message. */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Internal result returned by an individual compressor. The top-level
 * `compress()` wraps this with token counts and content type.
 */
export interface CompressorOutput {
  compressed: string
  dropped: DroppedItem[]
  /** Transform identifiers this compressor applied. */
  transforms: string[]
}

/** Resolved options with all defaults filled in. */
export interface ResolvedOptions {
  model: string
  targetRatio: number
  maxTokens: number | undefined
}

export const DEFAULT_OPTIONS: ResolvedOptions = {
  model: 'gpt-4o',
  targetRatio: 0.3,
  maxTokens: undefined,
}

/** Fill in defaults for any unspecified options. */
export function resolveOptions(options?: CompressOptions): ResolvedOptions {
  return {
    model: options?.model ?? DEFAULT_OPTIONS.model,
    targetRatio:
      options?.targetRatio !== undefined
        ? Math.min(0.9, Math.max(0.1, options.targetRatio))
        : DEFAULT_OPTIONS.targetRatio,
    maxTokens: options?.maxTokens,
  }
}
