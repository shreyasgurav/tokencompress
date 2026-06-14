/**
 * HTML compressor.
 *
 * Raw HTML pasted into a prompt is mostly markup the model doesn't need:
 * scripts, styles, SVG paths, inline event handlers, and deeply nested
 * layout tags. We extract the readable text content and drop the markup,
 * reporting what categories of noise were removed.
 *
 * This is extraction, not summarisation — every word of visible text is
 * preserved; only non-content markup is removed.
 */
import type { CompressorOutput, DroppedItem, ResolvedOptions } from '../types.js'


/** Count newlines in a string region (for reporting dropped "lines"). */
function countLines(s: string): number {
  if (s.length === 0) return 0
  return s.split('\n').length
}

/** Minimal entity decoding for the handful that survive tag stripping. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function compressHtml(text: string, _opts: ResolvedOptions): CompressorOutput {
  void _opts
  let working = text
  const dropped: DroppedItem[] = []

  // ── Pass 1: drop <script> and <style> blocks entirely ───────────────────
  let scriptLines = 0
  working = working.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => {
    scriptLines += countLines(m)
    return ''
  })
  let styleLines = 0
  working = working.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => {
    styleLines += countLines(m)
    return ''
  })
  if (scriptLines > 0) dropped.push({ reason: '<script> blocks', count: scriptLines })
  if (styleLines > 0) dropped.push({ reason: '<style> blocks', count: styleLines })

  // ── Pass 2: drop HTML comments, <head>, <svg>, <noscript> ───────────────
  let commentCount = 0
  working = working.replace(/<!--[\s\S]*?-->/g, () => {
    commentCount++
    return ''
  })
  working = working.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
  let svgCount = 0
  working = working.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, () => {
    svgCount++
    return ''
  })
  working = working.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  if (commentCount > 0) dropped.push({ reason: 'HTML comments', count: commentCount })
  if (svgCount > 0) dropped.push({ reason: 'inline <svg> markup', count: svgCount })

  // ── Pass 3: convert block-level tags to newlines so text stays readable ──
  working = working.replace(
    /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|br|ul|ol|table)\s*>/gi,
    '\n',
  )
  working = working.replace(/<br\s*\/?>/gi, '\n')

  // ── Pass 4: strip all remaining tags, count them as dropped ─────────────
  let tagCount = 0
  working = working.replace(/<[^>]+>/g, () => {
    tagCount++
    return ''
  })
  if (tagCount > 0) {
    dropped.push({ reason: 'HTML tags (markup stripped, text kept)', count: tagCount })
  }

  // ── Pass 5: decode entities and normalise whitespace ────────────────────
  working = decodeEntities(working)
  working = working
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    compressed: working,
    dropped,
    transforms: [`html:extract(tags:${tagCount} scripts:${scriptLines} styles:${styleLines})`],
  }
}
