import { compressToolOutputAsync } from '../agent.js'
import type { ToolOutputOptions } from '../types.js'

/**
 * Creates a middleware function for the Vercel AI SDK's `experimental_toolCallMiddleware` or similar APIs.
 *
 * It intercepts tool results, compresses them, and returns the compressed string.
 *
 * @param options Base options to apply to all tool outputs
 * @returns A middleware function
 */
export function createVercelAIMiddleware(options?: ToolOutputOptions) {
  // We use `any` here so we don't need a hard dependency on the `ai` package.
  // The signature generally matches what Vercel AI SDK expects for tool middleware.
  return async (params: { toolName: string; args: any; result: any }): Promise<any> => {
    // If the result isn't a string, try to stringify it
    let textToCompress = typeof params.result === 'string' 
      ? params.result 
      : JSON.stringify(params.result)

    const result = await compressToolOutputAsync(textToCompress, {
      ...options,
      tool: params.toolName, // Use the tool name as a hint
    })

    return result.compressed
  }
}
