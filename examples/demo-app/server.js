import express from 'express';
import { compress, detectContent, segmentAndCompress, compressAsync } from 'tokencompress';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/compress', (req, res) => {
  try {
    const { text, targetRatio } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false, error: 'No input text provided.' });
    const ratio = parseFloat(targetRatio) || 0.5;
    const r = compress(text, { targetRatio: ratio });
    res.json({ ok: true, result: {
      compressed:       r.compressed,
      tokensBefore:     r.tokensBefore,
      tokensAfter:      r.tokensAfter,
      tokensSaved:      r.tokensSaved,
      compressionRatio: r.compressionRatio,
      contentType:      r.contentType,
      confidence:       r.confidence,
      dropped:          r.dropped,
      metrics:          r.metrics,
    }});
  } catch (e) { res.json({ ok: false, error: String(e) }); }
});

app.post('/compress-ml', async (req, res) => {
  try {
    const { text, targetRatio } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false, error: 'No input text provided.' });
    const ratio = parseFloat(targetRatio) || 0.5;
    const r = await compressAsync(text, { targetRatio: ratio });
    res.json({ ok: true, result: {
      compressed:       r.compressed,
      tokensBefore:     r.tokensBefore,
      tokensAfter:      r.tokensAfter,
      tokensSaved:      r.tokensBefore - r.tokensAfter,
      compressionRatio: r.tokensBefore > 0 ? (r.tokensBefore - r.tokensAfter) / r.tokensBefore : 0,
      contentType:      'ML Model',
    }});
  } catch (e) { res.json({ ok: false, error: String(e) }); }
});

app.post('/detect', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false, error: 'No input text provided.' });
    res.json({ ok: true, result: detectContent(text) });
  } catch (e) { res.json({ ok: false, error: String(e) }); }
});

app.post('/segment', (req, res) => {
  try {
    const { text, targetRatio } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false, error: 'No input text provided.' });
    const ratio = parseFloat(targetRatio) || 0.5;
    const r = segmentAndCompress(text, { targetRatio: ratio });
    res.json({ ok: true, result: r });
  } catch (e) { res.json({ ok: false, error: String(e) }); }
});

const PORT = 3456;
app.listen(PORT, () => {
  console.log(`\n  tokencompress demo → http://localhost:${PORT}\n`);
});
