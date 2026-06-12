/**
 * Shared types for tokencompress.
 *
 * The defining feature of this library is the `dropped` array on every
 * result: we never remove content silently. Every compressor must report
 * exactly what it removed and why.
 */

/** The content categories tokencompress knows how to compress. */
export type ContentType = 'json' | 'logs' | 'diff' | 'search' | 'code' | 'html' | 'text' | 'conversation'

/** Outcome of content-type detection, with a confidence score and metadata. */
export interface DetectionResult {
  /** The detected content type. */
  type: ContentType
  /** Confidence in the detection, 0.0 to 1.0. */
  confidence: number
  /** Type-specific detail (e.g. `{ language: 'python' }` for code). */
  metadata: Record<string, unknown>
}

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
  /** Confidence (0.0–1.0) in the content-type detection. */
  confidence: number
  /** Exactly what was dropped and why — never empty if content was removed. */
  dropped: DroppedItem[]
  /** Ordered list of transform identifiers applied (e.g. `logs:dedup(320->84)`). */
  transformsApplied: string[]
  /** Additional metrics about the compression (e.g., iterative passes). */
  metrics?: Record<string, any>
  /** Detailed performance metrics broken down by compressor. */
  telemetry?: TelemetryData
}

export interface IterativeOptions {
  enabled?: boolean
  maxPasses?: number
  minImprovementPercent?: number
  minSentenceRetention?: number
  minSentenceChangePercent?: number
}

/** Options controlling compression behaviour. */
export interface CompressOptions {
  /** Model used for token counting. Default `gpt-4o`. */
  model?: string
  /** How aggressive to compress, 0.1 (gentle) to 0.9 (aggressive). Default 0.3. */
  targetRatio?: number
  /** Optional hard cap on output tokens (used by text truncation). */
  maxTokens?: number
  /** Iterative compression settings. */
  iterative?: IterativeOptions
  /** Optional callback for tracking compression progress (0-100). */
  onProgress?: (progress: number, message?: string, segmentIndex?: number, segmentType?: string) => void
  /** Optional signal to cancel the compression process. */
  signal?: AbortSignal
}

/** An OpenAI/Anthropic-style chat message. */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Options for {@link compressMessages}. Extends {@link CompressOptions} with
 * a message-level policy so you can protect the live conversation and skip
 * content that isn't worth compressing — the ergonomics coding agents need.
 */
export interface MessageCompressOptions extends CompressOptions {
  /** Leave the last N messages untouched (the active turn). Default 0. */
  protectRecent?: number
  /** Compress `user` messages. Default true. */
  compressUserMessages?: boolean
  /** Compress `system` messages. Default true. */
  compressSystemMessages?: boolean
  /** Skip messages whose content counts fewer than this many tokens. Default 0. */
  minTokensToCompress?: number
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
  /** Additional metrics from this compressor. */
  metrics?: Record<string, any>
}

/**
 * How a segment's boundaries were identified by the segmenter.
 *   - `fenced`: a markdown ```lang fenced block.
 *   - `json`:   an unfenced JSON object/array embedded in prose.
 *   - `logs`:   an unfenced run of log lines embedded in prose.
 *   - `text`:   prose / glue between structured blocks.
 */
export type SegmentKind = 'fenced' | 'json' | 'logs' | 'text'

/**
 * One block of a mixed-content document, after segmentation and compression.
 * Part of the per-segment explainability breakdown on
 * {@link SegmentedCompressResult}.
 */
export interface SegmentInfo {
  /** Position of this segment in the original document (0-based). */
  index: number
  /** Content type the segment was compressed as. */
  type: ContentType
  /** How the segment boundary was identified. */
  kind: SegmentKind
  /** Fence language tag, if this came from a ```lang block. */
  fenceLanguage?: string
  /** Token count of this segment's content before compression. */
  tokensBefore: number
  /** Token count after compression. */
  tokensAfter: number
  /** Tokens saved on this segment (never negative). */
  tokensSaved: number
  /** What was dropped from this segment and why. */
  dropped: DroppedItem[]
}

/**
 * Result of {@link segmentAndCompress}: a mixed document split into typed
 * blocks, each routed to its own compressor, then reassembled in order.
 */
export interface SegmentedCompressResult {
  /** The rebuilt document with each block compressed in place. */
  compressed: string
  /** The original input, unchanged. */
  original: string
  /** Token count of the whole original document. */
  tokensBefore: number
  /** Token count of the rebuilt document. */
  tokensAfter: number
  /** Total tokens saved across all segments (never negative). */
  tokensSaved: number
  /** Fraction of tokens removed, 0.0 to 1.0. */
  compressionRatio: number
  /** Per-segment breakdown, in document order. */
  segments: SegmentInfo[]
  /** Dropped items aggregated across every segment. */
  dropped: DroppedItem[]
  /** Ordered transform identifiers applied across the document. */
  transformsApplied: string[]
  /** Detailed performance metrics broken down by compressor. */
  telemetry?: TelemetryData
}

export interface CompressorTelemetry {
  timeMs: number
  blocksProcessed: number
  tokensBefore: number
  tokensAfter: number
  sentenceCount?: number
}

export interface TelemetryData {
  totalTimeMs: number
  compressors: Record<string, CompressorTelemetry>
}

export interface ResolvedIterativeOptions {
  enabled: boolean
  maxPasses: number
  minImprovementPercent: number
  minSentenceRetention: number
  minSentenceChangePercent: number
}

/** Resolved options with all defaults filled in. */
export interface ResolvedOptions {
  model: string
  targetRatio: number
  maxTokens: number | undefined
  iterative: ResolvedIterativeOptions
  onProgress?: (progress: number, message?: string, segmentIndex?: number, segmentType?: string) => void
  signal?: AbortSignal
}

export const DEFAULT_OPTIONS: ResolvedOptions = {
  model: 'gpt-4o',
  targetRatio: 0.3,
  maxTokens: undefined,
  iterative: {
    enabled: true,
    maxPasses: 3,
    minImprovementPercent: 5,
    minSentenceRetention: 0.35,
    minSentenceChangePercent: 5,
  },
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
    onProgress: options?.onProgress,
    signal: options?.signal,
    iterative: {
      enabled: options?.iterative?.enabled ?? DEFAULT_OPTIONS.iterative.enabled,
      maxPasses: options?.iterative?.maxPasses ?? DEFAULT_OPTIONS.iterative.maxPasses,
      minImprovementPercent: options?.iterative?.minImprovementPercent ?? DEFAULT_OPTIONS.iterative.minImprovementPercent,
      minSentenceRetention: options?.iterative?.minSentenceRetention ?? DEFAULT_OPTIONS.iterative.minSentenceRetention,
      minSentenceChangePercent: options?.iterative?.minSentenceChangePercent ?? DEFAULT_OPTIONS.iterative.minSentenceChangePercent,
    },
  }
}
