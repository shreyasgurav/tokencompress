import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { compressAsync } from '../src/index.js'
import { isCorrect } from './evaluate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Try to load fetch
const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

const TARGET_DOC = '/Users/shreyasgurav/Downloads/ChatGPT-Fitness.md'

const QUESTIONS = [
  {
    q: "How old is the user?",
    a: ["20"]
  },
  {
    q: "What is the user's height?",
    a: ["5'5", "5 feet 5"]
  },
  {
    q: "What is the user's current weight?",
    a: ["47", "48", "49", "47-49"]
  },
  {
    q: "What is the recommended daily protein intake?",
    a: ["80", "100", "80-100g", "80 to 100"]
  },
  {
    q: "What is the recommended daily calorie intake for weight gain?",
    a: ["2300", "2600", "2300-2600"]
  },
  {
    q: "What gym split was recommended?",
    a: ["Push Pull Legs", "Push, Pull, Legs"]
  },
  {
    q: "What is the recommended creatine dosage?",
    a: ["3-5g", "3 to 5 grams", "3g", "5g"]
  },
  {
    q: "What was the user's weight in June 2025?",
    a: ["43", "43 kg"]
  },
  {
    q: "What is the first target weight recommended?",
    a: ["54", "55", "54-56", "54 to 56"]
  },
  {
    q: "What weekly rate of weight gain was suggested?",
    a: ["0.25", "0.5", "0.25 to 0.5"]
  },
  {
    q: "What is the top priority for muscle gain according to the assistant?",
    a: ["Diet"]
  },
  {
    q: "What ingredients are in the user's regular shake?",
    a: ["milk", "banana", "peanut butter"]
  },
  {
    q: "What branch of engineering is the user studying?",
    a: ["AI", "Data Science", "Artificial Intelligence"]
  },
  {
    q: "What product is the user building related to AI memory?",
    a: ["UniMemory"]
  },
  {
    q: "What salary range is the user targeting after graduation?",
    a: ["8", "15", "LPA", "8-15"]
  },
  {
    q: "What did the assistant say about 55 kg with training?",
    a: ["athletic", "muscular", "lean"]
  },
  {
    q: "What foods were recommended for bus journeys?",
    a: ["banana", "chikki", "peanut"]
  },
  {
    q: "What was identified as the main weakness of Day 2?",
    a: ["dinner"]
  },
  {
    q: "What aesthetic healthy weight range was recommended?",
    a: ["58", "62", "58-62"]
  },
  {
    q: "What three-stage physique progression was outlined?",
    a: ["52", "55", "58"]
  }
]

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function askModel(passage: string, question: string, retries = 2): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not found in environment')

  const systemPrompt = `You are a precise question answering system. 
Answer the question using only information from the provided context.
Give a short direct answer. If the answer is not in the context, say "NOT FOUND".`

  const userPrompt = `Context: ${passage}\n\nQuestion: ${question}`

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

async function runLongDocBenchmark() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not in environment.')
    process.exit(1)
  }

  if (!fs.existsSync(TARGET_DOC)) {
    console.error(`ERROR: Target document not found at ${TARGET_DOC}`)
    process.exit(1)
  }

  console.log(`Loading document: ${TARGET_DOC}`)
  const rawContent = fs.readFileSync(TARGET_DOC, 'utf-8')
  // Use first 50,000 chars which is roughly 12,000 tokens.
  const passage = rawContent.slice(0, 50000)

  console.log(`Compressing document using ML Model...`)
  const cRes = await compressAsync(passage, { targetRatio: 0.5 })
  const compressedPassage = cRes.compressed

  console.log(`Original: ${cRes.tokensBefore} tokens`)
  console.log(`Compressed: ${cRes.tokensAfter} tokens (${(cRes.compressionRatio * 100).toFixed(1)}% reduction)`)
  console.log(`\nEvaluating 20 questions against original and compressed contexts...`)

  let controlCorrectCount = 0
  let compressedCorrectCount = 0
  let skippedDueToError = 0

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]
    process.stdout.write(`\r[${i+1}/${QUESTIONS.length}] Evaluating...`)

    let controlAnswer = ''
    let compressedAnswer = ''
    let errorOccurred = false

    try {
      controlAnswer = await askModel(passage, q.q)
      compressedAnswer = await askModel(compressedPassage, q.q)
    } catch (e: any) {
      console.error(`\nError on Q${i+1}: ${e.message}`)
      errorOccurred = true
    }

    if (errorOccurred) {
      skippedDueToError++
      continue
    }

    const controlCorrect = isCorrect(controlAnswer, q.a)
    const compressedCorrect = isCorrect(compressedAnswer, q.a)

    if (controlCorrect) controlCorrectCount++
    if (compressedCorrect) compressedCorrectCount++
  }

  const validQuestions = QUESTIONS.length - skippedDueToError

  console.log(`\n\ntokencompress benchmark — Long Document (Chat History)`)
  console.log(`════════════════════════════════════════════════════════`)
  console.log(`Document:          ${path.basename(TARGET_DOC)}`)
  console.log(`Tokens before:     ${cRes.tokensBefore}`)
  console.log(`Tokens after:      ${cRes.tokensAfter}`)
  console.log(`Token reduction:   ${(cRes.compressionRatio * 100).toFixed(1)}%`)
  console.log(`\nQuestions skipped due to API errors: ${skippedDueToError}`)
  
  if (validQuestions > 0) {
    console.log(`\nControl Score:     ${controlCorrectCount} / ${validQuestions} (${((controlCorrectCount/validQuestions)*100).toFixed(1)}%)`)
    console.log(`Compressed Score:  ${compressedCorrectCount} / ${validQuestions} (${((compressedCorrectCount/validQuestions)*100).toFixed(1)}%)`)
    const retention = controlCorrectCount > 0 ? (compressedCorrectCount / controlCorrectCount) * 100 : 0
    console.log(`Retention Rate:    ${retention.toFixed(1)}%`)
  } else {
    console.log(`\nNo valid questions answered due to errors.`)
  }
  console.log(`════════════════════════════════════════════════════════`)
}

runLongDocBenchmark().catch(console.error)
