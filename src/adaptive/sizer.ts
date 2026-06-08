/**
 * Adaptive sizing via information-saturation detection.
 *
 * Instead of hardcoded keep-counts ("keep 10 matches per file"), we
 * statistically decide how many items carry genuinely new information and
 * keep exactly that many. Items are assumed to arrive in importance order.
 *
 * Algorithm (three tiers):
 *   1. Fast path — trivial sizes and near-total redundancy.
 *   2. Kneedle — find the "knee" of the cumulative unique-bigram curve,
 *      i.e. the point where adding more items stops adding information.
 *   3. Diversity floor — never drop below what the unique-content ratio
 *      justifies, so highly-diverse inputs are barely touched.
 *
 * This is pure arithmetic — no ML model, no native dependency.
 */

/** Tunables for {@link computeOptimalK}. */
export interface AdaptiveOptions {
  /** Multiplier on the knee. >1 keeps more (conservative), <1 keeps fewer. */
  bias?: number
  /** Never return fewer than this. */
  minK?: number
  /** Never return more than this. Defaults to items.length. */
  maxK?: number
}

/**
 * Compute the optimal number of leading items to keep.
 *
 * @param items String representations of items, in importance order.
 * @returns A keep-count between `minK` and `maxK`.
 */
export function computeOptimalK(items: string[], options: AdaptiveOptions = {}): number {
  const n = items.length
  const bias = options.bias ?? 1.0
  const minK = options.minK ?? 3
  const maxK = options.maxK ?? n

  // Tier 1: fast path for trivially small inputs.
  if (n <= 8) return Math.min(n, maxK)

  // Near-total redundancy: a handful of distinct items repeated.
  const unique = countUnique(items)
  if (unique <= 3) {
    return clamp(Math.max(minK, unique), minK, maxK)
  }

  // Tier 2: Kneedle on the unique-bigram coverage curve.
  const curve = uniqueBigramCurve(items)
  let knee = findKnee(curve)

  // What fraction of items are genuinely distinct?
  const diversity = unique / n

  if (knee === null) {
    // No saturation — every item adds information. Scale with diversity:
    //   diversity 1.0 → keep 100%; 0.5 → ~65%; 0.0 → ~30%.
    const keepFraction = 0.3 + 0.7 * diversity
    knee = Math.max(minK, Math.floor(n * keepFraction))
  } else if (diversity > 0.7) {
    // High diversity can produce a weak (shallow) knee. Don't drop below
    // the diversity floor.
    const floor = Math.max(minK, Math.floor(n * (0.3 + 0.7 * diversity)))
    knee = Math.max(knee, floor)
  }

  const k = Math.max(minK, Math.floor(knee * bias))
  return clamp(k, minK, maxK)
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi))
}

/**
 * Find the knee of a monotonically-increasing curve using the Kneedle
 * method: normalise to the unit square, return the index whose vertical
 * distance above the diagonal is greatest. Returns null if the curve has no
 * meaningful bend (i.e. roughly linear — every item adds information).
 */
export function findKnee(curve: number[]): number | null {
  const n = curve.length
  if (n < 3) return null

  const yMin = curve[0]
  const yMax = curve[n - 1]
  if (yMax === yMin) return 1 // flat — all items identical

  const xRange = n - 1
  const yRange = yMax - yMin

  let maxDiff = -1
  let kneeIdx: number | null = null
  for (let i = 0; i < n; i++) {
    const xNorm = i / xRange
    const yNorm = (curve[i] - yMin) / yRange
    const diff = yNorm - xNorm
    if (diff > maxDiff) {
      maxDiff = diff
      kneeIdx = i
    }
  }

  // Require a real deviation from the diagonal.
  if (maxDiff < 0.05) return null
  return kneeIdx === null ? null : kneeIdx + 1
}

/**
 * Build the cumulative unique word-bigram coverage curve. `curve[k]` is the
 * number of distinct bigrams seen across `items[0..=k]`.
 */
export function uniqueBigramCurve(items: string[]): number[] {
  const seen = new Set<string>()
  const curve: number[] = []
  for (const item of items) {
    const words = item.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length < 2) {
      seen.add(words[0] ?? '')
    } else {
      for (let i = 0; i < words.length - 1; i++) {
        seen.add(`${words[i]}\u0000${words[i + 1]}`)
      }
    }
    curve.push(seen.size)
  }
  return curve
}

/**
 * Count distinct items via SimHash near-duplicate clustering. Items whose
 * 64-bit fingerprints are within `threshold` Hamming distance collapse into
 * one group, so "same line, different timestamp" counts once.
 */
export function countUnique(items: string[], threshold = 3): number {
  if (items.length === 0) return 0
  const clusters: bigint[] = []
  for (const item of items) {
    const fp = simhash(item)
    let matched = false
    for (const rep of clusters) {
      if (hamming(fp, rep) <= threshold) {
        matched = true
        break
      }
    }
    if (!matched) clusters.push(fp)
  }
  return clusters.length
}

/** 64-bit SimHash over character 4-grams using a fast string hash. */
function simhash(text: string): bigint {
  const v = new Array<number>(64).fill(0)
  const lower = text.toLowerCase()
  const limit = Math.max(1, lower.length - 3)
  for (let i = 0; i < limit; i++) {
    const gram = lower.slice(i, i + 4)
    const h = hash64(gram)
    for (let j = 0; j < 64; j++) {
      if ((h >> BigInt(j)) & 1n) v[j] += 1
      else v[j] -= 1
    }
  }
  let fp = 0n
  for (let j = 0; j < 64; j++) {
    if (v[j] > 0) fp |= 1n << BigInt(j)
  }
  return fp
}

/** Deterministic 64-bit FNV-1a hash of a short string. */
function hash64(s: string): bigint {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * prime) & mask
  }
  return h
}

/** Population count of the XOR — number of differing bits. */
function hamming(a: bigint, b: bigint): number {
  let x = a ^ b
  let count = 0
  while (x > 0n) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}
