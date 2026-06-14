/**
 * Basic usage: compress a raw string and inspect the drop report.
 * Run with: npx tsx examples/basic.ts  (after `npm run build` you can also
 * import from the built dist).
 */
import { compressToolOutput } from '../src/index.js'

const logs = Array.from({ length: 100 }, (_, i) =>
  `[2024-06-07 10:24:${(i % 60).toString().padStart(2, '0')}] INFO: GET /api/items 200 ${i}ms`,
).join('\n')

const result = compressToolOutput(logs)

console.log('content type:     ', result.contentType)
console.log('tokens before:    ', result.tokensBefore)
console.log('tokens after:     ', result.tokensAfter)
console.log('tokens saved:     ', result.tokensSaved)
console.log('compression ratio:', (result.compressionRatio * 100).toFixed(1) + '%')
console.log('dropped:')
for (const d of result.dropped) {
  console.log(`  • ${d.count} — ${d.reason}`)
}
console.log('\n--- compressed output ---\n')
console.log(result.compressed)
