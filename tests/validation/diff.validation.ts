import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function makeLargeDiff(): string {
  const lines: string[] = []
  lines.push('diff --git a/src/service.ts b/src/service.ts')
  lines.push('--- a/src/service.ts')
  lines.push('+++ b/src/service.ts')

  for (let hunk = 0; hunk < 5; hunk++) {
    const base = hunk * 100 + 1
    lines.push(`@@ -${base},22 +${base},22 @@`)
    for (let c = 0; c < 20; c++) {
      lines.push(` const line${base + c} = doSomething(${base + c})`)
    }
    lines.push(`-  oldBehavior_${hunk}(input)`)
    lines.push(`+  newBehavior_${hunk}(input)`)
    lines.push(`-  legacyCall_${hunk}(ctx)`)
    lines.push(`+  modernCall_${hunk}(ctx)`)
  }
  return lines.join('\n')
}

function makeNewFileDiff(): string {
  const lines: string[] = []
  lines.push('diff --git a/newfile.ts b/newfile.ts')
  lines.push('new file mode 100644')
  lines.push('index 0000000..abc1234')
  lines.push('--- /dev/null')
  lines.push('+++ b/newfile.ts')
  lines.push('@@ -0,0 +1,50 @@')
  for (let i = 1; i <= 50; i++) {
    lines.push(`+export const value${i} = processItem(${i})`)
  }
  return lines.join('\n')
}

function makeSmallDiff(): string {
  return [
    'diff --git a/tiny.ts b/tiny.ts',
    '--- a/tiny.ts',
    '+++ b/tiny.ts',
    '@@ -1,5 +1,5 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    ' const c = 4',
    ' const d = 5',
    ' const e = 6',
    ' const f = 7',
    ' const g = 8',
    ' const h = 9',
    ' const i = 10',
    ' const j = 11',
  ].join('\n')
}

function makeRenameDiff(): string {
  const lines: string[] = []
  lines.push('diff --git a/OldComponent.tsx b/NewComponent.tsx')
  lines.push('rename from OldComponent.tsx')
  lines.push('rename to NewComponent.tsx')
  lines.push('index abc1234..def5678 100644')
  lines.push('--- a/OldComponent.tsx')
  lines.push('+++ b/NewComponent.tsx')
  lines.push('@@ -1,30 +1,30 @@')
  for (let i = 0; i < 10; i++) {
    lines.push(` import { dep${i} } from './deps'`)
  }
  lines.push('-export const OldComponent = () => <div className="old">Legacy</div>')
  lines.push('+export const NewComponent = () => <div className="new">Modern</div>')
  for (let i = 0; i < 18; i++) {
    lines.push(` // implementation line ${i + 1} unchanged`)
  }
  return lines.join('\n')
}

describe('Diff compressor — validation', () => {
  it('large diff (5 hunks, 20 context each): all changes kept, ≥40% tokens saved, context capped at 3', () => {
    const input = makeLargeDiff()
    const r = compress(input)

    expect(r.contentType, 'should detect as diff').toBe('diff')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥40% tokens').toBeGreaterThanOrEqual(0.4)

    expect(r.dropped.length, 'must report dropped context').toBeGreaterThan(0)
    expect(r.dropped[0].reason).toContain('unchanged context')
    expect(r.dropped[0].count, 'must drop ≥50 context lines').toBeGreaterThanOrEqual(50)

    for (let hunk = 0; hunk < 5; hunk++) {
      expect(r.compressed, `@@ hunk ${hunk} header must be present`).toContain(`@@ -${hunk * 100 + 1}`)
      expect(r.compressed, `removed line hunk ${hunk} must be kept`).toContain(`-  oldBehavior_${hunk}`)
      expect(r.compressed, `added line hunk ${hunk} must be kept`).toContain(`+  newBehavior_${hunk}`)
    }
  })

  it('new file diff (50 additions only): all + lines kept, nothing dropped', () => {
    const input = makeNewFileDiff()
    const r = compress(input)

    expect(r.contentType).toBe('diff')
    expect(r.dropped.length, 'no context to strip from pure addition').toBe(0)
    expect(r.tokensSaved, 'no savings when nothing is dropped').toBe(0)

    for (let i = 1; i <= 50; i++) {
      expect(r.compressed, `+export const value${i} must be present`).toContain(`value${i}`)
    }
  })

  it('small diff (15 lines): passes through unchanged — below MIN_LINES threshold', () => {
    const input = makeSmallDiff()
    const r = compress(input)

    expect(r.tokensSaved, 'small diffs pass through').toBe(0)
    expect(r.dropped.length).toBe(0)
  })

  it('rename diff: both changed lines kept, headers present, tokens saved', () => {
    const input = makeRenameDiff()
    const r = compress(input)

    expect(r.contentType).toBe('diff')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.dropped[0].count).toBeGreaterThan(0)

    expect(r.compressed, 'rename-from header must be present').toContain('rename from OldComponent.tsx')
    expect(r.compressed, 'rename-to header must be present').toContain('rename to NewComponent.tsx')
    expect(r.compressed, 'removed line must be kept').toContain('-export const OldComponent')
    expect(r.compressed, 'added line must be kept').toContain('+export const NewComponent')
  })
})
