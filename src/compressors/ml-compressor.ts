import { pipeline, env } from '@xenova/transformers'
import path from 'path'
import { fileURLToPath } from 'url'
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { countTokens } from '../tokens/counter.js'
import { sample } from './shared.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Configure transformers.js to load the local ONNX model
env.allowLocalModels = true
env.allowRemoteModels = false
env.useBrowserCache = false // Node only

// Set the base directory where our models are stored.
// __dirname here is dist/compressors/ at runtime
env.localModelPath = path.resolve(__dirname, '../../model/output')

let classifierPipeline: any = null

async function getPipeline() {
  if (!classifierPipeline) {
    console.log('Loading ML model from:', env.localModelPath)
    // Point to the root model folder (where tokenizer.json lives)
    // transformers.js will automatically look in the 'onnx/' subfolder for model.onnx
    classifierPipeline = await pipeline('text-classification', 'tokencompress-base', {
      local_files_only: true,
      quantized: false, // We exported an unquantized model.onnx
    })
  }
  return classifierPipeline
}

interface Sentence {
  index: number
  text: string
  trailing: string
  tokens: number
  score: number
}

function splitSentences(input: string): Array<Pick<Sentence, 'index' | 'text' | 'trailing'>> {
  const out: Array<Pick<Sentence, 'index' | 'text' | 'trailing'>> = []
  const boundary = /([.!?]+["')\]]?)([ \t]+|\n)(?=["'([]?[A-Z0-9])|(\n[ \t]*\n+)/g
  let lastIndex = 0
  let idx = 0
  let m: RegExpExecArray | null
  while ((m = boundary.exec(input)) !== null) {
    let text: string
    let trailing: string
    if (m[3] !== undefined) {
      text = input.slice(lastIndex, m.index)
      trailing = m[3]
    } else {
      text = input.slice(lastIndex, m.index + m[1].length)
      trailing = m[2]
    }
    if (text.trim().length > 0) out.push({ index: idx++, text: text.trim(), trailing })
    lastIndex = m.index + m[0].length
  }
  const tail = input.slice(lastIndex)
  if (tail.trim().length > 0) out.push({ index: idx++, text: tail.trim(), trailing: '' })
  return out
}

function reassemble(kept: Sentence[]): string {
  let result = ''
  for (let i = 0; i < kept.length; i++) {
    result += kept[i].text
    if (i < kept.length - 1) {
      const sep = kept[i].trailing
      if (sep.includes('\n')) {
        result += sep.replace(/\n{3,}/g, '\n\n')
      } else {
        result += ' '
      }
    }
  }
  return result
}

export async function compressML(text: string, opts: ResolvedOptions): Promise<CompressorOutput> {
  const totalTokens = countTokens(text, opts.model)
  const raw = splitSentences(text)

  if (raw.length < 3 || totalTokens < 40) {
    return {
      compressed: text,
      dropped: [],
      transforms: ['ml:passthrough'],
    }
  }

  const classifier = await getPipeline()
  const sentences: Sentence[] = []

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    
    // Build context window
    const prev = i > 0 ? raw[i - 1].text : ''
    const next = i < raw.length - 1 ? raw[i + 1].text : ''
    const context = `${prev} ${s.text} ${next}`.trim()
    
    // The exact format our model was trained on
    const inputStr = `[SENTENCE] ${s.text} [CONTEXT] ${context}`
    
    // Run inference (slice to prevent tokenizer overflow)
    const output = await classifier(inputStr.slice(0, 1500))
    
    let prob = 0
    if (output[0].label === 'LABEL_1') {
      prob = output[0].score
    } else {
      prob = 1.0 - output[0].score // LABEL_0 is filler
    }

    sentences.push({
      ...s,
      tokens: countTokens(s.text, opts.model),
      score: prob,
    })
  }

  const threshold = 0.5 // Model was trained on binary 0=filler, 1=important
  
  // Always keep first and last sentence for safety
  const keepSet = new Set<number>()
  keepSet.add(sentences[0].index)
  keepSet.add(sentences[sentences.length - 1].index)

  for (const s of sentences) {
    if (s.score >= threshold) {
      keepSet.add(s.index)
    }
  }

  // Ensure we at least satisfy our budget roughly (fallback safety)
  // If we dropped too much, we could add sentences back, but the ML model should be trusted.

  const kept = sentences.filter((s) => keepSet.has(s.index)).sort((a, b) => a.index - b.index)
  const droppedSentences = sentences.filter((s) => !keepSet.has(s.index))
  const droppedCount = droppedSentences.length

  if (droppedCount === 0) {
    return {
      compressed: text,
      dropped: [],
      transforms: ['ml:passthrough'],
    }
  }

  const compressed = reassemble(kept)
  const dropped: DroppedItem[] = [
    {
      reason: `ML Filter: removed ${droppedCount} conversational filler/noise sentences`,
      count: droppedCount,
      sample: sample(droppedSentences[0].text),
    },
  ]

  return {
    compressed,
    dropped,
    transforms: [`ml:roberta(${raw.length}sentences->${kept.length}sentences)`],
  }
}
