/** Small helpers shared across compressors. */

/** Truncate a string to `max` chars for use as a `DroppedItem.sample`. */
export function sample(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}
