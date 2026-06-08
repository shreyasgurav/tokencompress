/**
 * TF-IDF extractive text compressor — validation suite.
 *
 * Verifies the prose route: important sentences (numbers, errors, decisions)
 * are always preserved, low-importance filler is dropped to hit the token
 * budget, short inputs pass through untouched, and reading order is kept.
 */
import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

// ── Generators ──────────────────────────────────────────────────────────────

const COMPONENTS = [
  'authentication', 'billing', 'scheduler', 'ingestion', 'analytics',
  'notification', 'storage', 'gateway', 'rendering', 'replication',
  'indexing', 'checkout', 'telemetry', 'migration', 'webhook',
  'throttling', 'caching', 'federation', 'reconciliation', 'provisioning',
]

/** 20 distinctive, high-signal sentences (numbers + decision/error words). */
function importantSentences(): string[] {
  return COMPONENTS.map(
    (c, i) =>
      `Critical error E${1000 + i}: the ${c} service failed after ${3 + i} retries so we decided to roll back release ${i + 1}.`,
  )
}

/** 80 generic, low-signal filler sentences — no numbers, no entities. */
function fillerSentences(): string[] {
  const subjects = ['the team', 'the process', 'the workflow', 'the routine']
  const verbs = ['continued to proceed', 'moved along quietly', 'kept running smoothly', 'went ahead as usual']
  const tails = [
    'without anything worth mentioning happening here',
    'and nothing of particular interest occurred then',
    'while everyone simply carried on as before',
    'in a calm and largely uneventful fashion',
  ]
  const out: string[] = []
  for (let i = 0; i < 80; i++) {
    const s = subjects[i % subjects.length]
    const v = verbs[(i >> 1) % verbs.length]
    const t = tails[(i >> 2) % tails.length]
    out.push(`Then ${s} ${v} ${t}.`)
  }
  return out
}

/** Interleave important + filler into a 100-sentence document. */
function makeTechnicalDoc(): string {
  const important = importantSentences()
  const filler = fillerSentences()
  const sentences: string[] = []
  let imp = 0
  for (let i = 0; i < 100; i++) {
    if (i % 5 === 0 && imp < important.length) sentences.push(important[imp++])
    else sentences.push(filler[i - imp] ?? filler[i % filler.length])
  }
  return sentences.join(' ')
}

/** 60-sentence plain-prose conversation transcript (low signal, varied). */
function makeConversation(): string {
  const lines: string[] = []
  const topics = [
    'the connection pool settings', 'the retry behaviour', 'the cache layer',
    'the request timeout', 'the logging format', 'the rollout plan',
    'the rollback steps', 'the staging setup', 'the queue depth', 'the worker count',
  ]
  for (let i = 0; i < 60; i++) {
    const topic = topics[i % topics.length]
    if (i % 2 === 0) {
      lines.push(`Could you walk me through how ${topic} is meant to behave in the common case here.`)
    } else {
      lines.push(`Sure, it mostly just keeps things steady and rarely needs any manual attention at all.`)
    }
  }
  return lines.join(' ')
}

/** Short 4-sentence input — must pass through untouched. */
function makeShortInput(): string {
  return 'This is the first short sentence. This is the second one here. A third follows along now. And here is the fourth.'
}

/** 50 lorem-style filler sentences — no numbers, no mid-sentence capitals. */
function makeAllFiller(): string {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod tempor incididunt labore dolore magna aliqua enim minim veniam quis nostrud'.split(' ')
  const out: string[] = []
  for (let i = 0; i < 50; i++) {
    const len = 10 + (i % 8)
    const body: string[] = []
    for (let j = 0; j < len; j++) body.push(words[(i * 3 + j) % words.length])
    const sentence = body.join(' ')
    out.push(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.')
  }
  return out.join(' ')
}

/** 30 sentences that are ALL high-signal (errors, decisions, numbers). */
function makeAllImportant(): string {
  const out: string[] = []
  for (let i = 0; i < 30; i++) {
    out.push(
      `Critical error code ${500 + i} occurred and we decided the ${COMPONENTS[i % COMPONENTS.length]} service must never retry more than ${2 + i} times.`,
    )
  }
  return out.join(' ')
}

/** 10 numbered sentences for reading-order verification. */
function makeNumberedDoc(): string {
  return Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1} carries some unique payload term zeta${i}.`).join(' ')
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TF-IDF extractive compressor — validation', () => {
  it('Test 1 — technical doc (100 sentences): all 20 important kept, ≥40% saved, ≥50 dropped', () => {
    const input = makeTechnicalDoc()
    const r = compress(input, { targetRatio: 0.6 })

    expect(r.contentType, 'should route as text').toBe('text')

    // All 20 important sentences must survive (unique error codes E1000..E1019).
    for (let i = 0; i < 20; i++) {
      expect(r.compressed, `important sentence E${1000 + i} must be preserved`).toContain(`E${1000 + i}`)
    }

    expect(r.tokensAfter, 'must reduce to under 60% of original tokens').toBeLessThan(r.tokensBefore * 0.6)

    const removed = r.dropped.find((d) => d.reason.includes('removed'))
    expect(removed, 'must report removed low-importance sentences').toBeDefined()
    expect(removed!.count, 'must drop at least 50 sentences').toBeGreaterThanOrEqual(50)
  })

  it('Test 2 — conversation transcript (60 sentences): ≥25% saved, first and last preserved, no crash', () => {
    const input = makeConversation()
    const r = compress(input, { targetRatio: 0.4 })

    expect(r.compressionRatio, 'must save at least 25% of tokens').toBeGreaterThanOrEqual(0.25)
    expect(r.compressed, 'first sentence must remain').toContain('Could you walk me through how the connection pool settings')
    expect(r.compressed.length, 'output must be shorter').toBeLessThan(r.original.length)
  })

  it('Test 3 — short input (4 sentences): passthrough, nothing dropped', () => {
    const input = makeShortInput()
    const r = compress(input)

    expect(r.tokensAfter, 'short input must not be compressed').toBe(r.tokensBefore)
    expect(r.tokensSaved, 'no tokens saved on short input').toBe(0)
    expect(r.dropped.length, 'nothing dropped from short input').toBe(0)
  })

  it('Test 4 — all filler (50 lorem sentences): ≥40% saved, shorter, no crash', () => {
    const input = makeAllFiller()
    const r = compress(input, { targetRatio: 0.5 })

    expect(r.compressionRatio, 'must save at least 40% of tokens').toBeGreaterThanOrEqual(0.4)
    expect(r.compressed.length, 'output must be shorter').toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
  })

  it('Test 5 — all important (errors/decisions/numbers): conservative, every sentence preserved', () => {
    const input = makeAllImportant()
    const r = compress(input, { targetRatio: 0.5 })

    expect(r.tokensAfter, 'compression must be conservative — keep >60% tokens').toBeGreaterThan(r.tokensBefore * 0.6)
    for (let i = 0; i < 30; i++) {
      expect(r.compressed, `important sentence with code ${500 + i} must be preserved`).toContain(`${500 + i}`)
    }
  })

  it('Test 6 — reading order preserved: kept numbered sentences stay ascending', () => {
    const input = makeNumberedDoc()
    const r = compress(input, { targetRatio: 0.5 })

    const nums = [...r.compressed.matchAll(/Sentence (\d+)/g)].map((m) => Number(m[1]))
    expect(nums.length, 'at least two sentences should remain to check order').toBeGreaterThan(1)
    const sorted = [...nums].sort((a, b) => a - b)
    expect(nums, 'sentences must appear in original ascending order').toEqual(sorted)
  })
})
