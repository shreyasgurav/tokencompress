/**
 * Token counting via js-tiktoken — the pure-JS port of OpenAI's tiktoken.
 *
 * We cache encoders by encoding name so repeated calls in a single process
 * stay fast. js-tiktoken encoders are plain JS objects (no `.free()` needed,
 * unlike the WASM `tiktoken` package).
 */
import { getEncoding, encodingForModel } from 'js-tiktoken'
import type { Tiktoken, TiktokenEncoding, TiktokenModel } from 'js-tiktoken'

const encoderCache = new Map<string, Tiktoken>()

const FALLBACK_ENCODING: TiktokenEncoding = 'cl100k_base'

function getEncoderForModel(model: string): Tiktoken {
  const cacheKey = `model:${model}`
  const cached = encoderCache.get(cacheKey)
  if (cached) return cached

  let enc: Tiktoken
  try {
    enc = encodingForModel(model as TiktokenModel)
  } catch {
    enc = getCachedEncoding(FALLBACK_ENCODING)
  }
  encoderCache.set(cacheKey, enc)
  return enc
}

function getCachedEncoding(name: TiktokenEncoding): Tiktoken {
  const cacheKey = `enc:${name}`
  const cached = encoderCache.get(cacheKey)
  if (cached) return cached
  const enc = getEncoding(name)
  encoderCache.set(cacheKey, enc)
  return enc
}

/**
 * Count the number of tokens in `text` for the given `model`.
 *
 * Falls back to the `cl100k_base` encoding for unknown models, and to a
 * rough chars/4 estimate if encoding fails entirely (so this never throws).
 */
export function countTokens(text: string, model = 'gpt-4o'): number {
  if (!text) return 0
  try {
    const enc = getEncoderForModel(model)
    return enc.encode(text).length
  } catch {
    return Math.max(1, Math.ceil(text.length / 4))
  }
}
