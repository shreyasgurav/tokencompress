import { describe, expect, it } from 'vitest'
import { compressConversation } from '../../src/compressors/conversation-compressor.js'
import { resolveOptions } from '../../src/types.js'

describe('conversation compressor', () => {
  it('preserves all turns, keeps user turns untouched, and compresses long assistant turns', () => {
    // Generate a long assistant response to ensure it hits the 50-token threshold
    // and has enough sentences for TF-IDF to actually drop some.
    const longAssistantContent = `This is a very long assistant response. It contains a lot of detailed information that is useful but somewhat verbose. The user asked a simple question, but I am providing an exhaustive overview. For instance, testing frameworks are critical. They help catch bugs early. Another sentence here. And some more filler to make sure this turn has enough sentences and tokens to trigger the tf-idf compressor's minimum thresholds. We really need this to be longer. Let's add some more text right now. This should be enough.`
    
    const input = `User: What is mcpunit?
Assistant: ${longAssistantContent}
User: Got it, thanks!
Assistant: You're welcome!`

    const opts = resolveOptions()
    const res = compressConversation(input, opts)

    // 1. Every turn is present
    expect(res.compressed).toContain('User: What is mcpunit?')
    expect(res.compressed).toContain('Assistant: ')
    expect(res.compressed).toContain('User: Got it, thanks!')
    expect(res.compressed).toContain('Assistant: You\'re welcome!')

    // 2. User turns are never compressed
    expect(res.compressed).toContain('User: What is mcpunit?')
    expect(res.compressed).toContain('User: Got it, thanks!')

    // 3. Long assistant turns are shorter
    const originalAssistantTurnLength = `Assistant: ${longAssistantContent}`.length
    const compressedAssistantTurnMatch = res.compressed.match(/Assistant: (.*?)(\nUser:|$)/s)
    expect(compressedAssistantTurnMatch).not.toBeNull()
    if (compressedAssistantTurnMatch) {
      const compressedTurnLength = compressedAssistantTurnMatch[0].length
      expect(compressedTurnLength).toBeLessThan(originalAssistantTurnLength)
    }

    // 4. Speaker labels are preserved
    expect(res.compressed.match(/User:/g)?.length).toBe(2)
    expect(res.compressed.match(/Assistant:/g)?.length).toBe(2)

    // 5. Reading order is maintained
    const u1 = res.compressed.indexOf('User: What is mcpunit?')
    const a1 = res.compressed.indexOf('Assistant:', u1)
    const u2 = res.compressed.indexOf('User: Got it, thanks!', a1)
    const a2 = res.compressed.indexOf('Assistant: You\'re welcome!', u2)
    expect(u1).toBeLessThan(a1)
    expect(a1).toBeLessThan(u2)
    expect(u2).toBeLessThan(a2)

    // 6. dropped[] is populated correctly
    expect(res.dropped.length).toBeGreaterThan(0)
    
    const compressedReason = res.dropped.find(d => d.reason.includes('conversation:compressed'))
    expect(compressedReason).toBeDefined()
    expect(compressedReason?.count).toBe(1) // only 1 long assistant turn

    const preservedReason = res.dropped.find(d => d.reason.includes('conversation:preserved'))
    expect(preservedReason).toBeDefined()
    expect(preservedReason?.count).toBe(3) // 2 user turns + 1 short assistant turn
  })
})
