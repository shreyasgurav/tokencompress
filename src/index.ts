/**
 * tokencompress — explainable LLM context compression.
 *
 * Public API surface. Keep this small and stable.
 */
// === PRIMARY API ===
export { compressToolOutput, compressToolOutputAsync } from './agent.js'

// === MESSAGE-LEVEL API ===
export {
  compressMessages,
  compressMessagesAsync,
} from './compress.js'

// === LOWER-LEVEL API ===
export { compress, compressAsync, compressAs, compressAsAsync } from './compress.js'
export { segmentAndCompress, segmentAndCompressAsync } from './engine/router.js'
export { segmentDocument } from './engine/segmenter.js'
export { detectType, detectContent } from './engine/detector.js'
export { countTokens } from './engine/counter.js'
export { computeOptimalK } from './engine/sizer.js'
export type {
  CompressResult,
  CompressOptions,
  ToolOutputOptions,
  ContentType,
  DetectionResult,
  DroppedItem,
  SegmentInfo,
  SegmentedCompressResult,
  Message,
  MessageCompressOptions,
} from './types.js'
