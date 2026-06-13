import { pipeline, env } from '@xenova/transformers'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { countTokens } from '../tokens/counter.js'
import { sample } from './shared.js'
import { contentWords, hasImportanceSignal } from './tfidf-compressor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Configure transformers.js to load the local ONNX model
env.allowLocalModels = true
env.allowRemoteModels = false
env.useBrowserCache = false // Node only

// Set the base directory where our models are stored.
// __dirname here is dist/compressors/ at runtime
env.localModelPath = path.resolve(__dirname, '../../model/output')

let classifierPipelinePromise: Promise<any> | null = null

async function getPipeline() {
  if (!classifierPipelinePromise) {
    classifierPipelinePromise = (async () => {
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
                intraOpNumThreads: Math.max(2, Math.min(os.cpus().length, 8)), // auto-detect cores, cap at 8
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
      // tokencompress-minilm = MiniLM-L6 fine-tuned + INT8 quantized (22MB, ~15x faster than RoBERTa)
      return await pipeline('text-classification', 'tokencompress-minilm', {
        local_files_only: true,
        quantized: true, // Use the dynamically quantized model (model_quantized.onnx)
      })
    })()
  }
  return classifierPipelinePromise
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

function reassemble(kept: Array<Pick<Sentence, 'index' | 'text' | 'trailing'>>): string {
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

  const N = raw.length

  // Pre-filter with TF-IDF heuristics
  const df = new Map<string, number>()
  const perSentenceWords: string[][] = raw.map((s) => contentWords(s.text))
  for (const words of perSentenceWords) {
    for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1)
  }

  const tfidfScores = raw.map((_s, i) => {
    const words = perSentenceWords[i]
    let score = 0
    if (words.length > 0) {
      const tf = new Map<string, number>()
      for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1)
      let sum = 0
      for (const [w, count] of tf) {
        const termFreq = count / words.length
        const idf = Math.log(N / (df.get(w) ?? 1))
        sum += termFreq * idf * count
      }
      score = sum / words.length
    }
    return score
  })

  // Determine thresholds for Auto-Keep and Auto-Drop
  const sortedScores = [...tfidfScores].sort((a, b) => a - b)
  const p40 = sortedScores[Math.floor(N * 0.4)] || 0
  const p85 = sortedScores[Math.floor(N * 0.85)] || 0

  const autoKeep = new Set<number>()
  const autoDrop = new Set<number>()
  const ambiguous: typeof raw = []

  for (let i = 0; i < N; i++) {
    const s = raw[i]
    const score = tfidfScores[i]
    const hasSignal = hasImportanceSignal(s.text)
    
    const text = s.text.trim();
    // Preserve speaker tags for all major AI models
    const isSpeakerTag = 
      // Standard text-based roles (OpenAI, Anthropic, Gemini, generic)
      /^(User|ChatGPT|Assistant|System|Human|AI|Model)\s*:/i.test(text) || 
      /^\*\*(User|ChatGPT|Assistant|System|Human|AI|Model)\*\*\s*:/i.test(text) ||
      // Llama 2 tags
      /\[\/?INST\]/i.test(text) || 
      /<<\/?SYS>>/i.test(text) ||
      // Llama 3 headers
      /<\|start_header_id\|>.*?<\|end_header_id\|>/.test(text) ||
      /<\|eot_id\|>/.test(text) ||
      // XML-like structural tags (often used by Claude) at start of sentence
      /^<\/?(instructions|context|example|input|output|system)>/i.test(text) ||
      // Only top-level markdown headers (# or ##) which indicate major section breaks,
      // NOT sub-headers (###, ####) which are often decorative inside AI responses.
      /^#{1,2}\s/.test(text);

    if (i === 0 || i === N - 1 || isSpeakerTag) {
      autoKeep.add(s.index)
    } else if (score >= p85) {
      autoKeep.add(s.index)
    } else if (score <= p40 && !hasSignal && s.text.length < 200) {
      autoDrop.add(s.index)
    } else {
      ambiguous.push(s)
    }
  }

  // Only run ML model on ambiguous sentences
  // Store probabilities instead of immediately keeping
  const ambiguousWithProb: { s: Pick<Sentence, 'index' | 'text' | 'trailing'>; prob: number }[] = []
  
  // Build O(1) lookup map for sentence indices (avoids O(N²) findIndex in batch loop)
  const indexMap = new Map<number, number>()
  for (let i = 0; i < raw.length; i++) indexMap.set(raw[i].index, i)

  if (ambiguous.length > 0) {
    const classifier = await getPipeline()
    const batchSize = 64
    
    for (let i = 0; i < ambiguous.length; i += batchSize) {
      if (opts.signal?.aborted) {
        throw new Error('Compression aborted by user')
      }
      
      const chunk = ambiguous.slice(i, i + batchSize)
      const inputStrings = chunk.map((s) => {
        const globalIdx = indexMap.get(s.index)!
        const prev = globalIdx > 0 ? raw[globalIdx - 1].text : ''
        const next = globalIdx < raw.length - 1 ? raw[globalIdx + 1].text : ''
        const context = `${prev} ${s.text} ${next}`.trim()
        return `[SENTENCE] ${s.text} [CONTEXT] ${context}`.slice(0, 500)
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
          prob = 1.0 - output.score
        }
        
        ambiguousWithProb.push({ s, prob })
      }
    }
  }

  // Enforce the token budget
  const keepBudget = Math.max(1, Math.floor(totalTokens * (1 - opts.targetRatio)))
  let keptTokens = 0
  const finalKeepSet = new Set<number>([...autoKeep])
  
  // Account for tokens already kept in autoKeep
  for (const s of raw) {
    if (finalKeepSet.has(s.index)) {
      keptTokens += countTokens(s.text, opts.model)
    }
  }

  // Greedily add the highest probability ambiguous sentences until budget is hit
  ambiguousWithProb.sort((a, b) => b.prob - a.prob)
  
  for (const item of ambiguousWithProb) {
    if (keptTokens >= keepBudget) break
    finalKeepSet.add(item.s.index)
    keptTokens += countTokens(item.s.text, opts.model)
  }
  const kept = raw.filter((s) => finalKeepSet.has(s.index))
  const droppedSentences = raw.filter((s) => !finalKeepSet.has(s.index))
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
    transforms: [`ml:minilm(${raw.length}sentences->${kept.length}sentences)`],
    metrics: { sentenceCount: raw.length },
  }
}
