import { compressToolOutput } from '../src/index.js'
import { execSync } from 'node:child_process'

// 1. Imagine your AI Agent runs a shell command tool
console.log('Running grep tool...')
const rawGrepOutput = execSync('grep -r "compress" src/').toString()

console.log(`Original size: ${rawGrepOutput.length} chars`)

// 2. Compress the output before sending it to the LLM
// We pass `tool: 'grep'` to explicitly force the search results compressor,
// though it would likely auto-detect correctly anyway.
const result = compressToolOutput(rawGrepOutput, { 
  tool: 'grep',
  targetRatio: 0.2 // Try to crush it down to 20% of its original size
})

console.log('\n--- Compressed Tool Output ---')
console.log(result.compressed)

console.log('\n--- Stats ---')
console.log(`Tokens before: ${result.tokensBefore}`)
console.log(`Tokens after:  ${result.tokensAfter}`)
console.log(`Tokens saved:  ${result.tokensSaved} (${Math.round((1 - result.compressionRatio) * 100)}% reduction)`)

console.log('\n--- Exactly what was dropped ---')
console.table(result.dropped)
