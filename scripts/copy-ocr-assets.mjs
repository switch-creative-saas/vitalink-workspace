// Copies the on-device text reader (Tesseract) into public/ocr so scanning paper registers needs
// no third-party CDN and works offline once loaded. Runs before dev and build.
// Files are found through Node's resolver, so this works with npm and pnpm (where tesseract.js-core
// sits inside tesseract.js's own dependencies, not at the top of node_modules).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = (name, from = require) => dirname(from.resolve(`${name}/package.json`));

function sources() {
  const tesseract = packageDir('tesseract.js');
  const core = packageDir('tesseract.js-core', createRequire(join(tesseract, 'package.json')));
  const lang = packageDir('@tesseract.js-data/eng');
  return [
    [join(tesseract, 'dist/worker.min.js'), 'public/ocr/worker.min.js'],
    [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'public/ocr/core/tesseract-core-simd-lstm.wasm.js'],
    [join(core, 'tesseract-core-lstm.wasm.js'), 'public/ocr/core/tesseract-core-lstm.wasm.js'],
    [join(lang, '4.0.0_best_int/eng.traineddata.gz'), 'public/ocr/lang/eng.traineddata.gz'],
  ];
}

try {
  for (const [from, to] of sources()) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  console.log('[ocr] reader files copied to public/ocr');
} catch (error) {
  // Without these the app still builds; only register-photo scanning is unavailable.
  console.warn(`[ocr] could not copy the reader files: ${error.message}`);
}
