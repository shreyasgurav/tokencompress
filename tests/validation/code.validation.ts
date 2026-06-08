import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function makeTsWithJSDoc(): string {
  const fnNames = ['getUser', 'fetchProfile', 'updateRecord', 'deleteItem', 'listResources']
  const lines: string[] = [
    "import { db } from './database'",
    "import { cache } from './cache'",
    "import type { User, Profile, Record, Item, Resource } from './types'",
    '',
  ]
  for (const name of fnNames) {
    lines.push('/**')
    lines.push(` * Performs the ${name} operation.`)
    lines.push(` * @param id - The identifier to look up`)
    lines.push(` * @param options - Configuration options for this call`)
    lines.push(` * @returns Promise resolving to the result object`)
    lines.push(` * @throws {NotFoundError} When the resource does not exist`)
    lines.push(` * @example`)
    lines.push(` * const result = await ${name}('abc', { timeout: 5000 })`)
    lines.push(' */')
    lines.push(`async function ${name}(id: string, options: Options): Promise<Result> {`)
    lines.push('  const cached = await cache.get(id)')
    lines.push('  if (cached) return cached')
    lines.push('  const result = await db.find(id, options)')
    lines.push('  await cache.set(id, result)')
    lines.push('  return result')
    lines.push('}')
    lines.push('')
  }
  return lines.join('\n')
}

function makePythonWithDocstrings(): string {
  return [
    'import numpy as np',
    'import pandas as pd',
    'from typing import Dict, List, Optional',
    'from dataclasses import dataclass',
    'from collections import defaultdict',
    '',
    'class MetricsEngine:',
    '    def __init__(self, window_size=10):',
    '        self.window_size = window_size',
    '',
    'def calculate_metrics(data, window_size=10):',
    '    """',
    '    Calculate rolling metrics for the given data.',
    '    Args:',
    '        data: Input data array',
    '        window_size: Size of rolling window',
    '    Returns:',
    '        dict: Calculated metrics including mean, std, min, max',
    '    """',
    '    result = {}',
    '    return result',
    '',
    'def normalize_data(data, method="zscore"):',
    "    '''",
    '    Normalize the input data array.',
    '    Parameters:',
    '        data: Raw input array to normalize',
    '        method: Normalization method (zscore or minmax)',
    "    '''",
    '    return data',
    '',
    'def aggregate_values(values):',
    '    """Aggregate the values into a single summary statistic."""',
    '    return sum(values)',
    '',
    'def transform_pipeline(data):',
    '    """Run the data through the configured transform pipeline."""',
    '    return data',
  ].join('\n')
}

function makeCodeWithInlineComments(): string {
  const lines: string[] = []
  for (let i = 0; i < 50; i++) {
    lines.push(`const value${i} = computeResult(${i}) // result for iteration ${i}`)
  }
  return lines.join('\n')
}

function makeCodeWithExcessiveBlanks(): string {
  const lines: string[] = []
  for (let i = 0; i < 30; i++) {
    lines.push(`export function handler${i}(req: Request, res: Response): void {`)
    lines.push(`  res.json({ handler: ${i} })`)
    lines.push('}')
    if (i < 29) {
      for (let b = 0; b < 5; b++) lines.push('    ')
    }
  }
  return lines.join('\n')
}

describe('Code compressor — validation', () => {
  it('TypeScript with JSDoc (5 functions, 40%+ comment lines): docs stripped, signatures kept, ≥25% saved', () => {
    const input = makeTsWithJSDoc()
    const r = compress(input)

    expect(r.contentType, 'should detect as code').toBe('code')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥25% tokens').toBeGreaterThanOrEqual(0.25)

    expect(r.dropped.length, 'must report dropped comments').toBeGreaterThan(0)

    const blockDropped = r.dropped.find(d => d.reason.includes('block comments'))
    expect(blockDropped, 'JSDoc blocks must be reported as dropped').toBeDefined()
    expect(blockDropped!.count, 'block comment count must be positive').toBeGreaterThan(0)

    for (const name of ['getUser', 'fetchProfile', 'updateRecord', 'deleteItem', 'listResources']) {
      expect(r.compressed, `async function ${name} signature must be kept`).toContain(`async function ${name}`)
    }
  })

  it('Python with triple-quoted docstrings: def signatures kept, docstrings removed', () => {
    const input = makePythonWithDocstrings()
    const r = compress(input)

    expect(r.contentType).toBe('code')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)

    expect(r.dropped.length, 'must report dropped docstrings').toBeGreaterThan(0)
    const blockDropped = r.dropped.find(d => d.reason.includes('block comments') || d.reason.includes('docstring'))
    expect(blockDropped, 'docstrings must be reported as dropped').toBeDefined()

    expect(r.compressed, 'def calculate_metrics must remain').toContain('def calculate_metrics')
    expect(r.compressed, 'def normalize_data must remain').toContain('def normalize_data')
    expect(r.compressed, 'triple-quoted content must not remain').not.toContain('Calculate rolling metrics')
    expect(r.compressed, 'triple-quoted content must not remain').not.toContain('Normalize the input')
  })

  it('code with only inline comments (no full-line comments): minimal change, inline comments preserved', () => {
    const input = makeCodeWithInlineComments()
    const r = compress(input)

    expect(r.tokensSaved, 'inline comments are never stripped').toBe(0)
    expect(r.compressed, 'inline comment text must survive').toContain('// result for iteration 0')

    expect(r.dropped.every(d => !d.reason.includes('full-line')), 'no full-line comment drops').toBe(true)
  })

  it('code with 5 blank lines between each function (30 functions): blanks collapsed, all functions kept', () => {
    const input = makeCodeWithExcessiveBlanks()
    const r = compress(input)

    expect(r.contentType).toBe('code')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)

    const blankDropped = r.dropped.find(d => d.reason.includes('blank'))
    expect(blankDropped, 'must report collapsed blank lines').toBeDefined()
    expect(blankDropped!.count, 'must drop ≥100 blank lines').toBeGreaterThanOrEqual(100)

    for (let i = 0; i < 30; i++) {
      expect(r.compressed, `export function handler${i} must be present`).toContain(`handler${i}`)
    }

    const maxConsecutiveBlanks = (r.compressed.match(/\n(\n)+/g) ?? []).reduce(
      (max, run) => Math.max(max, run.length - 1),
      0,
    )
    expect(maxConsecutiveBlanks, 'no more than 2 consecutive blank lines after compression').toBeLessThanOrEqual(2)
  })
})
