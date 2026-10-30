// Copies the on-device text reader (Tesseract) into public/ocr so scanning paper registers needs
// no third-party CDN and works offline once loaded. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/ocr/core/tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/lang/eng.traineddata.gz'],
];

for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn(`[ocr] missing ${from}; scanning paper registers will be unavailable`); continue; }
  mkdirSync(dirname(join(to)), { recursive: true });
  copyFileSync(from, to);
}
