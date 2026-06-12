import fs from 'fs'
import { segmentDocument } from './src/router/segmenter.js'
import { compressConversationAsync } from './src/compressors/conversation-compressor.js'

async function run() {
  const text = fs.readFileSync('/Users/shreyasgurav/Downloads/ChatGPT-Fitness.md', 'utf8')
  const segs = segmentDocument(text)
  const block2 = segs[2]
  console.log('Block 2 length:', block2.inner.length)
  const res = await compressConversationAsync(block2.inner, { targetRatio: 0.5, model: 'gpt-4o' })
  console.log(res.dropped)
}
run()
