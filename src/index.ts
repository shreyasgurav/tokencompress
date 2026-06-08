/**
 * tokencompress — explainable LLM context compression.
 *
 * Public API surface. Keep this small and stable.
 */
export { compress, compressMessages } from './compress.js'
export { detectType } from './detector/content-detector.js'
export { countTokens } from './tokens/counter.js'
export type {
  CompressResult,
  CompressOptions,
  DroppedItem,
  ContentType,
  Message,
} from './types.js'
