# tokencompress

**Automatic token compression for AI agent tool outputs.**

Every tool call costs tokens. `tokencompress` automatically intercepts, parses, and compresses tool outputs (JSON, logs, diffs, code, HTML, text) before they enter your agent's context window. 

Get **60-90% fewer tokens** with the same answers, zero proxy servers, and full explainability.

```bash
npm install tokencompress
```

| Tool output type | Before | After | Reduction |
|------------------|--------|-------|-----------|
| Database query   | 42,502 | 16,866 | 60%       |
| Codebase search  | 25,500 | 1,330  | 95%       |
| Server logs      | 17,024 | 373    | 98%       |
| Git diff         | 1,564  | 119    | 92%       |
| Web page         | 3,712  | 900    | 76%       |

---

## The Problem

Agents bloat their context windows by dumping massive tool outputs directly into the prompt. A simple database query or a `grep` search can consume 20k+ tokens of purely redundant context.

Other solutions force you to route all your API traffic through a third-party proxy server or require heavy Python dependencies.

**`tokencompress` is different:**
1. **TypeScript-native:** Zero Python, zero Docker, runs locally in your Node.js/Edge environment.
2. **Explainable:** Every compressed result includes a `dropped` array detailing exactly what was removed and why.
3. **Semantic:** It doesn't just blindly truncate. It parses JSON, deduplicates logs, and scores text with a custom ML model.

---

## Quick Start — 3 lines

```ts
import { compressToolOutput } from 'tokencompress'

// You run your tool...
const rawGrepOutput = execSync('grep -r "auth" src/').toString()

// ...we compress it!
const result = compressToolOutput(rawGrepOutput, { tool: 'grep' })

console.log(`Saved ${result.tokensSaved} tokens!`)
console.log(result.compressed)
// {
//   compressed: "...(much smaller string)...",
//   tokensBefore: 12300,
//   tokensAfter: 2100,
//   dropped: [ { reason: "omitted 211 identical matches in auth.ts", count: 211 } ]
// }
```

---

## Framework Integrations

### Vercel AI SDK

Intercept all tool calls automatically using our official middleware.

```ts
import { generateText } from 'ai'
import { createVercelAIMiddleware } from 'tokencompress/middleware'

const result = await generateText({
  model: yourModel,
  tools: yourTools,
  // 1 line to compress all tool outputs
  experimental_toolCallMiddleware: createVercelAIMiddleware({ targetRatio: 0.3 }),
})
```

### Generic Agents (Langchain, Custom)

Wrap any tool executor function natively.

```ts
import { wrapToolExecutorAsync } from 'tokencompress/middleware'

// Wrap your existing tool function
const myOptimizedTool = wrapToolExecutorAsync(myHeavyDbQueryTool, { targetRatio: 0.2 })

// Now it returns { output: "compressed string", meta: { tokensSaved: 5000 } }
const { output, meta } = await myOptimizedTool(args)
```

---

## How it works

When you call `compressToolOutput()`, it uses the optional `tool` hint (or automatic heuristics) to route the output to a specialized semantic engine:

- **JSON (`tool: 'sql'`, `'prisma'`):** Truncates massive repetitive arrays while preserving anomalous objects and schema structure.
- **Logs (`tool: 'tail'`, `'journalctl'`):** Strips timestamps, deduplicates identical stack traces, but preserves `ERROR` and `FATAL` lines unconditionally.
- **Diffs (`tool: 'git_diff'`, `'patch'`):** Removes long runs of unchanged context lines, preserving the actual `+` and `-` additions.
- **Search (`tool: 'grep'`, `'rg'`):** Limits matches per file and strips redundant context lines.
- **Code (`tool: 'cat'`, `'ls'`):** Strips JSDoc/comments and collapses whitespace, preserving function signatures.
- **HTML (`tool: 'curl'`, `'fetch'`):** Removes `<script>`, `<style>`, and `<svg>` blocks, extracting only the text content.
- **Plain Text / Prose:** Uses a custom-trained, locally-running ONNX MiniLM model to score sentences by information density and extract only the most important context.

## License

MIT
