import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

const FILES = [
  'src/auth.ts',
  'src/models.ts',
  'src/routes.ts',
  'src/middleware.ts',
  'src/utils.ts',
  'src/config.ts',
  'src/handlers.ts',
  'src/validators.ts',
  'src/services.ts',
  'src/types.ts',
]

function makeSearchResults(files: string[], matchesPerFile: number): string {
  const lines: string[] = []
  for (const file of files) {
    for (let i = 0; i < matchesPerFile; i++) {
      lines.push(`${file}:${100 + i}:    const result = processQuery(searchTerm)`)
    }
  }
  return lines.join('\n')
}

function makeSingleFileResults(matchCount: number): string {
  const lines: string[] = []
  for (let i = 0; i < matchCount; i++) {
    lines.push(`src/large.ts:${i + 1}:    handleRequest(req, res, searchQuery)`)
  }
  return lines.join('\n')
}

function makeMixedResults(): string {
  const lines: string[] = []
  lines.push('src/file1.ts:10:  singleMatch()')
  lines.push('src/file2.ts:20:  anotherSingleMatch()')
  for (let i = 0; i < 50; i++) {
    lines.push(`src/file3.ts:${i + 1}:  manyMatches(query, index_${i})`)
  }
  lines.push('src/file4.ts:30:  oneMoreSingleMatch()')
  return lines.join('\n')
}

describe('Search compressor — validation', () => {
  it('large results (300 matches, 10 files × 30 each): ≥60% saved, each file still has ≥3 matches', () => {
    const input = makeSearchResults(FILES, 30)
    const r = compress(input)

    expect(r.contentType, 'should detect as search').toBe('search')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥60% tokens').toBeGreaterThanOrEqual(0.6)

    expect(r.dropped.length, 'must report omitted matches').toBeGreaterThan(0)
    expect(r.dropped.every(d => d.count > 0), 'every dropped entry must have a positive count').toBe(true)
    expect(r.dropped.every(d => !!d.reason), 'every dropped entry must have a reason').toBe(true)

    for (const file of FILES) {
      expect(r.compressed, `${file} must still appear in output`).toContain(file)
      const lineCount = r.compressed.split('\n').filter(l => l.startsWith(file)).length
      expect(lineCount, `${file} must have ≥3 matches kept`).toBeGreaterThanOrEqual(3)
    }
  })

  it('single file with 50 matches: output has fewer than 50 matches for that file', () => {
    const input = makeSingleFileResults(50)
    const r = compress(input)

    expect(r.contentType).toBe('search')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)

    const keptLines = r.compressed.split('\n').filter(l => l.startsWith('src/large.ts:')).length
    expect(keptLines, 'must compress 50 matches down to fewer').toBeLessThan(50)
    expect(keptLines, 'must keep at least 3 matches (minK=3)').toBeGreaterThanOrEqual(3)

    expect(r.compressed, 'filename must still appear').toContain('src/large.ts')
    expect(r.dropped.length, 'must report omitted matches').toBeGreaterThan(0)
  })

  it('few files, few matches (2 files × 4 each): all matches kept, nothing aggressively dropped', () => {
    const input = makeSearchResults(['src/a.ts', 'src/b.ts'], 4)
    const r = compress(input)

    expect(r.dropped.length, '4 matches ≤ maxPerFile — nothing should be omitted').toBe(0)
    expect(r.tokensSaved, 'nothing dropped means zero savings').toBe(0)

    expect(r.compressed).toContain('src/a.ts')
    expect(r.compressed).toContain('src/b.ts')
    for (let i = 0; i < 4; i++) {
      expect(r.compressed, `match at line ${100 + i} in src/a.ts must be kept`).toContain(`src/a.ts:${100 + i}:`)
    }
  })

  it('mixed density (file1/2/4: 1 match, file3: 50 matches): sparse files fully kept, dense file compressed', () => {
    const input = makeMixedResults()
    const r = compress(input)

    expect(r.contentType).toBe('search')

    expect(r.compressed, 'file1 single match must be kept').toContain('src/file1.ts:10:')
    expect(r.compressed, 'file2 single match must be kept').toContain('src/file2.ts:20:')
    expect(r.compressed, 'file4 single match must be kept').toContain('src/file4.ts:30:')

    const file3Lines = r.compressed.split('\n').filter(l => l.startsWith('src/file3.ts:')).length
    expect(file3Lines, 'file3 must be compressed (50 → fewer)').toBeLessThan(50)
    expect(file3Lines, 'file3 must still have ≥3 matches').toBeGreaterThanOrEqual(3)

    expect(r.tokensAfter, 'file3 compression must reduce tokens').toBeLessThan(r.tokensBefore)
  })
})
