import { createVercelAIMiddleware } from '../src/middleware/index.js'
import { generateText } from 'ai'
// (Assuming you have an AI provider set up)
// import { openai } from '@ai-sdk/openai'

/**
 * Example showing how to use tokencompress with Vercel AI SDK.
 * 
 * NOTE: This is a pseudo-code example to demonstrate the API shape.
 * You would need to `npm install ai` and configure a provider to run this.
 */

async function main() {
  const myHeavyDatabaseTool = {
    description: 'Queries the database for user analytics',
    parameters: { /* zod schema */ },
    execute: async (args: any) => {
      // Imagine this returns 10,000 lines of JSON logs
      return JSON.stringify(Array(10000).fill({ user: 'bob', event: 'click', timestamp: Date.now() }))
    }
  }

  try {
    const result = await generateText({
      // model: openai('gpt-4o'),
      model: {} as any, // Mock
      tools: {
        analytics: myHeavyDatabaseTool
      },
      messages: [
        { role: 'user', content: 'What are the user analytics?' }
      ],
      // THIS IS THE MAGIC LINE:
      // All tool outputs will be automatically compressed before they re-enter the context window.
      experimental_toolCallMiddleware: createVercelAIMiddleware({ targetRatio: 0.1 }),
    })
  
    console.log(result.text)
  } catch (e) {
    console.log('Setup a provider to run this example!')
  }
}

main()
