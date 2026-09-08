const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const sharp = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));
const { cleanedImage } = require('../benchmark.cjs');

// Catches alpha inversion hiding the glyphs in real clipboard PNGs.
test('cleanup keeps an RGBA screenshot opaque for OCR', async () => {
  const input = path.join(__dirname, '../samples/codex-clipboard-3963e9a7-949e-40ab-b693-e12ed302c201.png');
  const output = await cleanedImage(input);
  assert.equal((await sharp(output).stats()).isOpaque, true);
});

// Catches image pipeline ordering that inverts the padding or loses the glyph.
test('preprocessing preserves a dark glyph on white background and white padding', async () => {
  const pixels = Buffer.alloc(30 * 30 * 3);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
    const white = x >= 10 && x < 20 && y >= 10 && y < 20;
    pixels.set(white ? [255, 255, 255] : [0, 100, 220], (y * 30 + x) * 3);
  }
  const input = await sharp(pixels, { raw: { width: 30, height: 30, channels: 3 } }).png().toBuffer();
  const output = await cleanedImage(input);
  const { data, info } = await sharp(output).greyscale().raw().toBuffer({ resolveWithObject: true });
  console.log('Pixel diagnostics:', { padding: data[0], background: data[30 * info.width + 30], glyph: data[65 * info.width + 65] });
  assert.equal(data[0], 255, 'Padding must remain white');
  assert.equal(data[30 * info.width + 30], 255, 'Blue background must become white');
  assert.equal(data[65 * info.width + 65], 0, 'White glyph must become black');
});
