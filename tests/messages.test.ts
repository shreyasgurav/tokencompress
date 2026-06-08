import { describe, it, expect } from 'vitest'
import { compressMessages } from '../src/compress.js'
import type { Message } from '../src/types.js'

function bigJsonArray(): string {
  const arr = Array.from({ length: 200 }, (_, i) => ({ id: i, status: 'ok', value: i % 3 }))
  return JSON.stringify(arr)
}

describe('compressMessages policy', () => {
  it('compresses all messages by default', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: bigJsonArray() },
    ]
    const out = compressMessages(msgs)
    expect(out[1].content.length).toBeLessThan(msgs[1].content.length)
    expect(out).toHaveLength(2)
    expect(out[0].role).toBe('system')
  })

  it('protects the last N messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: bigJsonArray() },
      { role: 'assistant', content: bigJsonArray() },
    ]
    const out = compressMessages(msgs, { protectRecent: 1 })
    expect(out[0].content.length).toBeLessThan(msgs[0].content.length)
    expect(out[1].content).toBe(msgs[1].content)
  })

  it('skips user messages when compressUserMessages is false', () => {
    const msgs: Message[] = [{ role: 'user', content: bigJsonArray() }]
    const out = compressMessages(msgs, { compressUserMessages: false })
    expect(out[0].content).toBe(msgs[0].content)
  })

  it('skips system messages when compressSystemMessages is false', () => {
    const msgs: Message[] = [{ role: 'system', content: bigJsonArray() }]
    const out = compressMessages(msgs, { compressSystemMessages: false })
    expect(out[0].content).toBe(msgs[0].content)
  })

  it('skips messages below minTokensToCompress', () => {
    const msgs: Message[] = [{ role: 'user', content: bigJsonArray() }]
    const out = compressMessages(msgs, { minTokensToCompress: 1_000_000 })
    expect(out[0].content).toBe(msgs[0].content)
  })
})
