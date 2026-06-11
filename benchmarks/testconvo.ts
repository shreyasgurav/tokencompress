import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { compressAsync } from '../src/index.js'
import { isCorrectLLM } from './evaluate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

const TARGET_DOC = '/Users/shreyasgurav/Downloads/testconvo.md'
const QUESTIONS_FILE = path.join(__dirname, 'data', 'testconvo_qa.json')

const apiKey = process.env.OPENAI_API_KEY

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function askModel(context: string, question: string, retries = 15): Promise<string> {
  const systemPrompt = `You are a strict reading comprehension bot. Answer the user's question using ONLY the provided context. Keep your answer as short as possible (1-5 words if possible). If you cannot answer it from the context, output "I don't know".`
  const userPrompt = `Context:\n${context}\n\nQuestion: ${question}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(500)
    
    const res = await fetchApi('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 50
      })
    })

    if (!res.ok) {
      if ((res.status === 520 || res.status === 429) && attempt < 15) {
        console.warn(`\n[Retry] API error ${res.status}. Waiting 15s...`)
        await sleep(15000)
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
  const rawContent = fs.readFileSync(TARGET_DOC, 'utf-8')
  const passage = rawContent

  const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'))
  const questionsToRun = limit > 0 ? QUESTIONS.slice(0, limit) : QUESTIONS

  const CACHE_FILE = path.join(__dirname, 'data', 'testconvo_control_cache.json')
  let cache: Record<string, { answer: string; correct: boolean }> = {}
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      console.log(`Loaded ${Object.keys(cache).length} cached control answers.`)
    } catch (e) {
      console.warn(`Failed to parse cache file: ${e}. Starting with empty cache.`)
    }
  }

  console.log(`Compressing document using ML Model (target ratio: ${ratio})...`)
  const cRes = await compressAsync(passage, { targetRatio: ratio })
  const compressedPassage = cRes.compressed

  console.log(`Original: ${cRes.tokensBefore} tokens`)
  console.log(`Compressed: ${cRes.tokensAfter} tokens (${((1 - cRes.tokensAfter / cRes.tokensBefore) * 100).toFixed(1)}% reduction)\n`)

  console.log(`Evaluating ${questionsToRun.length} questions against original and compressed contexts...`)
  
  let controlCorrectCount = 0
  let compressedCorrectCount = 0
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
  
  let mdReport = `# TestConvo Benchmark LLM Evaluation Report\n\n`
  mdReport += `**Original Tokens:** ${cRes.tokensBefore}\n`
  mdReport += `**Compressed Tokens:** ${cRes.tokensAfter} (${((1 - cRes.tokensAfter / cRes.tokensBefore) * 100).toFixed(1)}% reduction)\n\n`
  mdReport += `## Detailed Results\n\n`

  for (let i = 0; i < questionsToRun.length; i++) {
    const q = questionsToRun[i]
    process.stdout.write(`\r[${i + 1}/${questionsToRun.length}] Evaluating...`)
    
    let controlAnswer = ''
    let controlCorrect = false
    let compressedAnswer = ''
    let errorOccurred = false

    // 1. Get Control Answer
    if (cache[q.question]) {
      controlAnswer = cache[q.question].answer
      controlCorrect = cache[q.question].correct
    } else {
      try {
        controlAnswer = await askModel(passage, q.question)
        // Since we don't have human-provided ground truth answers for these new questions,
        // we treat the Control Model's answer (from the full 100% context document) as the objective ground truth!
        controlCorrect = true 
        cache[q.question] = { answer: controlAnswer, correct: controlCorrect }
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8') } catch(e){}
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

    // 2. Get Compressed Answer
    try {
      compressedAnswer = await askModel(compressedPassage, q.question)
    } catch (e: any) {
      console.error(`\nError on Compressed Q${i+1}: ${e.message}`)
      skippedDueToError++
      continue
    }

    // 3. Judge Compressed Answer
    // We judge if the compressed answer matches what the Control model extracted from the full text
    const expectedAnswers = q.answer ? [q.answer, controlAnswer] : [controlAnswer]
    let compressedCorrect = false
    let judgeBypassed = false

    const normCompressed = normalizeText(compressedAnswer)
    const normControl = normalizeText(controlAnswer)
    const normIDontKnow = normalizeText("I don't know")

    if (normCompressed === normControl) {
      compressedCorrect = true
      judgeBypassed = true
    } else if (normCompressed === normIDontKnow || normCompressed === "") {
      compressedCorrect = false
      judgeBypassed = true
    } else {
      try {
        compressedCorrect = await isCorrectLLM(q.question, expectedAnswers, compressedAnswer)
      } catch (e: any) {
        console.error(`\nError on Judging Q${i+1}: ${e.message}`)
        skippedDueToError++
        continue
      }
    }

    if (controlCorrect) controlCorrectCount++
    if (compressedCorrect) compressedCorrectCount++
    
    mdReport += `### Question ${i + 1}\n**Q:** ${q.question}\n\n`
    mdReport += `**Expected (from Full Context):** ${controlAnswer}\n\n`
    mdReport += `**Compressed Answer:** ${compressedAnswer} \`[${compressedCorrect ? 'PASS' : 'FAIL'}]${judgeBypassed ? ' (Bypassed Judge)' : ''}\`\n\n`
    mdReport += `---\n\n`
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
  
  const controlScore = ((controlCorrectCount / validQuestions) * 100).toFixed(1)
  const compressedScore = ((compressedCorrectCount / validQuestions) * 100).toFixed(1)
  const retention = controlCorrectCount > 0 ? ((compressedCorrectCount / controlCorrectCount) * 100).toFixed(1) : "0"

  console.log(`\n\ntokencompress benchmark — TestConvo (Technical Chat)`)
  console.log(`════════════════════════════════════════════════════════`)
  console.log(`Document:          testconvo.md`)
  console.log(`Tokens before:     ${cRes.tokensBefore}`)
  console.log(`Tokens after:      ${cRes.tokensAfter}`)
  console.log(`Token reduction:   ${((1 - cRes.tokensAfter / cRes.tokensBefore) * 100).toFixed(1)}%`)
  console.log(``)
  console.log(`Questions skipped due to API errors: ${skippedDueToError}`)
  console.log(``)
  
  if (validQuestions > 0) {
    console.log(`Control Score:     ${controlCorrectCount} / ${validQuestions} (${controlScore}%)`)
    console.log(`Compressed Score:  ${compressedCorrectCount} / ${validQuestions} (${compressedScore}%)`)
    console.log(`Retention Rate:    ${retention}%`)
  } else {
    console.log(`No valid questions answered due to errors.`)
  }
  console.log(`════════════════════════════════════════════════════════\n`)
  
  const resultsDir = path.join(__dirname, 'results')
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir)
  }
  const reportPath = path.join(resultsDir, 'testconvo_report.md')
  fs.writeFileSync(reportPath, mdReport, 'utf-8')
  console.log(`Saved detailed evaluation report to ${reportPath}`)
}

runBenchmark().catch(console.error)
