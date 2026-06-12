import type { ResolvedOptions, CompressorOutput, DroppedItem } from '../types.js'
import { countTokens } from '../tokens/counter.js'
import { compressTfidf } from './tfidf-compressor.js'
import { compressML } from './ml-compressor.js'

const SPEAKER_PATTERN = /^(?:\*\*([A-Z][a-zA-Z]+)\*\*(?::\s|\s*$)|([A-Z][a-zA-Z]+):\s|##\s*([A-Z][a-zA-Z]+):(?:\s|$))/i
const USER_SPEAKER_PATTERN = /^(?:\*\*?)?(User|You|Human|Client|Customer)(?:\*\*?)?(?::\s|\s*$)|##\s*(Prompt|User|Human):(?:\s|$)/i

interface Turn {
  text: string
  isUser: boolean
  tokens: number
}

/**
 * Compresses conversational text by parsing it into turns, preserving all turns,
 * and internally squeezing long Assistant/AI responses using TF-IDF.
 */
export function compressConversation(text: string, opts: ResolvedOptions): CompressorOutput {
  const lines = text.split('\n')
  const turns: Turn[] = []
  let currentTurnLines: string[] = []
  let isUser = false

  for (const line of lines) {
    if (SPEAKER_PATTERN.test(line)) {
      if (currentTurnLines.length > 0) {
        const turnText = currentTurnLines.join('\n')
        turns.push({
          text: turnText,
          isUser,
          tokens: countTokens(turnText, opts.model)
        })
        currentTurnLines = []
      }
      isUser = USER_SPEAKER_PATTERN.test(line)
    }
    currentTurnLines.push(line)
  }
  if (currentTurnLines.length > 0) {
    const turnText = currentTurnLines.join('\n')
    turns.push({
      text: turnText,
      isUser,
      tokens: countTokens(turnText, opts.model)
    })
  }

  let keptTurns = 0
  let compressedTurns = 0
  let firstCompressedTurnSample = ''
  const processedTurns: string[] = []

  for (const turn of turns) {
    // Short turns (<50 tokens) and User/Human turns are kept untouched.
    if (turn.tokens < 50 || turn.isUser) {
      keptTurns++
      processedTurns.push(turn.text)
    } else {
      // For assistant turns >= 50 tokens, run TF-IDF with targetRatio = 0.5
      const tfidfOpts: ResolvedOptions = { ...opts, targetRatio: 0.5 }
      const res = compressTfidf(turn.text, tfidfOpts)
      
      if (res.dropped.length > 0) {
        processedTurns.push(res.compressed)
        compressedTurns++
        if (!firstCompressedTurnSample) {
          firstCompressedTurnSample = res.dropped[0]?.sample || turn.text.slice(0, 100).replace(/\n/g, ' ')
        }
      } else {
        // TF-IDF decided not to compress it (e.g. too few sentences)
        keptTurns++
        processedTurns.push(turn.text)
      }
    }
  }

  const compressedText = processedTurns.join('\n')
  const dropped: DroppedItem[] = []

  if (compressedTurns > 0) {
    dropped.push({
      reason: `conversation:compressed ${compressedTurns} assistant turns internally`,
      count: compressedTurns,
      sample: firstCompressedTurnSample
    })
  }
  if (keptTurns > 0) {
    dropped.push({
      reason: `conversation:preserved ${keptTurns} turns untouched (user turns + short turns)`,
      count: keptTurns
    })
  }

  return {
    compressed: compressedText,
    dropped,
    transforms: [`conversation:turn-aware(${turns.length}turns,${compressedTurns}compressed)`]
  }
}

/**
 * Compresses conversational text asynchronously using the ML model.
 * Preserves all turns and internally squeezes long Assistant/AI responses using the ML compressor.
 */
export async function compressConversationAsync(text: string, opts: ResolvedOptions): Promise<CompressorOutput> {
  const lines = text.split('\n')
  const turns: Turn[] = []
  let currentTurnLines: string[] = []
  let isUser = false

  for (const line of lines) {
    if (SPEAKER_PATTERN.test(line)) {
      if (currentTurnLines.length > 0) {
        const turnText = currentTurnLines.join('\n')
        turns.push({
          text: turnText,
          isUser,
          tokens: countTokens(turnText, opts.model)
        })
        currentTurnLines = []
      }
      isUser = USER_SPEAKER_PATTERN.test(line)
    }
    currentTurnLines.push(line)
  }
  if (currentTurnLines.length > 0) {
    const turnText = currentTurnLines.join('\n')
    turns.push({
      text: turnText,
      isUser,
      tokens: countTokens(turnText, opts.model)
    })
  }

  let keptTurns = 0
  let compressedTurns = 0
  let firstCompressedTurnSample = ''
  const processedTurns: string[] = []

  let totalSentenceCount = 0

  for (const turn of turns) {
    if (opts.signal?.aborted) {
      throw new Error('Compression aborted by user')
    }
    // Short turns (<50 tokens) and User/Human turns are kept untouched.
    if (turn.tokens < 50 || turn.isUser) {
      keptTurns++
      processedTurns.push(turn.text)
    } else {
      // For assistant turns >= 50 tokens, run ML compressor
      const mlOpts: ResolvedOptions = { ...opts, targetRatio: 0.5 }
      const res = await compressML(turn.text, mlOpts)
      
      if (res.metrics?.sentenceCount) {
        totalSentenceCount += res.metrics.sentenceCount
      }
      
      if (res.dropped.length > 0) {
        processedTurns.push(res.compressed)
        compressedTurns++
        if (!firstCompressedTurnSample) {
          firstCompressedTurnSample = res.dropped[0]?.sample || turn.text.slice(0, 100).replace(/\n/g, ' ')
        }
      } else {
        keptTurns++
        processedTurns.push(turn.text)
      }
    }
  }

  const compressedText = processedTurns.join('\n')
  const dropped: DroppedItem[] = []

  if (compressedTurns > 0) {
    dropped.push({
      reason: `conversation:compressed ${compressedTurns} assistant turns internally`,
      count: compressedTurns,
      sample: firstCompressedTurnSample
    })
  }
  if (keptTurns > 0) {
    dropped.push({
      reason: `conversation:preserved ${keptTurns} turns untouched (user turns + short turns)`,
      count: keptTurns
    })
  }

  return {
    compressed: compressedText,
    dropped,
    transforms: [`conversation:turn-aware(${turns.length}turns,${compressedTurns}compressed)`],
    metrics: { sentenceCount: totalSentenceCount }
  }
}
