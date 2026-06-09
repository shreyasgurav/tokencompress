import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { compressAsync } from '../src/index.js'
import { isCorrect } from './evaluate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

const TARGET_DOC = '/Users/shreyasgurav/Downloads/ChatGPT-DJ .md'
const QUESTIONS_FILE = path.join(__dirname, 'data', 'dj_qa.json')

const apiKey = process.env.OPENAI_API_KEY

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function askModel(context: string, question: string, retries = 3): Promise<string> {
  const systemPrompt = `You are a strict reading comprehension bot. Answer the user's question using ONLY the provided context. Keep your answer as short as possible (1-5 words if possible). If you cannot answer it from the context, output "I don't know".`
  const userPrompt = `Context:\n${context}\n\nQuestion: ${question}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(500) // Explicit 500ms delay between ALL API calls
    
    const res = await fetchApi('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 50
      })
    })

    if (!res.ok) {
      if ((res.status === 520 || res.status === 429) && attempt < retries) {
        console.warn(`\n[Retry] API error ${res.status}. Waiting 10s...`)
        await sleep(10000) // 10s backoff for rate limits or CF errors
        continue
      }
      const err = await res.text()
      throw new Error(`OpenAI API error: ${res.status} ${err}`)
    }

    const data = await res.json()
    return data.choices[0].message.content.trim()
  }
  throw new Error("API call failed after retries")
}

async function runBenchmark() {
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY not in environment.')
    process.exit(1)
  }

  console.log(`\nLoading document: ${TARGET_DOC}`)
  const rawContent = fs.readFileSync(TARGET_DOC, 'utf-8')
  
  // Use the FULL document (all ~46k tokens)
  const passage = rawContent

  const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'))

  console.log(`Compressing document using ML Model...`)
  const cRes = await compressAsync(passage, { targetRatio: 0.5 })
  const compressedPassage = cRes.compressed

  console.log(`Original: ${cRes.tokensBefore} tokens`)
  console.log(`Compressed: ${cRes.tokensAfter} tokens (${((1 - cRes.tokensAfter / cRes.tokensBefore) * 100).toFixed(1)}% reduction)\n`)

  console.log(`Evaluating ${QUESTIONS.length} questions against original and compressed contexts...`)
  
  let controlCorrectCount = 0
  let compressedCorrectCount = 0
  let skippedDueToError = 0

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]
    process.stdout.write(`\r[${i + 1}/${QUESTIONS.length}] Evaluating...`)
    
    let controlAnswer = ''
    let compressedAnswer = ''
    let errorOccurred = false

    try {
      controlAnswer = await askModel(passage, q.question)
      compressedAnswer = await askModel(compressedPassage, q.question)
    } catch (e: any) {
      console.error(`\nError on Q${i+1}: ${e.message}`)
      errorOccurred = true
    }

    if (errorOccurred) {
      skippedDueToError++
      continue
    }

    // Convert the single string answer into an array of accepted answers for evaluate.ts
    const acceptedAnswers = [q.answer]

    const controlCorrect = isCorrect(controlAnswer, acceptedAnswers)
    const compressedCorrect = isCorrect(compressedAnswer, acceptedAnswers)

    if (controlCorrect) controlCorrectCount++
    if (compressedCorrect) compressedCorrectCount++
  }

  const validQuestions = QUESTIONS.length - skippedDueToError

  console.log(`\n\ntokencompress benchmark — DJ Chat (Full Document)`)
  console.log(`════════════════════════════════════════════════════════`)
  console.log(`Document:          ChatGPT-DJ .md`)
  console.log(`Tokens before:     ${cRes.tokensBefore}`)
  console.log(`Tokens after:      ${cRes.tokensAfter}`)
  console.log(`Token reduction:   ${((1 - cRes.tokensAfter / cRes.tokensBefore) * 100).toFixed(1)}%`)
  console.log(``)
  console.log(`Questions skipped due to API errors: ${skippedDueToError}`)
  console.log(``)
  
  if (validQuestions > 0) {
    console.log(`Control Score:     ${controlCorrectCount} / ${validQuestions} (${((controlCorrectCount / validQuestions) * 100).toFixed(1)}%)`)
    console.log(`Compressed Score:  ${compressedCorrectCount} / ${validQuestions} (${((compressedCorrectCount / validQuestions) * 100).toFixed(1)}%)`)
    const retention = controlCorrectCount > 0 ? (compressedCorrectCount / controlCorrectCount) * 100 : 0
    console.log(`Retention Rate:    ${retention.toFixed(1)}%`)
  } else {
    console.log(`No valid questions answered due to errors.`)
  }
  console.log(`════════════════════════════════════════════════════════\n`)
}

runBenchmark().catch(console.error)
