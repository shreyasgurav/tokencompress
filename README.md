# tokencompress

**Explainable LLM context compression — fewer tokens, same information, and a full report of exactly what was dropped and why.**

LLMs charge per token. Logs, JSON dumps, search results, and diffs are full of redundancy you're paying to send. `tokencompress` detects what kind of content you're sending and compresses it with a purpose-built strategy — then tells you precisely what it removed.

Every result includes a `dropped[]` report. Nothing is removed silently.

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

### Compress a chat-messages array

```ts
import { compressMessages } from 'tokencompress'

const compressed = compressMessages(
  [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: hugeToolOutput },
  ],
  { model: 'gpt-4o', targetRatio: 0.3 },
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
  contentType: 'json' | 'logs' | 'diff' | 'search' | 'code' | 'text'
  dropped: DroppedItem[]          // exactly what was removed and why
  transformsApplied: string[]
}

interface DroppedItem {
  reason: string
  count: number
  sample?: string
}
```

## How it works

```
input
  ↓
detectType()  →  json | diff | search | logs | code | text
  ↓
route to the matching compressor
  ↓
  json   →  keep head + sampled middle + tail of large arrays
  logs   →  keep errors, dedupe repeated lines by normalized template
  diff   →  keep all +/- and headers, cap unchanged context at 3 lines/run
  search →  group by file, cap matches per file, summarize the rest
  code   →  strip block + full-line comments, collapse blank runs
  text   →  normalize whitespace, truncate middle if still oversized
  ↓
count tokens (js-tiktoken)  →  CompressResult with dropped[] populated
```

Everything runs **locally** — no API calls. If a compressor ever throws, it **fails open**: you get the original text back untouched, never an error.

## Options

```ts
compress(text, {
  model: 'gpt-4o',     // token-counting model (default 'gpt-4o')
  targetRatio: 0.3,    // 0.1 (gentle) – 0.9 (aggressive), default 0.3
  maxTokens: 2000,     // optional hard cap used by text truncation
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
