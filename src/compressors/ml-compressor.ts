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
    // Monkey-patch onnxruntime-node to configure thread count for CPU inference
    if (typeof process !== 'undefined' && process?.release?.name === 'node') {
      try {
        const ort = await import('onnxruntime-node')
        const ortModule = (ort as any).default ?? ort
        const originalCreate = ortModule.InferenceSession?.create
        if (originalCreate && !(originalCreate as any).__isPatched) {
          const patched = async function(modelPathOrBuffer: any, options: any) {
            const customOptions = {
              ...options,
              intraOpNumThreads: 4, // limit to 4 threads to prevent overheating and context-switching overhead
              interOpNumThreads: 1
            }
            return originalCreate.call(ortModule.InferenceSession, modelPathOrBuffer, customOptions)
          }
          ;(patched as any).__isPatched = true
          ortModule.InferenceSession.create = patched
        }
      } catch (err) {
        console.warn('Failed to monkeypatch onnxruntime-node session options:', err)
      }
    }

    console.log('Loading ML model from:', env.localModelPath)
    // Point to the root model folder (where tokenizer.json lives)
    // transformers.js will automatically look in the 'onnx/' subfolder for model.onnx
    classifierPipeline = await pipeline('text-classification', 'tokencompress-base', {
      local_files_only: true,
      quantized: true, // Use the dynamically quantized model
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

  const batchSize = 1
  for (let i = 0; i < raw.length; i += batchSize) {
    const chunk = raw.slice(i, i + batchSize)
    const inputStrings = chunk.map((s, chunkIdx) => {
      const globalIdx = i + chunkIdx
      const prev = globalIdx > 0 ? raw[globalIdx - 1].text : ''
      const next = globalIdx < raw.length - 1 ? raw[globalIdx + 1].text : ''
      const context = `${prev} ${s.text} ${next}`.trim()
      return `[SENTENCE] ${s.text} [CONTEXT] ${context}`.slice(0, 1500)
    })

    const outputs = await classifier(inputStrings)
    const outputsArray = Array.isArray(outputs) ? outputs : [outputs]

    for (let chunkIdx = 0; chunkIdx < chunk.length; chunkIdx++) {
      const s = chunk[chunkIdx]
      const output = outputsArray[chunkIdx]
      let prob = 0
      if (output.label === 'LABEL_1') {
        prob = output.score
      } else {
        prob = 1.0 - output.score // LABEL_0 is filler
      }

      sentences.push({
        ...s,
        tokens: 0,
        score: prob,
      })
    }
  }

  // Instead of a strict token budget (which forces dropping important content if the document is dense),
  // we use the targetRatio as a confidence threshold. A 50% target ratio means we keep prob >= 0.5.
  const threshold = 1.0 - opts.targetRatio

  const byScore = [...sentences].sort((a, b) => b.score - a.score)
  const topKeepCount = Math.max(1, Math.floor(sentences.length * 0.1)) // Top 10% always kept

  const keepSet = new Set<number>()
  keepSet.add(sentences[0].index)
  keepSet.add(sentences[sentences.length - 1].index)
  for (let i = 0; i < topKeepCount; i++) keepSet.add(byScore[i].index)

  // Keep any sentence that the ML model predicted as important
  for (const s of sentences) {
    if (s.score >= threshold) {
      keepSet.add(s.index)
    }
  }

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
