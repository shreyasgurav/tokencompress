import fs from 'fs'
import { compressML } from './src/compressors/ml-compressor.js'

async function run() {
  const text = fs.readFileSync('/Users/shreyasgurav/Downloads/ChatGPT-Fitness.md', 'utf8')
  const res = await compressML(text, { targetRatio: 0.5 })
  console.log("Tokens before:", res.compressed.length)
  console.log("Dropped count:", res.dropped.length ? res.dropped[0].count : 0)
}
run()
