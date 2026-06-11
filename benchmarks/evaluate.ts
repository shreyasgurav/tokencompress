const fetchApi = typeof fetch !== 'undefined' ? fetch : require('node-fetch')

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

export async function isCorrectLLM(question: string, groundTruthAnswers: string[], modelAnswer: string): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY required for isCorrectLLM")

  const systemPrompt = `You are a strict evaluation judge.
You will be provided with a Question, the Ground Truth Expected Answer(s), and a Student's Answer.
Your task is to determine if the Student's Answer is factually equivalent to the Ground Truth and correctly answers the Question.
Ignore minor grammatical differences or extra conversational text.
If the student answer is correct, output EXACTLY "YES".
If the student answer is incorrect, vague, or missing key facts, output EXACTLY "NO".`

  const userPrompt = `Question: ${question}\nGround Truth Expected Answer: ${groundTruthAnswers.join(' OR ')}\nStudent Answer: ${modelAnswer}`

  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(200)
    
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
        max_tokens: 10
      })
    })

    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 15) {
        await sleep(15000)
        continue
      }
      throw new Error(`OpenAI API error during evaluation: ${res.status}`)
    }

    const data = await res.json()
    const content = data.choices[0].message.content.trim().toUpperCase()
    
    if (content.includes("YES")) return true
    if (content.includes("NO")) return false
    
    // Fallback if LLM gives weird response
    return false
  }

  return false
}
