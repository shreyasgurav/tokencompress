import fs from 'fs'
import { compressConversation } from './src/compressors/conversation-compressor.js'

const text = fs.readFileSync('/Users/shreyasgurav/Downloads/ChatGPT-Fitness.md', 'utf8').split('\n').slice(0, 100).join('\n')
const res = compressConversation(text, { targetRatio: 0.5, model: 'gpt-4o' })
console.log(res.dropped)
console.log(res.transforms)
