# tokencompress

**Explainable LLM context compression — fewer tokens, same information, and a full report of exactly what was dropped and why.**

LLMs charge per token. Logs, JSON dumps, search results, diffs, and HTML are full of redundancy you're paying to send. `tokencompress` detects what kind of content you're sending and compresses it with a purpose-built strategy — then tells you precisely what it removed.

Every result includes a `dropped[]` report. Nothing is removed silently.

- **Explainable** — `dropped[]` lists every removal with a reason, count, and sample.
- **Adaptive** — keep-counts are chosen by information-saturation detection, not hardcoded limits, so near-duplicate data collapses hard while diverse data is barely touched.
- **Prose-aware** — plain text is compressed by TF-IDF extractive summarization: high-signal sentences (numbers, errors, decisions, entities) are always kept while filler is dropped.
- **Semantic ML Routing** — conversation text is compressed using a highly-optimized local ML model (`all-MiniLM-L6-v2`) via ONNX Runtime to keep contextually relevant sentences. 
- **Universal Router** — intermingled JSON, code blocks, logs, and text are automatically segmented, routed to specialized compressors, and reassembled losslessly in parallel.
- **Local & TypeScript-native** — 100% local processing. No API keys, no network calls. The only TypeScript-native context compression library.
- **Fail-open & Cancellable** — falls back to original text if anything throws. Full `AbortSignal` support to instantly cancel heavy ML workloads.

## Benchmarks

**Large Document (Parallel Mixed-Content Compression)**
- `140k tokens` (500 interleaved blocks of Prose, JSON, Logs, Code) — 72.2% reduction. Processed completely locally in **19.7 seconds**.

**Conversational Documents (Turn-Aware Compression)**
Unlike standard naive TF-IDF which destroys the structural thread of chat histories, our Turn-Aware Conversational Compression protects the back-and-forth structure while internally crushing verbose assistant responses.
- `ChatGPT-Building future.md` — 41.2% reduction, 100% retention
- `ChatGPT-DSA.md` — 32.2% reduction, 94.1% retention
- `ChatGPT-Fitness.md` — 29.6% reduction, 92.9% retention

**Structured Prose**
- `SQuAD v2` (150 questions) — 19.3% reduction, 88.8% retention

## Install

```bash
npm install tokencompress
```

## Usage

### Compress a raw string

```ts
import { compress } from 'tokencompress'

const result = compress(largeLogOutput)

console.log(result.compressed)        // the compressed text
console.log(result.tokensSaved)       // e.g. 3616
console.log(result.compressionRatio)  // e.g. 0.75
console.log(result.dropped)
// [
//   { reason: 'repeated INFO/DEBUG lines (kept 1 of each unique pattern)', count: 198 },
//   { reason: 'repeated WARN lines (kept 2 of each unique pattern)', count: 34 },
// ]
```

### Compress a mixed-content document

Real LLM turns aren't one clean type — they interleave prose, code, JSON, and logs in a single message. `segmentAndCompress` splits the document into typed blocks, routes **each block to the compressor that understands it**, and reassembles the document in place. Fenced code blocks keep their fences; nothing is reordered.

```ts
import { segmentAndCompress } from 'tokencompress'

const result = segmentAndCompress(mixedAssistantMessage)

console.log(result.compressed)   // rebuilt document, each block compressed in place
console.log(result.tokensSaved)  // total saved across all blocks
console.log(result.segments)
// [
//   { index: 0, kind: 'text',   type: 'text', tokensBefore: 12, tokensSaved: 0 },
//   { index: 1, kind: 'fenced', type: 'logs', fenceLanguage: 'log', tokensSaved: 410 },
//   { index: 2, kind: 'fenced', type: 'json', fenceLanguage: 'json', tokensSaved: 380 },
//   { index: 3, kind: 'fenced', type: 'code', fenceLanguage: 'ts', tokensSaved: 24 },
// ]
console.log(result.dropped)      // aggregated drop report across every block
```

It detects both **fenced** blocks (```` ```json ````, ```` ```ts ````, …) and **unfenced** structures pasted inline — JSON objects/arrays and runs of log lines — leaving the surrounding prose as text. The concatenation of all segments reproduces the input exactly, so if nothing is removed the output is byte-identical.

```bash
# CLI: compress a mixed document block-by-block
cat assistant-reply.md | tokencompress segment --stdin
```

### Compress a chat-messages array

```ts
import { compressMessages } from 'tokencompress'

const compressed = compressMessages(
  [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: hugeToolOutput },
  ],
  {
    model: 'gpt-4o',
    targetRatio: 0.3,
    protectRecent: 2,            // leave the last 2 messages (the live turn) untouched
    compressUserMessages: true,  // default true
    minTokensToCompress: 200,    // skip messages smaller than this
  },
)
// same array shape, each `content` compressed — drop straight into your API request
```

### CLI

```bash
# compress a file (stats go to stderr, compressed output to stdout)
tokencompress compress --file server.log

# pipe through it
cat results.txt | tokencompress compress --stdin --quiet > compressed.txt

# just detect the content type
tokencompress detect --file data.json

# full benchmark report
tokencompress benchmark large-diff.patch

# compress a mixed document (prose + code + JSON + logs) block-by-block
tokencompress segment --file assistant-reply.md
```

## The result type

```ts
interface CompressResult {
  compressed: string
  original: string
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressionRatio: number        // 0.0 – 1.0
  contentType: 'json' | 'logs' | 'diff' | 'search' | 'code' | 'html' | 'text' | 'conversation'
  confidence: number              // 0.0 – 1.0 confidence in the detected type
  dropped: DroppedItem[]          // exactly what was removed and why
  transformsApplied: string[]
  telemetry?: Record<string, CompressorTelemetry>
}

interface DroppedItem {
  reason: string
  count: number
  sample?: string
}

interface CompressorTelemetry {
  timeMs: number
  blocksProcessed: number
  tokensBefore: number
  tokensAfter: number
  sentenceCount?: number          // populated for ML text compression
}
```

## How it works

```
input
  ↓
detectContent()  →  json | diff | html | search | logs | code | text   (+ confidence)
  ↓
route to the matching compressor
  ↓
  json         →  adaptively sample large arrays (head + middle + tail)
  logs         →  keep errors, dedupe repeated lines by normalized template
  diff         →  keep all +/- and headers, cap unchanged context at 3 lines/run
  search       →  group by file, adaptively cap matches per file, summarize the rest
  code         →  strip block + full-line comments, collapse blank runs
  html         →  drop scripts/styles/markup, keep the readable text
  conversation →  turn-aware splitting: protects all user turns and structural boundaries, 
                  only compresses long assistant responses internally using TF-IDF
  text         →  TF-IDF extractive: score sentences, keep high-signal ones
                  (numbers, errors, decisions), drop filler; falls back to
                  whitespace-normalize + middle-truncate if savings < 20%
  ↓
count tokens (js-tiktoken)  →  CompressResult with dropped[] populated
```

For documents that mix several types in one message, `segmentAndCompress()` adds a step in front: it segments the input into typed blocks (markdown fences plus unfenced JSON/log runs), runs each block through the pipeline above, and stitches the results back together in order — returning a `SegmentedCompressResult` with a per-segment breakdown.

```
mixed document
  ↓
segment → [ text ][ ```log … ``` ][ text ][ ```json … ``` ][ ```ts … ``` ]
  ↓           ↓           ↓             ↓          ↓              ↓
            text       logs          text       json           code     ← each routed independently
  ↓
reassemble in place  →  SegmentedCompressResult { compressed, segments[], dropped[] }
```

### Adaptive sizing

For JSON arrays and search results, tokencompress doesn't use a fixed keep-count. It builds a cumulative unique-content curve and finds the *knee* — the point where adding more items stops adding information (the Kneedle method, plus SimHash near-duplicate clustering). 500 near-identical rows collapse to a handful; 500 genuinely distinct rows are mostly kept. No ML, just arithmetic.

Everything runs **locally** — no API calls. If a compressor ever throws, it **fails open**: you get the original text back untouched, never an error.

## Options

```ts
compress(text, {
  model: 'gpt-4o',     // token-counting model (default 'gpt-4o')
  targetRatio: 0.3,    // 0.1 (gentle) – 0.9 (aggressive), default 0.3
  maxTokens: 2000,     // optional hard cap used by text truncation
  signal: abortCtrl.signal // optional AbortSignal to cancel compression
})
```

`compressMessages` accepts the same options plus a message-level policy:

```ts
compressMessages(messages, {
  protectRecent: 0,            // leave the last N messages untouched
  compressUserMessages: true,  // gate compression by role
  compressSystemMessages: true,
  minTokensToCompress: 0,      // skip content smaller than this
})
```

## Development

```bash
npm install
npm run build     # compile to dist/
npm test          # run the vitest suite
npm run lint      # type-check only
```

## License

MIT
