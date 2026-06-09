import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

// SQuAD train dataset URL
const SQUAD_URL = 'https://rajpurkar.github.io/SQuAD-explorer/dataset/train-v2.0.json'
const DATA_DIR = path.join(__dirname, '../data')
const CACHE_FILE = path.join(DATA_DIR, 'squad_train.json')
const OUTPUT_FILE = path.join(DATA_DIR, 'training_set.jsonl')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

interface ScoredSentence {
  sentence: string
  score: number
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function askModelForScores(passage: string, sentences: string[], retries = 2): Promise<ScoredSentence[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not found in environment')

  const systemPrompt = `You are an expert editor generating training data for a semantic sentence scorer.
You will be provided with a paragraph of text, and an array of its constituent sentences.
Your task is to assign an importance score between 0.0 and 1.0 to each sentence.

Scoring guide:
1.0: Critical factual information, core entities, crucial numbers/dates. The paragraph loses its core meaning without it.
0.8: Important supporting context.
0.5: Standard context, moderately useful but expendable.
0.2: Minor details, elaborations, or examples.
0.0: Pure filler, redundant information, conversational glue, or completely useless text.

You MUST return a JSON array containing objects with exact "sentence" and "score" keys, in the same order they were provided.`

  const userPrompt = `Context paragraph:\n${passage}\n\nSentences to score:\n${JSON.stringify(sentences, null, 2)}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(1000) // Explicit 1000ms delay to avoid rate limits
    
    try {
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
          response_format: { type: "json_object" }, // We will ask for { "scores": [...] } to make it valid JSON
          temperature: 0.1
        })
      })

      if (!res.ok) {
        if (res.status === 429) {
          console.log('\n[Retry] API error 429. Waiting 10s...')
          await sleep(10000)
          continue
        }
        const text = await res.text()
        throw new Error(`API Error ${res.status}: ${text}`)
      }

      const data: any = await res.json()
      const content = data.choices[0].message.content
      const parsed = JSON.parse(content)
      
      // Handle either an array directly, or an object with a scores array
      let resultArr = parsed.scores || parsed
      if (!Array.isArray(resultArr)) {
        throw new Error('Response was not an array')
      }

      // Verify the lengths match
      if (resultArr.length !== sentences.length) {
        throw new Error(`Mismatch in sentence count: sent ${sentences.length}, got ${resultArr.length}`)
      }

      return resultArr as ScoredSentence[]
    } catch (e: any) {
      if (attempt === retries) throw e
      console.log(`\n[Retry] Parsing/API error: ${e.message}. Retrying...`)
    }
  }
  throw new Error('Failed to score sentences')
}

async function loadSquad(): Promise<any> {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading SQuAD v2 train set from cache...')
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  }
  console.log('Downloading SQuAD v2 train set...')
  const res = await fetchApi(SQUAD_URL)
  if (!res.ok) throw new Error('Failed to download SQuAD')
  const data = await res.json()
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data))
  return data
}

function extractParagraphs(squadData: any, limit: number): string[] {
  const paragraphs: string[] = []
  for (const topic of squadData.data) {
    for (const p of topic.paragraphs) {
      // Skip very short paragraphs
      if (p.context.length > 200) {
        paragraphs.push(p.context)
        if (paragraphs.length >= limit) {
          return paragraphs
        }
      }
    }
  }
  return paragraphs
}

async function main() {
  const limitArg = process.argv.indexOf('--limit')
  const PARAGRAPH_LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : 50

  const squad = await loadSquad()
  const paragraphs = extractParagraphs(squad, PARAGRAPH_LIMIT)
  
  console.log(`Starting data generation for ${paragraphs.length} paragraphs.`)

  let processedCount = 0
  let errorCount = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const context = paragraphs[i]
    
    // Split into sentences
    const segments = Array.from(segmenter.segment(context))
    const sentences = segments.map(s => s.segment.trim()).filter(s => s.length > 0)
    
    if (sentences.length < 2) continue // Skip single sentence paragraphs

    process.stdout.write(`[${i+1}/${paragraphs.length}] Scoring... `)

    try {
      const scored = await askModelForScores(context, sentences)
      
      // Write to JSONL
      for (const item of scored) {
        const jsonlLine = JSON.stringify({
          context: context,
          sentence: item.sentence,
          score: item.score
        }) + '\n'
        fs.appendFileSync(OUTPUT_FILE, jsonlLine)
      }
      
      process.stdout.write(`✓ (${scored.length} sentences)\n`)
      processedCount++
    } catch (err: any) {
      process.stdout.write(`✗ Error: ${err.message}\n`)
      errorCount++
    }
  }

  console.log(`\nDone. Successfully processed ${processedCount} paragraphs.`)
  if (errorCount > 0) console.log(`Failed to process ${errorCount} paragraphs.`)
  console.log(`Data appended to: ${OUTPUT_FILE}`)
}

main().catch(e => {
  console.error('\nFatal error:', e)
  process.exit(1)
})
