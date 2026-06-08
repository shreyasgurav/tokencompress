import { describe, it, expect } from 'vitest'
import { detectContent } from '../../src/detector/content-detector.js'

function makeJsonArray(): string {
  return JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, value: i * 2, active: true })))
}

function make100LineLog(): string {
  return Array.from(
    { length: 100 },
    (_, i) => `[2024-01-01 10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}] INFO: Request ${i} processed successfully`,
  ).join('\n')
}

function makeGitDiff(): string {
  return [
    'diff --git a/src/index.ts b/src/index.ts',
    'index abc1234..def5678 100644',
    '--- a/src/index.ts',
    '+++ b/src/index.ts',
    '@@ -10,6 +10,6 @@',
    ' const a = 1',
    '-const b = oldValue',
    '+const b = newValue',
    ' const c = 3',
  ].join('\n')
}

function makeRipgrepOutput(): string {
  return Array.from(
    { length: 30 },
    (_, i) => `src/module${i % 5}.ts:${10 + i}:    const handler = processRequest(query_${i})`,
  ).join('\n')
}

function makeTypeScriptSource(): string {
  return [
    "import { useState, useEffect } from 'react'",
    "import { api } from './api'",
    "import type { User, Config } from './types'",
    '',
    'export const API_BASE = process.env.API_URL',
    'export const MAX_RETRIES = 3',
    '',
    'export function fetchUser(id: string): Promise<User> {',
    '  return api.get(`/users/${id}`)',
    '}',
    '',
    'export function updateConfig(config: Config): void {',
    '  const validated = validate(config)',
    '  store.set(validated)',
    '}',
    '',
    'export const helpers = {',
    '  format: (v: unknown) => String(v),',
    '  parse: (s: string) => JSON.parse(s),',
    '}',
  ].join('\n')
}

function makeHtmlDocument(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test</title>
</head>
<body>
  <main>
    <article>
      <h1>Title</h1>
      <p>Content here.</p>
    </article>
  </main>
  <footer><p>Footer text</p></footer>
</body>
</html>`
}

function makePlainProse(): string {
  return [
    'The quick brown fox jumps over the lazy dog.',
    'This is a plain English sentence with no special structure.',
    'Another paragraph of regular prose text follows here.',
    'The document continues with more ordinary language.',
    'Five lines of prose with no code, logs, or markup.',
  ].join('\n')
}

describe('Content detector — validation', () => {
  it('clear content types: each scores high confidence and maps to the right type', () => {
    const jsonResult = detectContent(makeJsonArray())
    expect(jsonResult.type).toBe('json')
    expect(jsonResult.confidence, 'JSON array must have confidence ≥0.9').toBeGreaterThanOrEqual(0.9)

    const logResult = detectContent(make100LineLog())
    expect(logResult.type).toBe('logs')
    expect(logResult.confidence, 'dense log file must have confidence ≥0.7').toBeGreaterThanOrEqual(0.7)

    const diffResult = detectContent(makeGitDiff())
    expect(diffResult.type).toBe('diff')
    expect(diffResult.confidence, 'git diff with 4 markers must have confidence ≥0.8').toBeGreaterThanOrEqual(0.8)

    const searchResult = detectContent(makeRipgrepOutput())
    expect(searchResult.type).toBe('search')
    expect(searchResult.confidence, 'dense search output must have confidence ≥0.7').toBeGreaterThanOrEqual(0.7)

    const codeResult = detectContent(makeTypeScriptSource())
    expect(codeResult.type).toBe('code')
    expect(codeResult.confidence, 'TypeScript source must have confidence ≥0.6').toBeGreaterThanOrEqual(0.6)

    const htmlResult = detectContent(makeHtmlDocument())
    expect(htmlResult.type).toBe('html')
    expect(htmlResult.confidence, 'full HTML document must have confidence ≥0.8').toBeGreaterThanOrEqual(0.8)

    const textResult = detectContent(makePlainProse())
    expect(textResult.type).toBe('text')
  })

  it('all returned DetectionResults have valid shape: type is a string, confidence 0–1, metadata is object', () => {
    const inputs = [makeJsonArray(), make100LineLog(), makeGitDiff(), makeRipgrepOutput(), makeTypeScriptSource(), makeHtmlDocument(), makePlainProse()]
    for (const input of inputs) {
      const d = detectContent(input)
      expect(d.type).toBeTypeOf('string')
      expect(d.confidence).toBeGreaterThanOrEqual(0)
      expect(d.confidence).toBeLessThanOrEqual(1)
      expect(d.metadata).toBeTypeOf('object')
    }
  })

  it('ambiguous / degenerate inputs: no throw, always returns valid type', () => {
    const empty = detectContent('')
    expect(empty.type).toBe('text')
    expect(empty.confidence).toBe(0)

    const singleLine = detectContent('Hello world')
    expect(singleLine.type).toBeTypeOf('string')
    expect(() => detectContent('Hello world')).not.toThrow()

    const whitespaceOnly = detectContent('   \n\n   \t  ')
    expect(whitespaceOnly.type).toBe('text')

    const singleObject = detectContent('{"a":1,"b":"two","c":true}')
    expect(singleObject.type).toBe('json')
    expect(singleObject.confidence).toBe(1)
  })

  it('borderline inputs: correct type wins over generic fallback', () => {
    const sparseLog = [
      'App started',
      'Listening on port 8080',
      '[10:00:00] INFO: Ready',
      'DB connected',
      'Cache warm',
    ].join('\n')
    const sparseResult = detectContent(sparseLog)
    expect(['logs', 'text']).toContain(sparseResult.type)
    expect(() => detectContent(sparseLog)).not.toThrow()

    const minimalDiff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')
    const diffResult = detectContent(minimalDiff)
    expect(diffResult.type).toBe('diff')
    expect(diffResult.confidence).toBeGreaterThanOrEqual(0.5)
  })
})
