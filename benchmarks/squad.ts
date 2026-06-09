import * as fs from 'fs'
import * as path from 'path'
import { compress } from '../src/index.js'
import { isCorrect } from './evaluate.js'
import { generateReport, QuestionResult } from './report.js'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Try to load fetch (Node 18+ has it globally, otherwise fallback)
const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

const CACHE_FILE = path.join(__dirname, 'squad_dev.json')
const SQUAD_URL = 'https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json'

async function getSquadData() {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading SQuAD v2 dev set from cache...')
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
  }
  
  console.log('Downloading SQuAD v2 dev set...')
  const res = await fetchApi(SQUAD_URL)
  const data = await res.json()
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data))
  return data
}

async function askModel(passage: string, question: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not found in environment')

  const systemPrompt = `You are a precise question answering system. 
Answer the question using only information from the provided context.
Give a short direct answer. If the answer is not in the context, say "NOT FOUND".`

  const userPrompt = `Context: ${passage}\n\nQuestion: ${question}`

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
    const err = await res.text()
    throw new Error(`OpenAI API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content.trim()
}

// Simple semaphore for concurrency
class Semaphore {
  private count: number
  private queue: (() => void)[] = []

  constructor(concurrency: number) {
    this.count = concurrency
  }

  async acquire() {
    if (this.count > 0) {
      this.count--
      return
    }
    return new Promise<void>(resolve => this.queue.push(resolve))
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      if (next) next()
    } else {
      this.count++
    }
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runBenchmark() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not in environment.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 150

  const data = await getSquadData()
  
  // Extract questions
  const questions: any[] = []
  for (const article of data.data) {
    for (const paragraph of article.paragraphs) {
      for (const qa of paragraph.qas) {
        if (!qa.is_impossible) {
          questions.push({
            passage: paragraph.context,
            question: qa.question,
            answers: qa.answers.map((a: any) => a.text)
          })
          if (questions.length >= limit) break
        }
      }
      if (questions.length >= limit) break
    }
    if (questions.length >= limit) break
  }

  console.log(`Starting benchmark for ${questions.length} questions.`)
  console.log(`Estimated cost: $${((questions.length * 2 * 800) / 1000000 * 0.15).toFixed(3)}`)
  
  const results: QuestionResult[] = []
  let completed = 0

  const semaphore = new Semaphore(5)

  const tasks = questions.map(async (q, index) => {
    await semaphore.acquire()
    try {
      await sleep(100) // 100ms batch delay

      let controlAnswer = ''
      try {
        controlAnswer = await askModel(q.passage, q.question)
      } catch (err: any) {
        console.error(`\nError on control run for Q${index}: ${err.message}`)
        await sleep(2000)
        controlAnswer = await askModel(q.passage, q.question) // 1 retry
      }

      let compressedPassage = ''
      let cRes: any = null
      let compFailed = false
      
      try {
        cRes = compress(q.passage, { targetRatio: 0.5 })
        compressedPassage = cRes.compressed
      } catch (err) {
        console.warn(`\nCompression failed for Q${index}, using original.`)
        compressedPassage = q.passage
        compFailed = true
      }

      let compressedAnswer = ''
      try {
        compressedAnswer = await askModel(compressedPassage, q.question)
      } catch (err: any) {
        console.error(`\nError on compressed run for Q${index}: ${err.message}`)
        await sleep(2000)
        compressedAnswer = await askModel(compressedPassage, q.question) // 1 retry
      }

      const controlCorrect = isCorrect(controlAnswer, q.answers)
      const compressedCorrect = isCorrect(compressedAnswer, q.answers)

      results.push({
        question: q.question,
        passage_tokens_before: cRes ? cRes.tokensBefore : 0,
        passage_tokens_after: cRes ? cRes.tokensAfter : 0,
        compression_ratio: cRes ? cRes.compressionRatio : 0,
        content_type: cRes ? cRes.contentType : 'unknown',
        control_correct: controlCorrect,
        compressed_correct: compressedCorrect,
        control_answer: controlAnswer,
        compressed_answer: compressedAnswer,
        ground_truth: q.answers,
        compression_failed: compFailed
      })

      completed++
      const avgReduction = results.reduce((sum, r) => sum + (r.passage_tokens_before > 0 ? (r.passage_tokens_before - r.passage_tokens_after)/r.passage_tokens_before : 0), 0) / completed * 100
      process.stdout.write(`\r[${completed}/${questions.length}] compressing... ✓ ${avgReduction.toFixed(1)}% reduction`)

    } catch (err: any) {
      console.error(`\nFatal error on Q${index}: ${err.message}, skipping.`)
    } finally {
      semaphore.release()
    }
  })

  await Promise.all(tasks)
  console.log('\n')

  generateReport(results, limit)
}

runBenchmark().catch(console.error)
