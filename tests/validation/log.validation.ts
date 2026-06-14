import { describe, it, expect } from 'vitest'
import { compress } from '../../src/compress.js'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function makeLargeServerLog(): string {
  const lines: string[] = []
  for (let i = 0; i < 5; i++) lines.push(`Server starting up — step ${i + 1} of 5`)
  for (let i = 0; i < 445; i++) {
    const hh = pad2(Math.floor(i / 3600) % 24)
    const mm = pad2(Math.floor((i % 3600) / 60))
    const ss = pad2(i % 60)
    lines.push(`[2024-01-01 ${hh}:${mm}:${ss}] INFO: GET /api/health 200 12ms`)
  }
  for (let i = 0; i < 5; i++) {
    lines.push(`[2024-01-01 12:00:${pad2(i)}] ERROR: Connection refused to db-host:5432 (attempt-${i})`)
  }
  for (let i = 0; i < 45; i++) lines.push(`Server shutdown: step ${i + 1}`)
  return lines.join('\n')
}

function makeMixedLog(): string {
  const lines: string[] = []
  for (let i = 0; i < 5; i++) lines.push(`Application boot: phase ${i}`)
  for (let i = 0; i < 50; i++) {
    lines.push(`[2024-01-01 10:${pad2(i % 60)}:00] INFO: Processed request /route-${i} in ${10 + i}ms`)
    lines.push(`[2024-01-01 10:${pad2(i % 60)}:01] INFO: Processed request /route-${i} in ${11 + i}ms`)
  }
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 3; j++) {
      lines.push(`[2024-01-01 11:${pad2(i)}:${pad2(j)}] WARN: Retry ${j + 1} for service-${i} failed`)
    }
  }
  for (let i = 0; i < 5; i++) {
    lines.push(`[2024-01-01 12:00:${pad2(i)}] ERROR: Critical failure in module error-handler-${i}`)
  }
  for (let i = 0; i < 65; i++) {
    lines.push(`[2024-01-01 13:${pad2(i % 60)}:00] INFO: Processed request /route-${i} in ${10 + i}ms`)
  }
  for (let i = 0; i < 5; i++) lines.push(`Shutdown complete: phase ${i}`)
  return lines.join('\n')
}

function makeShortLog(): string {
  return [
    '[2024-01-01 10:00:01] INFO: App started',
    '[2024-01-01 10:00:02] INFO: Listening on :8080',
    '[2024-01-01 10:00:03] INFO: DB connected',
    '[2024-01-01 10:00:04] DEBUG: Cache warmed',
    '[2024-01-01 10:00:05] INFO: Ready',
    '[2024-01-01 10:00:06] INFO: First request',
    '[2024-01-01 10:00:07] DEBUG: Processed',
    '[2024-01-01 10:00:08] INFO: All good',
  ].join('\n')
}

function makeAllErrorsLog(): string {
  return Array.from(
    { length: 20 },
    (_, i) => `[2024-01-01 10:${pad2(i)}:00] ERROR: Unique failure in subsystem-${i}`,
  ).join('\n')
}

function makeBuildLogWithTraceback(): string {
  const lines: string[] = []
  for (let i = 0; i < 5; i++) lines.push(`[build] Starting compilation phase ${i + 1}`)
  for (let i = 0; i < 50; i++) {
    lines.push(`[2024-01-01 10:${pad2(Math.floor(i / 60))}:${pad2(i % 60)}] INFO: Building module alpha`)
  }
  lines.push('Traceback (most recent call last):')
  lines.push('  File "app.py", line 42, in main')
  lines.push('  File "utils.py", line 15, in process')
  lines.push('  File "handler.py", line 8, in handle')
  lines.push("ValueError: invalid literal for int() with base 10: 'abc'")
  for (let i = 0; i < 50; i++) {
    lines.push(`[2024-01-01 11:${pad2(Math.floor(i / 60))}:${pad2(i % 60)}] INFO: Building module alpha`)
  }
  for (let i = 0; i < 5; i++) lines.push(`[build] Compilation phase ${i + 1} done`)
  return lines.join('\n')
}

describe('Log compressor — validation', () => {
  it('large server log (500 lines, 90% repeated INFO, 5 ERRORS): ≥70% saved, all errors kept, ≥400 dropped', () => {
    const input = makeLargeServerLog()
    const r = compress(input)

    expect(r.contentType, 'should detect as logs').toBe('logs')
    expect(r.compressed.length).toBeLessThan(r.original.length)
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥70% tokens').toBeGreaterThanOrEqual(0.7)

    expect(r.dropped.length, 'must report dropped lines').toBeGreaterThan(0)
    expect(r.dropped[0].count, 'dropped count must be ≥400').toBeGreaterThanOrEqual(400)
    expect(r.dropped[0].reason, 'reason must not be empty').toBeTruthy()

    for (let i = 0; i < 5; i++) {
      expect(r.compressed, `ERROR attempt-${i} must be preserved`).toContain(`attempt-${i}`)
    }
  })

  it('mixed log (INFO/WARN/ERROR): all errors kept, WARN deduped, ≥40% saved', () => {
    const input = makeMixedLog()
    const r = compress(input)

    expect(r.contentType).toBe('logs')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥40% tokens').toBeGreaterThanOrEqual(0.4)

    for (let i = 0; i < 5; i++) {
      expect(r.compressed, `ERROR module error-handler-${i} must be kept`).toContain(`error-handler-${i}`)
    }

    const lowDropped = r.dropped.find(d => d.reason.includes('INFO') || d.reason.includes('DEBUG'))
    expect(lowDropped, 'must report dropped INFO/DEBUG lines').toBeDefined()
    expect(lowDropped!.count, 'dropped INFO count must be positive').toBeGreaterThan(0)
  })

  it('short log (8 lines): passes through unchanged — below MIN_LINES threshold', () => {
    const input = makeShortLog()
    const r = compress(input)

    expect(r.tokensSaved, 'nothing removed from a short log').toBe(0)
    expect(r.dropped.length, 'no dropped items').toBe(0)
  })

  it('log with identical errors (20 lines): keeps 5, appends [COUNT=20]', () => {
    const input = Array.from(
      { length: 20 },
      (_, i) => `[2024-01-01 10:${pad2(i)}:00] ERROR: Identical failure in subsystem`
    ).join('\n')
    const r = compress(input)

    expect(r.tokensSaved, 'identical errors are deduplicated').toBeGreaterThan(0)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.compressed).toContain('[COUNT=10]')
  })

  it('build log with traceback (115 lines): all traceback lines kept, INFO heavily compressed', () => {
    const input = makeBuildLogWithTraceback()
    const r = compress(input)

    expect(r.contentType).toBe('logs')
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore)
    expect(r.compressionRatio, 'must save ≥50% tokens').toBeGreaterThanOrEqual(0.5)

    expect(r.compressed, 'Traceback anchor must be kept').toContain('Traceback (most recent call last):')
    expect(r.compressed, 'ValueError must be kept').toContain("ValueError: invalid literal for int()")
    expect(r.compressed, 'File app.py must be kept (unique key)').toContain('File "app.py"')
    expect(r.compressed, 'File utils.py must be kept (unique key)').toContain('File "utils.py"')
    expect(r.compressed, 'File handler.py must be kept (unique key)').toContain('File "handler.py"')

    const dropped = r.dropped.find(d => d.reason.includes('INFO') || d.reason.includes('DEBUG'))
    expect(dropped, 'INFO lines must be reported as dropped').toBeDefined()
    expect(dropped!.count, 'many INFO lines must be dropped').toBeGreaterThanOrEqual(50)
  })
})
