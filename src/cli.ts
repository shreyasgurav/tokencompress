#!/usr/bin/env node
/**
 * tokencompress CLI.
 *
 * Commands:
 *   tokencompress compress <input>        compress a string argument
 *   tokencompress compress --file <path>  compress a file
 *   tokencompress compress --stdin        compress piped stdin
 *   tokencompress detect <input>          just print the detected type
 *   tokencompress benchmark <file>        compress a file, print full stats
 */
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { compress } from './compress.js'
import { detectContent } from './detector/content-detector.js'
import type { CompressResult } from './types.js'

const VERSION = '0.2.0'

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
  })
}

function resolveInput(
  inputArg: string | undefined,
  file: string | undefined,
  stdin: boolean | undefined,
): Promise<string> {
  if (file) return Promise.resolve(readFileSync(file, 'utf8'))
  if (stdin) return readStdin()
  if (inputArg !== undefined) return Promise.resolve(inputArg)
  throw new Error('No input. Provide a string, --file <path>, or --stdin.')
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function printReport(result: CompressResult): void {
  const pct = (result.compressionRatio * 100).toFixed(1)
  const line = '─'.repeat(30)
  process.stderr.write(`tokencompress v${VERSION}\n`)
  process.stderr.write(`${line}\n`)
  process.stderr.write(
    `Content type:  ${result.contentType} (confidence ${(result.confidence * 100).toFixed(0)}%)\n`,
  )
  process.stderr.write(`Tokens before: ${fmt(result.tokensBefore)}\n`)
  process.stderr.write(`Tokens after:  ${fmt(result.tokensAfter)}\n`)
  process.stderr.write(`Tokens saved:  ${fmt(result.tokensSaved)} (${pct}%)\n\n`)

  process.stderr.write('Transforms applied:\n')
  for (const t of result.transformsApplied) {
    process.stderr.write(`  ${t}\n`)
  }

  if (result.dropped.length > 0) {
    process.stderr.write('\nWhat was dropped:\n')
    for (const d of result.dropped) {
      process.stderr.write(`  • ${d.count} — ${d.reason}\n`)
      if (d.sample) process.stderr.write(`      e.g. ${d.sample}\n`)
    }
  }
  process.stderr.write(`${line}\n`)
}

const program = new Command()
program
  .name('tokencompress')
  .description('Explainable LLM context compression — fewer tokens, full drop report.')
  .version(VERSION)

program
  .command('compress')
  .description('Compress text and print the compressed output to stdout.')
  .argument('[input]', 'text to compress (or use --file / --stdin)')
  .option('-f, --file <path>', 'read input from a file')
  .option('-s, --stdin', 'read input from stdin')
  .option('-m, --model <model>', 'model for token counting', 'gpt-4o')
  .option('-r, --ratio <ratio>', 'target compression ratio 0.1-0.9', parseFloat)
  .option('--quiet', 'suppress the stats report (only print compressed output)')
  .action(async (input, options) => {
    try {
      const text = await resolveInput(input, options.file, options.stdin)
      const result = compress(text, { model: options.model, targetRatio: options.ratio })
      if (!options.quiet) printReport(result)
      process.stdout.write(result.compressed + '\n')
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('detect')
  .description('Detect and print the content type without compressing.')
  .argument('[input]', 'text to inspect (or use --file / --stdin)')
  .option('-f, --file <path>', 'read input from a file')
  .option('-s, --stdin', 'read input from stdin')
  .action(async (input, options) => {
    try {
      const text = await resolveInput(input, options.file, options.stdin)
      const d = detectContent(text)
      process.stdout.write(`${d.type} (confidence ${(d.confidence * 100).toFixed(0)}%)\n`)
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('benchmark')
  .description('Compress a file and print detailed compression statistics.')
  .argument('<file>', 'file to benchmark')
  .option('-m, --model <model>', 'model for token counting', 'gpt-4o')
  .option('-r, --ratio <ratio>', 'target compression ratio 0.1-0.9', parseFloat)
  .action((file, options) => {
    try {
      const text = readFileSync(file, 'utf8')
      const result = compress(text, { model: options.model, targetRatio: options.ratio })
      printReport(result)
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
