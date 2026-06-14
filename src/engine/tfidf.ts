/**
 * TF-IDF extractive text compressor.
 *
 * Scores every sentence by how much rare, informative content it carries
 * (TF-IDF averaged over its non-stopword terms), then keeps the highest
 * scoring sentences until a token budget is met — preserving meaning far
 * better than blind truncation on prose.
 *
 * Pipeline:
 *   1. Sentence segmentation (punctuation + blank-line boundaries, no reorder)
 *   2. Corpus building (tokenize, lowercase, strip punctuation, drop stopwords)
 *   3. TF-IDF scoring (average over terms) with a 1.4x importance boost
 *   4. Selection to a token budget, always keeping first/last/top-decile
 *   5. dropped[] population — the explainability differentiator
 *
 * Pure TypeScript, zero dependencies, fully deterministic.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'
import { countTokens } from './counter.js'
import { sample } from './utils.js'

/** Below this many sentences, prose is too short to compress meaningfully. */
const MIN_SENTENCES = 4
/** Below this many tokens, the input isn't worth extractive compression. */
const MIN_TOKENS = 80
/** Multiplier applied to sentences carrying an importance signal. */
const BOOST = 1.4
/** Fraction of top-scoring sentences always kept regardless of budget. */
const TOP_KEEP_FRACTION = 0.1

/** ~80 common English stopwords. Domain words (error, null, …) are NOT here. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'if', 'or', 'and', 'but', 'also', 'about', 'up', 'down',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these',
  'those', 'what', 'which', 'who', 'its', 'my', 'your', 'his', 'her', 'our',
  'their',
])

/** Words that signal a sentence is consequential and should be preserved. */
const IMPORTANCE_WORDS =
  /\b(error|errors|failed|fail|failure|warning|warn|critical|must|never|decided|decide|requires|require|cannot|important|note|caution|deprecated|breaking|null|undefined|exception|crash|security|vulnerability)\b/i

interface Sentence {
  /** Original position in the document (0-based), used for output ordering. */
  index: number
  /** Trimmed sentence text. */
  text: string
  /** The whitespace/newlines that followed this sentence in the original. */
  trailing: string
  /** Token count of this sentence's text. */
  tokens: number
  /** Final importance score (TF-IDF average, possibly boosted). */
  score: number
  /** Whether an importance signal boosted this sentence. */
  boosted: boolean
}

/**
 * Split prose into sentences without reordering.
 *
 * Boundaries are: a sentence terminator (`. ! ?`, optionally followed by a
 * closing quote/bracket) followed by whitespace and a capital/digit/quote, OR
 * a blank line separating paragraphs. The terminating punctuation stays
 * attached to the sentence it ends. Each sentence records the separator that
 * followed it so output can preserve the original layout.
 */
function splitSentences(input: string): Array<Pick<Sentence, 'index' | 'text' | 'trailing'>> {
  const out: Array<Pick<Sentence, 'index' | 'text' | 'trailing'>> = []
  // Group 1+2: terminator + trailing space before a capital/digit/quote.
  // Group 3: a blank line (paragraph boundary).
  const boundary = /([.!?]+["')\]]?)([ \t]+|\n)(?=["'([]?[A-Z0-9])|(\n[ \t]*\n+)/g
  let lastIndex = 0
  let idx = 0
  let m: RegExpExecArray | null
  while ((m = boundary.exec(input)) !== null) {
    let text: string
    let trailing: string
    if (m[3] !== undefined) {
      // Paragraph (blank-line) boundary — the whole match is whitespace.
      text = input.slice(lastIndex, m.index)
      trailing = m[3]
    } else {
      // Punctuation boundary — keep the punctuation with this sentence.
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

/** Tokenize into lowercase content words, stripping punctuation and stopwords. */
export function contentWords(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

export function hasImportanceSignal(text: string): boolean {
  // Only boost for meaningful numeric data: prices, percentages, versions,
  // measurements with units, error codes — NOT plain ordinals like "Step 1"
  if (/[$₹€£¥]\s*[\d,.]+|\d+(\.\d+)?%|\bv?\d+\.\d+(\.\d+)?\b/.test(text)) return true
  if (/\b\d+(\.\d+)?\s*(kg|lbs|kcal|g|mg|cm|mm|reps|sets|sec|min|hrs?|km|m)\b/i.test(text)) return true
  if (/\b\d{3,}\b/.test(text)) return true // 3+ digit numbers (prices, codes, IDs)
  if (/\?/.test(text)) return true // questions are usually important
  if (IMPORTANCE_WORDS.test(text)) return true // decisions / errors / warnings
  return false
}

/** Reassemble kept sentences in original order, preserving layout sanely. */
function reassemble(kept: Sentence[]): string {
  let result = ''
  for (let i = 0; i < kept.length; i++) {
    result += kept[i].text
    if (i < kept.length - 1) {
      const sep = kept[i].trailing
      if (sep.includes('\n')) {
        // Preserve paragraph breaks, collapsing 3+ newlines to a blank line.
        result += sep.replace(/\n{3,}/g, '\n\n')
      } else {
        result += ' '
      }
    }
  }
  return result
}

export function compressTfidf(text: string, opts: ResolvedOptions): CompressorOutput {
  const totalTokens = countTokens(text, opts.model)
  const raw = splitSentences(text)

  // ── Passthrough for short inputs ────────────────────────────────────────
  if (raw.length < MIN_SENTENCES || totalTokens < MIN_TOKENS) {
    return { 
      compressed: text, 
      dropped: [], 
      transforms: ['tfidf:passthrough'],
      metrics: {
        originalSentenceCount: raw.length,
        retainedSentenceCount: raw.length,
      }
    }
  }

  // ── Stage 2: corpus + document frequencies ──────────────────────────────
  const N = raw.length
  const df = new Map<string, number>()
  const perSentenceWords: string[][] = raw.map((s) => contentWords(s.text))
  for (const words of perSentenceWords) {
    for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1)
  }

  // ── Stage 3: TF-IDF scoring with importance boost ───────────────────────
  const sentences: Sentence[] = raw.map((s, i) => {
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
    const boosted = hasImportanceSignal(s.text)
    if (boosted) score *= BOOST
    return {
      ...s,
      tokens: countTokens(s.text, opts.model),
      score,
      boosted,
    }
  })

  // ── Stage 4: selection to a token budget ────────────────────────────────
  // Convention (matches text-compressor): targetRatio = fraction to REMOVE,
  // so we keep roughly (1 - targetRatio) of the original tokens.
  const keepBudget = Math.max(1, Math.floor(totalTokens * (1 - opts.targetRatio)))

  // Always-keep: first sentence, last sentence, the top decile by score, and
  // every sentence carrying an importance signal (numbers, errors, decisions,
  // named entities, questions) — these are never dropped regardless of budget.
  const byScore = [...sentences].sort((a, b) => b.score - a.score)
  const topKeepCount = Math.max(1, Math.floor(N * TOP_KEEP_FRACTION))
  const keepSet = new Set<number>()
  keepSet.add(sentences[0].index)
  keepSet.add(sentences[N - 1].index)
  for (let i = 0; i < topKeepCount; i++) keepSet.add(byScore[i].index)
  for (const s of sentences) {
    if (s.boosted) keepSet.add(s.index)
  }

  // Greedily add highest-scoring sentences until the budget is reached.
  let keptTokens = 0
  for (const idx of keepSet) keptTokens += sentences[idx].tokens
  for (const s of byScore) {
    if (keptTokens >= keepBudget) break
    if (!keepSet.has(s.index)) {
      keepSet.add(s.index)
      keptTokens += s.tokens
    }
  }

  const kept = sentences.filter((s) => keepSet.has(s.index)).sort((a, b) => a.index - b.index)
  const droppedSentences = sentences.filter((s) => !keepSet.has(s.index))
  const droppedCount = droppedSentences.length

  // Nothing dropped → report passthrough so the caller can decide to fall back.
  if (droppedCount === 0) {
    return { 
      compressed: text, 
      dropped: [], 
      transforms: ['tfidf:passthrough'],
      metrics: {
        originalSentenceCount: N,
        retainedSentenceCount: N,
      }
    }
  }

  // ── Stage 5: dropped[] population ───────────────────────────────────────
  const compressed = reassemble(kept)
  const dropped: DroppedItem[] = [
    {
      reason: `TF-IDF: removed ${droppedCount} low-importance sentences`,
      count: droppedCount,
      sample: sample(droppedSentences[0].text),
    },
  ]
  const boostedKept = kept.filter((s) => s.boosted).length
  if (boostedKept > 0) {
    dropped.push({
      reason: `TF-IDF: preserved ${boostedKept} sentences by importance signal (numbers, errors, decisions)`,
      count: boostedKept,
    })
  }

  return {
    compressed,
    dropped,
    transforms: [`tfidf:extractive(${N}sentences->${kept.length}sentences)`],
    metrics: {
      originalSentenceCount: N,
      retainedSentenceCount: kept.length,
    },
  }
}
