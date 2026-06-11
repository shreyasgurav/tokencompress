import { compressML } from '../src/compressors/ml-compressor.js'
import fs from 'fs'

async function run() {
  console.log('Generating dummy text...')
  let text = ''
  for (let i = 0; i < 2000; i++) {
    if (i % 3 === 0) text += 'Yeah, sounds good to me. '
    else if (i % 5 === 0) text += 'Error: NullPointerException occurred at line fifty. '
    else text += `This is a standard sentence with some completely random vocabulary to test the frequency. `
  }

  const opts = { model: 'gpt-4o', targetRatio: 0.5, includeHtml: false } as any

  console.log('Starting compression...')
  const start = Date.now()
  const result = await compressML(text, opts)
  const end = Date.now()

  console.log(`Compression took: ${(end - start) / 1000} seconds`)
  console.log(`Transforms: ${result.transforms.join(', ')}`)
}

run()
