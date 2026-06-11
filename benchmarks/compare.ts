import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

import { isCorrectLLM } from './evaluate.js'
import { countTokens } from '../src/tokens/counter.js'
import { resolveOptions } from '../src/types.js'
import { compressText } from '../src/compressors/text-compressor.js'
import { compressIterative } from '../src/compressors/iterative-compressor.js'
import { compressML } from '../src/compressors/ml-compressor.js'

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
    await sleep(500)
    
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
        await sleep(10000)
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

  // Parse command line arguments
  const args = process.argv.slice(2)
  let limit = -1
  const limitIdx = args.indexOf('--limit')
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10)
  }

  let ratio = 0.5
  const ratioIdx = args.indexOf('--ratio')
  if (ratioIdx !== -1 && args[ratioIdx + 1]) {
    ratio = parseFloat(args[ratioIdx + 1])
  }

  console.log(`\nLoading document: ${TARGET_DOC}`)
  const passage = fs.readFileSync(TARGET_DOC, 'utf-8')
  const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'))
  const questionsToRun = limit > 0 ? QUESTIONS.slice(0, limit) : QUESTIONS
  const originalTokens = countTokens(passage, 'gpt-4o')

  console.log(`Original Tokens: ${originalTokens}`)
  console.log(`Using targetRatio: ${ratio}`)
  console.log(`\nCompressing using all 3 algorithms...`)

  const opts = resolveOptions({ targetRatio: ratio })
  
  const tfidfOut = compressText(passage, opts)
  const iterOut = compressIterative(passage, opts)
  const mlOut = await compressML(passage, opts)

  const versions = [
    { name: 'Control', text: passage, tokens: originalTokens },
    { name: 'ML', text: mlOut.compressed, tokens: countTokens(mlOut.compressed, 'gpt-4o') },
    { name: 'TF-IDF', text: tfidfOut.compressed, tokens: countTokens(tfidfOut.compressed, 'gpt-4o') },
    { name: 'Iterative', text: iterOut.compressed, tokens: countTokens(iterOut.compressed, 'gpt-4o') }
  ]

  versions.forEach(v => {
    if (v.name !== 'Control') {
      console.log(`- ${v.name}: ${v.tokens} tokens (${((1 - v.tokens / originalTokens) * 100).toFixed(1)}% reduction)`)
    }
  })

  // Setup Cache
  const CACHE_FILE = path.join(__dirname, 'data', 'dj_control_cache.json')
  let cache: Record<string, { answer: string; correct: boolean }> = {}
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      console.log(`Loaded ${Object.keys(cache).length} cached control answers.`)
    } catch (e) {
      console.warn(`Failed to parse cache file: ${e}. Starting with empty cache.`)
    }
  }

  console.log(`\nEvaluating ${questionsToRun.length} questions across ${versions.length} versions...`)

  let scores = {
    Control: 0,
    ML: 0,
    'TF-IDF': 0,
    Iterative: 0
  }

  let skippedDueToError = 0
  let cacheUpdated = false

  function normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  for (let i = 0; i < questionsToRun.length; i++) {
    const q = questionsToRun[i]
    process.stdout.write(`\r[${i + 1}/${questionsToRun.length}] Evaluating...`)
    
    let answers: Record<string, string> = {}
    let errorOccurred = false
    let controlCorrect = false

    // 1. Get Control Answer & Correctness
    if (cache[q.question]) {
      answers['Control'] = cache[q.question].answer
      controlCorrect = cache[q.question].correct
    } else {
      try {
        answers['Control'] = await askModel(passage, q.question)
        const acceptedAnswers = [q.answer]
        controlCorrect = await isCorrectLLM(q.question, acceptedAnswers, answers['Control'])
        cache[q.question] = { answer: answers['Control'], correct: controlCorrect }
        cacheUpdated = true
      } catch (e: any) {
        console.error(`\nError on Control Q${i+1}: ${e.message}`)
        errorOccurred = true
      }
    }

    if (errorOccurred) {
      skippedDueToError++
      continue
    }

    // 2. Get Answers for other versions
    try {
      for (const v of versions) {
        if (v.name === 'Control') continue;
        answers[v.name] = await askModel(v.text, q.question)
      }
    } catch (e: any) {
      console.error(`\nError on Q${i+1}: ${e.message}`)
      skippedDueToError++
      continue
    }

    const acceptedAnswers = [q.answer]

    // 3. Judge each version
    if (controlCorrect) scores['Control']++

    for (const v of versions) {
      if (v.name === 'Control') continue

      let isCorrect = false
      const normAnswer = normalizeText(answers[v.name])
      const normControl = normalizeText(answers['Control'])
      const normExpected = normalizeText(q.answer)
      const normIDontKnow = normalizeText("I don't know")

      if (normAnswer === normExpected) {
        isCorrect = true
      } else if (normAnswer === normControl) {
        isCorrect = controlCorrect
      } else if (normAnswer === normIDontKnow || normAnswer === "") {
        isCorrect = false
      } else {
        try {
          isCorrect = await isCorrectLLM(q.question, acceptedAnswers, answers[v.name])
        } catch (e: any) {
          console.error(`\nError on Judging ${v.name} Q${i+1}: ${e.message}`)
          errorOccurred = true
          break
        }
      }
      if (isCorrect) scores[v.name as keyof typeof scores]++
    }

    if (errorOccurred) {
      skippedDueToError++
      continue
    }
  }

  if (cacheUpdated) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
      console.log(`\n[Cache] Saved updated cache with new entries to ${CACHE_FILE}`)
    } catch (e) {
      console.error(`\n[Cache] Failed to save updated cache: ${e}`)
    }
  }

  const validQuestions = questionsToRun.length - skippedDueToError
  
  console.log(`\n\nComparative Benchmark Results — DJ Chat`)
  console.log(`════════════════════════════════════════════════════════`)
  console.log(`Questions skipped due to API errors: ${skippedDueToError}`)
  console.log(`Valid Questions: ${validQuestions}`)
  console.log(`Control Score Baseline: ${scores['Control']} / ${validQuestions} (${((scores['Control'] / validQuestions) * 100).toFixed(1)}%)`)
  console.log(``)
  console.log(`| System | Compression | Retention |`)
  console.log(`| ------ | ----------- | --------- |`)
  
  versions.forEach(v => {
    if (v.name === 'Control') return
    const compPct = ((1 - v.tokens / originalTokens) * 100).toFixed(1) + '%'
    const retentionPct = scores['Control'] > 0 ? ((scores[v.name as keyof typeof scores] / scores['Control']) * 100).toFixed(1) + '%' : '0%'
    console.log(`| ${v.name} | ${compPct} | ${retentionPct} |`)
  })
  
  console.log(`════════════════════════════════════════════════════════\n`)
}

runBenchmark().catch(console.error)

