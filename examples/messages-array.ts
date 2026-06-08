/**
 * Compress an OpenAI/Anthropic-style messages array before sending it to the
 * model. The structure and roles are preserved; only `content` is compressed.
 */
import { compressMessages } from '../src/index.js'
import type { Message } from '../src/index.js'

const toolOutput = JSON.stringify(
  Array.from({ length: 200 }, (_, i) => ({
    id: i,
    sku: `SKU-${1000 + i}`,
    inStock: i % 2 === 0,
    price: (i * 1.5).toFixed(2),
  })),
)

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful inventory assistant.' },
  { role: 'user', content: 'Here is the current inventory dump, summarize it.' },
  { role: 'assistant', content: toolOutput },
]

const compressed = compressMessages(messages, { targetRatio: 0.4 })

for (const msg of compressed) {
  console.log(`[${msg.role}] (${msg.content.length} chars)`)
}
