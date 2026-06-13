import { getEncoding } from 'js-tiktoken'
const enc = getEncoding('cl100k_base')
try {
  console.log(enc.encode('hello <|endoftext|> world', 'all').length)
} catch (e) {
  console.error("Caught error:", e.message)
}
