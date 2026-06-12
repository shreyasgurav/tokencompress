import fs from 'fs'
import { compressML } from './src/compressors/ml-compressor.js'

async function run() {
  const text = fs.readFileSync('/Users/shreyasgurav/Downloads/ChatGPT-Fitness.md', 'utf8').split('\n').slice(0, 500).join('\n')
  console.time('Batch 1')
  await compressML(text, { targetRatio: 0.5 })
  console.timeEnd('Batch 1')
}
run()
