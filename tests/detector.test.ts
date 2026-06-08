import { describe, it, expect } from 'vitest'
import { detectType } from '../src/detector/content-detector.js'

describe('detectType', () => {
  it('detects JSON arrays and objects', () => {
    expect(detectType('[{"a":1},{"b":2}]')).toBe('json')
    expect(detectType('{"key": "value"}')).toBe('json')
  })

  it('does not treat invalid JSON-looking text as json', () => {
    expect(detectType('[this is not json at all really')).not.toBe('json')
  })

  it('detects git diffs', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      'index 123..456 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
      ' context',
    ].join('\n')
    expect(detectType(diff)).toBe('diff')
  })

  it('detects search results', () => {
    const search = [
      'src/a.ts:12:const x = 1',
      'src/a.ts:34:function y() {}',
      'src/b.ts:5:export default z',
      'src/c.ts:99:return true',
    ].join('\n')
    expect(detectType(search)).toBe('search')
  })

  it('detects logs', () => {
    const logs = [
      '[2024-06-07 10:23:45] INFO: started',
      '[2024-06-07 10:23:46] DEBUG: connecting',
      '[2024-06-07 10:23:47] ERROR: failed',
      '[2024-06-07 10:23:48] WARN: retrying',
    ].join('\n')
    expect(detectType(logs)).toBe('logs')
  })

  it('detects code', () => {
    const code = [
      'import os',
      'def main():',
      '    return 1',
      'class Foo:',
      '    pass',
    ].join('\n')
    expect(detectType(code)).toBe('code')
  })

  it('falls back to text', () => {
    expect(detectType('Just some regular prose about a topic.')).toBe('text')
    expect(detectType('')).toBe('text')
  })
})
