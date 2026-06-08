/**
 * tokencompress — explainable LLM context compression.
 *
 * Public API surface. Keep this small and stable.
 */
export { compress, compressMessages } from './compress.js'
export { detectType, detectContent } from './detector/content-detector.js'
export { countTokens } from './tokens/counter.js'
export { computeOptimalK } from './adaptive/sizer.js'
export type {
  CompressResult,
  CompressOptions,
  MessageCompressOptions,
  DetectionResult,
  DroppedItem,
  ContentType,
  Message,
} from './types.js'
