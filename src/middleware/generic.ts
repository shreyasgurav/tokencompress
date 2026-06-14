import { compressToolOutput, compressToolOutputAsync } from '../agent.js'
import type { CompressResult, ToolOutputOptions } from '../types.js'

/** 
 * Wraps a synchronous tool executor function.
 * Automatically compresses the string returned by the tool.
 *
 * @param executor The original tool function returning a string
 * @param options Compression options (target ratio, tool hint, etc.)
 * @returns A wrapped function returning a { compressed, original, stats } object
 */
export function wrapToolExecutor(
  executor: (...args: any[]) => string,
  options?: ToolOutputOptions
) {
  return (...args: any[]): { output: string; meta: Omit<CompressResult, 'compressed' | 'original'> } => {
    const rawResult = executor(...args)
    const result = compressToolOutput(rawResult, options)
    const { compressed, original, ...meta } = result
    return { output: compressed, meta }
  }
}

/** 
 * Wraps an asynchronous tool executor function.
 * Automatically compresses the string returned by the tool.
 *
 * @param executor The original tool function returning a Promise<string>
 * @param options Compression options (target ratio, tool hint, etc.)
 * @returns A wrapped function returning a Promise<{ compressed, original, stats }>
 */
export function wrapToolExecutorAsync(
  executor: (...args: any[]) => Promise<string>,
  options?: ToolOutputOptions
) {
  return async (...args: any[]): Promise<{ output: string; meta: Omit<CompressResult, 'compressed' | 'original'> }> => {
    const rawResult = await executor(...args)
    const result = await compressToolOutputAsync(rawResult, options)
    const { compressed, original, ...meta } = result
    return { output: compressed, meta }
  }
}
