export function isCorrect(modelAnswer: string, groundTruthAnswers: string[]): boolean {
  // Primary check — exact substring match
  if (groundTruthAnswers.some(gt => modelAnswer.toLowerCase().includes(gt.toLowerCase()))) {
    return true
  }

  // Secondary check — token overlap (F1 score)
  const getTokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  
  const modelTokens = getTokens(modelAnswer)
  
  for (const gt of groundTruthAnswers) {
    const gtTokens = getTokens(gt)
    if (gtTokens.length === 0 || modelTokens.length === 0) continue

    const common = modelTokens.filter(t => gtTokens.includes(t))
    const numCommon = common.length
    
    if (numCommon === 0) continue

    const precision = numCommon / modelTokens.length
    const recall = numCommon / gtTokens.length
    const f1 = (2 * precision * recall) / (precision + recall)

    if (f1 > 0.5) {
      return true
    }
  }

  return false
}
