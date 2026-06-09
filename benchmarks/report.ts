import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface QuestionResult {
  question: string
  passage_tokens_before: number
  passage_tokens_after: number
  compression_ratio: number
  content_type: string
  control_correct: boolean
  compressed_correct: boolean
  control_answer: string
  compressed_answer: string
  ground_truth: string[]
  compression_failed?: boolean
}

export function generateReport(results: QuestionResult[], limit: number) {
  const answerable = results.length
  
  let totalBefore = 0
  let totalAfter = 0
  let minReduction = 100
  let maxReduction = 0
  
  let controlCorrect = 0
  let compressedCorrect = 0
  
  let compressionCausedFailure = 0
  let compressionHadNoEffect = 0
  let belowThreshold = 0

  for (const r of results) {
    totalBefore += r.passage_tokens_before
    totalAfter += r.passage_tokens_after
    
    const reduction = r.passage_tokens_before > 0 
      ? (r.passage_tokens_before - r.passage_tokens_after) / r.passage_tokens_before * 100
      : 0
      
    if (reduction < minReduction) minReduction = reduction
    if (reduction > maxReduction) maxReduction = reduction
    
    if (reduction === 0) belowThreshold++
    
    if (r.control_correct) controlCorrect++
    if (r.compressed_correct) compressedCorrect++
    
    if (r.control_correct && !r.compressed_correct) compressionCausedFailure++
    if (r.control_correct === r.compressed_correct) compressionHadNoEffect++
  }

  const avgBefore = Math.round(totalBefore / answerable)
  const avgAfter = Math.round(totalAfter / answerable)
  const avgReduction = totalBefore > 0 ? (totalBefore - totalAfter) / totalBefore * 100 : 0
  
  const controlAcc = (controlCorrect / answerable) * 100
  const compressedAcc = (compressedCorrect / answerable) * 100
  const retentionRate = controlCorrect > 0 ? (compressedCorrect / controlCorrect) * 100 : 0

  const today = new Date().toISOString().split('T')[0]

  console.log(`\ntokencompress benchmark — SQuAD v2`)
  console.log(`════════════════════════════════════════════════`)
  console.log(`\nDataset:    SQuAD v2 dev set, first ${answerable} answerable questions`)
  console.log(`Model:      gpt-4o-mini`)
  console.log(`Date:       ${today}\n`)
  
  console.log(`Compression stats:`)
  console.log(`  Avg tokens before:     ${avgBefore}`)
  console.log(`  Avg tokens after:      ${avgAfter}`)
  console.log(`  Avg reduction:         ${avgReduction.toFixed(1)}%`)
  console.log(`  Min reduction:         ${minReduction.toFixed(1)}%`)
  console.log(`  Max reduction:         ${maxReduction.toFixed(1)}%\n`)
  
  console.log(`Retention stats:`)
  console.log(`  Control accuracy:      ${controlCorrect}/${answerable}  (${controlAcc.toFixed(1)}%)`)
  console.log(`  Compressed accuracy:   ${compressedCorrect}/${answerable}  (${compressedAcc.toFixed(1)}%)`)
  console.log(`  Retention rate:        ${retentionRate.toFixed(1)}%    (compressed_correct / control_correct)\n`)
  
  console.log(`  Questions where compression caused failure:  ${compressionCausedFailure}`)
  console.log(`  Questions compression had no effect:         ${compressionHadNoEffect}`)
  console.log(`  Questions below compression threshold:       ${belowThreshold}  (passed through unchanged)\n`)
  
  console.log(`Result: ${avgReduction.toFixed(1)}% token reduction · ${retentionRate.toFixed(1)}% retention rate\n`)
  console.log(`════════════════════════════════════════════════`)

  const outDir = path.join(__dirname, 'results')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  
  const outFile = path.join(outDir, `squad_${today}${limit < 150 ? `_limit${limit}` : ''}.json`)
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2))
  console.log(`Saved full results to benchmarks/results/${path.basename(outFile)}`)
}
