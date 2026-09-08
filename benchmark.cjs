// Throwaway local OCR feasibility experiment. No ticketing-site connection.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const modules = process.env.TICKET_NODE_MODULES || path.join(os.homedir(), '.cache', 'codex-runtimes',
  'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const sharp = require(path.join(modules, 'sharp'));
const { createWorker, PSM } = require(path.join(modules, 'tesseract.js'));
const manifest = require('./samples.json');

async function cleanedImage(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, right = -1, top = info.height, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const [r, g, b] = data.subarray(offset, offset + 3);
      if (b > 120 && b > r + 60 && g > r + 20) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) throw new Error('No blue sample region found.');
  const cleaned = await sharp(input).removeAlpha().extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize({ width: (right - left + 1) * 3 }).negate().greyscale().normalize().threshold(140)
    .png().toBuffer();
  // Sharp may reorder operations: add padding only after inversion is complete.
  return sharp(cleaned).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' })
    .png().toBuffer();
}

async function main() {
  const samplesDir = path.join(__dirname, 'samples');
  const cacheDir = path.join(__dirname, '.ocr-cache');
  await fs.mkdir(samplesDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  for (const sample of manifest.samples) {
    const target = path.join(samplesDir, sample.file);
    try { await fs.access(target); }
    catch { await fs.copyFile(path.join(os.tmpdir(), sample.file), target); }
  }
  console.log('Initializing Tesseract; the English model may download once. Images stay local.');
  const started = performance.now();
  const worker = await createWorker('eng', 1, { cachePath: cacheDir }, {
    load_system_dawg: '0', load_freq_dawg: '0', load_number_dawg: '0',
  });
  const startupMs = Math.round(performance.now() - started);
  const records = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD,
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', user_defined_dpi: '300' });
    for (const sample of manifest.samples) {
      const input = await fs.readFile(path.join(samplesDir, sample.file));
      for (const variant of ['original', 'cleaned']) {
        const began = performance.now();
        const image = variant === 'original' ? input : await cleanedImage(input);
        const { data } = await worker.recognize(image);
        const elapsedMs = Math.round(performance.now() - began);
        const text = data.text.replace(/\s+/g, '').toLowerCase();
        const row = { id: sample.id, variant, expected: sample.expected, text,
          confidence: data.confidence, elapsedMs, matchesProvisionalLabel: text === sample.expected,
          experimentalAutoCandidate: /^[a-z]{4}$/.test(text) && data.confidence >= 90 };
        records.push(row);
        console.log(JSON.stringify(row));
      }
    }
  } finally { await worker.terminate(); }
  const summary = ['original', 'cleaned'].map(variant => {
    const rows = records.filter(row => row.variant === variant);
    const times = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
    const candidates = rows.filter(row => row.experimentalAutoCandidate);
    return { variant, count: rows.length,
      matchesProvisionalLabels: rows.filter(row => row.matchesProvisionalLabel).length,
      medianMs: (times[4] + times[5]) / 2, maxMs: Math.max(...times),
      autoCandidatesAt90: candidates.length,
      wrongAutoCandidatesAt90: candidates.filter(row => !row.matchesProvisionalLabel).length };
  });
  const report = { generatedAt: new Date().toISOString(), engine: 'Tesseract.js 7.0.0 English LSTM',
    labelSource: manifest.labelSource, startupMs, summary, records,
    limitations: ['Ten selected practice images; no held-out or live-site evaluation.',
      'Labels are provisional visual readings, not authoritative answers.',
      'Confidence is an OCR score, not a calibrated probability. Threshold 90 is illustrative.',
      'Timings exclude browser capture, submission, and server response.',
      'No browser integration or ticket purchasing is implemented.'] };
  await fs.writeFile(path.join(__dirname, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ startupMs, summary }, null, 2));
}
module.exports = { cleanedImage };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
