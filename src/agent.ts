import { compress, compressAsync, compressAs, compressAsAsync } from './compress.js'
import type { CompressResult, ContentType, ToolOutputOptions } from './types.js'

/** 
 * Common tool names and their typical output types.
 * This skips the heuristic detection step for known tools.
 */
const TOOL_HINTS: Record<string, ContentType> = {
  grep: 'search',
  ripgrep: 'search',
  rg: 'search',
  ag: 'search',
  sql: 'json',
  database: 'json',
  db_query: 'json',
  prisma: 'json',
  git_diff: 'diff',
  diff: 'diff',
  patch: 'diff',
  curl: 'html',
  fetch: 'html',
  http: 'html',
  scrape: 'html',
  log: 'logs',
  tail: 'logs',
  journalctl: 'logs',
  cat: 'text',
  read_file: 'text',
  file: 'text',
  ls: 'text',
  find: 'text',
  tree: 'text',
}

/**
 * Compresses an AI agent's tool output before passing it back into the context window.
 * 
 * Automatically detects the content type (JSON, logs, diffs, etc.) and routes it to 
 * the appropriate semantic compressor. Optionally provide a `tool` name hint to skip 
 * auto-detection and force a specific compressor.
 *
 * @param output The raw string output from the tool
 * @param options Compression options, including an optional `tool` name hint
 * @returns A CompressResult containing the shortened text and an exact record of what was dropped
 */
export function compressToolOutput(output: string, options?: ToolOutputOptions): CompressResult {
  if (options?.tool) {
    const hint = options.tool.toLowerCase()
    const type = TOOL_HINTS[hint]
    if (type) {
      // Force the type by bypassing the content detector (achieved by prepending a strong signal temporarily,
      // or directly calling the internal router. But here we just use the options or we could export a lower
      return compressAs(output, type, 1.0, options)
    }
  }

  // Fall back to auto-detection
  return compress(output, options)
}

/**
 * Async version of `compressToolOutput`. Required if you want to use the ML model 
 * for plain text/prose outputs, as the ONNX runtime is asynchronous.
 */
export async function compressToolOutputAsync(output: string, options?: ToolOutputOptions): Promise<CompressResult> {
  if (options?.tool) {
    const hint = options.tool.toLowerCase()
    const type = TOOL_HINTS[hint]
    if (type) {
      return compressAsAsync(output, type, 1.0, options)
    }
  }

  // Fall back to auto-detection
  return compressAsync(output, options)
}
