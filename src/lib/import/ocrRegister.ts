// Reads a photographed register page on the device (Tesseract, served from /ocr; no AI service and
// nothing leaves the browser) and rebuilds it as a table for patientImport.ts.
//
// Handwriting is hard for any text reader, so the table is rebuilt from where words sit under the
// headings, and then repaired the way a records officer would: register serial numbers run 1, 2,
// 3…, card numbers usually follow them (OP001, OP002…), and dates never go backwards. Two-page
// spreads (the same headings twice across the page) become one list. Every cell the reader wasn't
// sure of is passed on so the review screen can highlight it.
import type { Detected, FieldKey } from './patientImport';
import { FIELD_LABELS, parseSex } from './patientImport';

export interface Word { text: string; conf: number; x0: number; x1: number; y0: number; y1: number; field?: FieldKey }
type Tess = typeof import('tesseract.js');

let workerPromise: Promise<Awaited<ReturnType<Tess['createWorker']>>> | null = null;

async function worker(onProgress?: (share: number) => void) {
  progressListener = onProgress ?? null;
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') progressListener?.(m.progress);
      },
    }));
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}
let progressListener: ((share: number) => void) | null = null;

/**
 * Loads the reader in the background (about 7 MB the first time) so it is ready, and saved by the
 * offline app, before anyone needs it. Called when the Import window opens.
 */
export function preloadReader() {
  void worker().catch(() => undefined);
}

/** Larger, greyscale and a little sharper: what the reader does best with. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(4000 / bitmap.width, Math.max(1, 2800 / bitmap.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.35)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Heading words as registers write them, including how the reader tends to misread them.
const HEADINGS: Array<[string, FieldKey | 'serial' | 'other']> = [
  ['no', 'serial'], ['s n', 'serial'], ['sn', 'serial'], ['serial', 'serial'], ['s no', 'serial'],
  ['date', 'referenceDate'], ['card no', 'previousNumber'], ['card number', 'previousNumber'], ['hosp no', 'previousNumber'], ['hospital no', 'previousNumber'],
  ['folder no', 'previousNumber'], ['file no', 'previousNumber'], ['reg no', 'previousNumber'], ['op no', 'previousNumber'], ['patient no', 'previousNumber'],
  ['patient name', 'fullName'], ['name of patient', 'fullName'], ['name', 'fullName'], ['names', 'fullName'], ['patients name', 'fullName'],
  ['surname', 'lastName'], ['other names', 'firstName'], ['first name', 'firstName'],
  ['age', 'age'], ['age yrs', 'age'], ['sex', 'sex'], ['gender', 'sex'], ['m f', 'sex'],
  ['address', 'address'], ['phone', 'phone'], ['phone no', 'phone'], ['tel', 'phone'], ['gsm', 'phone'],
  ['dob', 'dateOfBirth'], ['date of birth', 'dateOfBirth'], ['nok', 'emergencyContactName'], ['next of kin', 'emergencyContactName'],
  ['complaint', 'other'], ['complaints', 'other'], ['diagnosis', 'other'], ['remarks', 'other'], ['remark', 'other'], ['outcome', 'other'],
  ['treatment', 'other'], ['signature', 'other'], ['sign', 'other'], ['ward', 'other'], ['occupation', 'occupation'], ['state', 'state'],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function distance(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function heading(text: string): FieldKey | 'serial' | 'other' | null {
  const t = norm(text);
  if (!t) return null;
  let best: [number, FieldKey | 'serial' | 'other'] | null = null;
  for (const [word, field] of HEADINGS) {
    const allowed = word.length >= 7 ? 2 : word.length >= 4 ? 1 : word.length === 3 ? 1 : 0;
    const d = distance(t, word);
    if (d <= allowed && (!best || d < best[0])) best = [d, field];
  }
  return best?.[1] ?? null;
}

interface Column { label: string; field: FieldKey | 'serial' | 'other' | null; x0: number; x1: number }

/** Groups words into printed lines by their height on the page. */
function lines(words: Word[]) {
  const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 20;
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows: Array<{ y: number; words: Word[] }> = [];
  for (const w of sorted) {
    const y = (w.y0 + w.y1) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(y - row.y) < h * 0.6) {
      row.words.push(w);
      row.y = row.words.reduce((sum, x) => sum + (x.y0 + x.y1) / 2, 0) / row.words.length;
    } else rows.push({ y, words: [w] });
  }
  rows.forEach((r) => r.words.sort((a, b) => a.x0 - b.x0));
  return { rows, h };
}

/** Heading phrases on one line (one to three words each). */
export function headingColumns(words: Word[], h: number): Column[] {
  const out: Column[] = [];
  for (let i = 0; i < words.length;) {
    let taken = 0;
    for (const n of [3, 2, 1]) {
      const slice = words.slice(i, i + n);
      if (slice.length < n || slice.some((w, k) => k > 0 && w.x0 - slice[k - 1].x1 > h * 2.5)) continue;
      const field = heading(slice.map((w) => w.text).join(' '));
      if (field) {
        out.push({ label: slice.map((w) => w.text).join(' '), field, x0: slice[0].x0, x1: slice[n - 1].x1 });
        taken = n;
        break;
      }
    }
    if (!taken) {
      const w = words[i];
      const last = out[out.length - 1];
      if (last && last.field === null && w.x0 - last.x1 < h * 1.5) { last.label += ` ${w.text}`; last.x1 = w.x1; }
      else if (/[a-z]{2,}/i.test(w.text)) out.push({ label: w.text, field: null, x0: w.x0, x1: w.x1 });
      taken = 1;
    }
    i += taken;
  }
  return out;
}

// What the reader puts in place of digits and slashes in handwritten numbers.
const DIGIT: Record<string, string> = { o: '0', O: '0', Q: '0', D: '0', l: '1', I: '1', i: '1', '|': '1', '!': '1', z: '2', Z: '2', '#': '4', s: '5', S: '5', $: '5', b: '6', G: '6', T: '7', B: '8', '&': '8', g: '9', q: '9' };
const digits = (s: string) => s.split('').map((c) => DIGIT[c] ?? c).join('').replace(/[^\d]/g, '');

function readDate(raw: string): string | null {
  const parts = raw.replace(/[fj[\](){}\\.,\-–]/g, '/').split('/').map(digits).filter(Boolean);
  let d: number; let m: number; let y: number;
  if (parts.length === 3) [d, m, y] = parts.map(Number);
  else {
    const all = digits(raw);
    if (all.length !== 6 && all.length !== 8) return null;
    [d, m, y] = [Number(all.slice(0, 2)), Number(all.slice(2, 4)), Number(all.slice(4))];
  }
  if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDate() !== d || date.getUTCMonth() !== m - 1 || date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

/** Two-page spreads repeat the headings: each repeat starts another table. */
export function splitGroups(columns: Column[]) {
  const groups: Column[][] = [[]];
  for (const c of columns) {
    const current = groups[groups.length - 1];
    if (current.some((x) => (c.field && c.field !== 'other' && x.field === c.field) || norm(x.label) === norm(c.label))) groups.push([c]);
    else current.push(c);
  }
  return groups.filter((g) => g.length >= 3);
}

interface Strip { field: FieldKey; left: number; top: number; width: number; height: number }
export interface ScannedRegister { detected: Detected; uncertain: Map<string, Set<number>>; tables: number; strips: Strip[] }

// Short entries (an age, an M or F) are easy to miss when reading a whole page, so a cell that came
// out blank or unsure is read again on its own, allowing only the characters it can hold.
const STRIP_CHARS: Partial<Record<FieldKey, string>> = { age: '0123456789', sex: '' };
const STRIP_MODE: Partial<Record<FieldKey, string>> = { age: '8', sex: '8' }; // one word each

/** A handwritten M reads as "m"; a handwritten F often as "E", "EE" or "ER". Ruled lines read as | L ]. */
function readSexMark(text: string): 'M' | 'F' | null {
  const t = text.replace(/[^A-Za-z]/g, '').replace(/[LIlJj]/g, '');
  if (/m/i.test(t) || /^(rn|nn|n)$/i.test(t)) return 'M';
  if (/[ef]/i.test(t)) return 'F';
  return null;
}

export async function readRegisterPhoto(file: Blob, onProgress?: (share: number) => void): Promise<ScannedRegister> {
  const reader = await worker((share) => onProgress?.(share * 0.75));
  const canvas = await prepare(file);
  const words = await readWords(reader, canvas, { tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
  const first = wordsToTable(words);
  const refills: Word[] = [];
  progressListener = null;
  let done = 0;
  for (const field of Object.keys(STRIP_CHARS) as FieldKey[]) {
    const cells = first.strips.filter((strip) => strip.field === field);
    if (!cells.length) continue;
    await reader.setParameters({ tessedit_pageseg_mode: STRIP_MODE[field] ?? '7', tessedit_char_whitelist: STRIP_CHARS[field] ?? '' } as never);
    for (const cell of cells) {
      // Each cell cut out and enlarged on its own small canvas: quicker to send, easier to read.
      const zoom = 3;
      const pad = 12;
      const crop = document.createElement('canvas');
      crop.width = cell.width * zoom + pad * 2;
      crop.height = cell.height * zoom + pad * 2;
      const ctx = crop.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, crop.width, crop.height);
      // Inside the ruled lines either side of the column.
      const inset = Math.round(cell.width * 0.12);
      ctx.drawImage(canvas, cell.left + inset, cell.top, cell.width - inset * 2, cell.height, pad + inset * zoom, pad, (cell.width - inset * 2) * zoom, cell.height * zoom);
      const { data } = await reader.recognize(crop, {}, { blocks: true });
      for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) for (const w of line.words) {
        let text = w.text.trim();
        let conf = w.confidence;
        if (field === 'sex') {
          // Only a clean single M or F counts as read; anything worked out from a smudge is shown for checking.
          const clean = text.replace(/[^A-Za-z]/g, '').replace(/[LIlJj]/g, '');
          text = readSexMark(text) ?? '';
          if (!/^[MFmf]$/.test(clean)) conf = Math.min(conf, 55);
        }
        if (!text) continue;
        const back = (v: number, origin: number) => origin + (v - pad) / zoom;
        refills.push({ text, conf, field, x0: back(w.bbox.x0, cell.left), x1: back(w.bbox.x1, cell.left), y0: back(w.bbox.y0, cell.top), y1: back(w.bbox.y1, cell.top) });
      }
      done += 1;
      onProgress?.(0.75 + (0.25 * done) / first.strips.length);
    }
  }
  await reader.setParameters({ tessedit_char_whitelist: '' });
  return refills.length ? wordsToTable(words, refills) : first;
}

async function readWords(reader: Awaited<ReturnType<typeof worker>>, canvas: HTMLCanvasElement, params: Record<string, string>, rectangle?: Strip): Promise<Word[]> {
  await reader.setParameters({ ...params, preserve_interword_spaces: '1' } as never);
  const area = rectangle ? { rectangle: { left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height } } : {};
  const { data } = await reader.recognize(canvas, area, { blocks: true });
  const words: Word[] = [];
  for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) for (const w of line.words) {
    const text = w.text.replace(/^[|[\]{}_—~"“”'‘’`:;]+|[|[\]{}_—~"“”'‘’`:;]+$/g, '').trim();
    if (text) words.push({ text, conf: w.confidence, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
  }
  if (!rectangle && words.length < 10) throw new Error('No writing found. Take the photo straight on, in good light, with the whole page in view.');
  return words;
}

/** The page's words with their positions (for checking how a photo was read). */
export async function recognizeWords(file: Blob): Promise<Word[]> {
  return readWords(await worker(), await prepare(file), { tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
}

export function wordsToTable(words: Word[], refills: Word[] = []): ScannedRegister {
  const { rows, h } = lines(words);
  // The heading line: the one with the most recognised headings near the top.
  let headerIndex = -1;
  let headerColumns: Column[] = [];
  // Stray pen marks and ruled lines read as "/", "x", "=": not headings.
  const headingWord = (w: Word) => w.conf >= 50 && /[a-z]{2,}/i.test(w.text);
  rows.slice(0, Math.max(8, Math.ceil(rows.length / 3))).forEach((row, i) => {
    if (row.words.filter((w) => headingWord(w) && heading(w.text)).length < 2) return;
    // Headings on a tilted page can sit a little above or below each other.
    const near = rows.filter((r) => Math.abs(r.y - row.y) < h * 1.2).flatMap((r) => r.words).filter(headingWord).sort((a, b) => a.x0 - b.x0);
    const cols = headingColumns(near, h);
    const known = cols.filter((c) => c.field && c.field !== 'other').length;
    if (known >= 3 && known > headerColumns.filter((c) => c.field && c.field !== 'other').length) { headerIndex = i; headerColumns = cols; }
  });
  if (headerIndex < 0) throw new Error('Couldn’t find the column headings (Name, Age, Sex…). Include the heading row in the photo.');
  const headerY = rows[headerIndex].y;

  let groups = splitGroups(headerColumns);
  if (!groups.length) groups = [headerColumns];
  // Pages of one register have the same columns: a heading misread on one page is put back from
  // the best-read page, at the same distance from the headings both pages share.
  const template = [...groups].sort((a, b) => b.filter((c) => c.field).length - a.filter((c) => c.field).length)[0];
  groups = groups.map((g) => {
    if (g === template) return g;
    const shifts = g.flatMap((c) => template.filter((t) => t.field && t.field === c.field).map((t) => c.x0 - t.x0)).sort((a, b) => a - b);
    if (!shifts.length) return g;
    const shift = shifts[Math.floor(shifts.length / 2)];
    const kept = g.filter((c) => c.field); // unread headings are replaced by the template's
    const added = template.filter((t) => t.field && !kept.some((c) => c.field === t.field)).map((t) => ({ ...t, x0: t.x0 + shift, x1: t.x1 + shift }));
    return [...kept, ...added].sort((a, b) => a.x0 - b.x0);
  });

  const FIELD_ORDER: FieldKey[] = ['previousNumber', 'referenceDate', 'fullName', 'firstName', 'lastName', 'age', 'sex', 'dateOfBirth', 'address', 'phone', 'emergencyContactName', 'occupation', 'state'];
  const fields = FIELD_ORDER.filter((f) => groups.some((g) => g.some((c) => c.field === f)));
  const body: string[][] = [];
  const uncertain = new Map<string, Set<number>>();
  const columnIndex = (f: FieldKey) => fields.indexOf(f);
  const strips: Strip[] = [];
  const pageRight = Math.max(...words.map((w) => w.x1));

  groups.forEach((group, gi) => {
    // Column edges halfway across the gap between neighbouring headings; the outer edges halfway to the next page.
    const left = gi === 0 ? -Infinity : (groups[gi - 1][groups[gi - 1].length - 1].x1 + group[0].x0) / 2;
    const right = gi === groups.length - 1 ? Infinity : (group[group.length - 1].x1 + groups[gi + 1][0].x0) / 2;
    const edges = group.map((c, i) => [i === 0 ? left : (group[i - 1].x1 + c.x0) / 2, i === group.length - 1 ? right : (c.x1 + group[i + 1].x0) / 2]);
    type Cells = Map<Column, Word[]>;
    const tableRows: Array<{ cells: Cells; second: Cells }> = [];
    for (const row of rows) {
      if (row.y <= headerY + h * 0.8) continue;
      const cells: Cells = new Map();
      for (const w of row.words) {
        const x = (w.x0 + w.x1) / 2;
        const i = edges.findIndex(([a, b]) => x >= a && x < b);
        if (i >= 0) cells.set(group[i], [...(cells.get(group[i]) ?? []), w]);
      }
      const nameCol = group.find((c) => c.field === 'fullName' || c.field === 'lastName' || c.field === 'firstName');
      if (!nameCol || !(cells.get(nameCol) ?? []).some((w) => /[a-z]{2,}/i.test(w.text))) continue;
      // The second, column-only reading of the same line.
      const second: Cells = new Map();
      for (const w of refills) {
        const x = (w.x0 + w.x1) / 2;
        const i = edges.findIndex(([a, b]) => x >= a && x < b);
        if (i >= 0 && group[i].field === w.field && Math.abs((w.y0 + w.y1) / 2 - row.y) < h * 0.6) second.set(group[i], [...(second.get(group[i]) ?? []), w]);
      }
      tableRows.push({ cells, second });
      // Blank or unsure short cells get a second, closer look (first pass only).
      if (!refills.length) {
        group.forEach((c, i) => {
          if (!c.field || !(c.field in STRIP_CHARS)) return;
          const ws = cells.get(c) ?? [];
          if (ws.length && Math.min(...ws.map((w) => w.conf)) >= 80) return;
          const [a, b] = edges[i];
          const left = Math.max(0, Math.round(Number.isFinite(a) ? a : c.x0 - h));
          const right = Math.round(Number.isFinite(b) ? b : Math.min(pageRight, c.x1 + h));
          const top = Math.max(0, Math.round(row.y - h * 0.8));
          strips.push({ field: c.field as FieldKey, left, top, width: Math.max(1, right - left), height: Math.round(h * 1.6) });
        });
      }
    }

    // Of the two readings of a cell, the one the reader was surer of.
    const cellWords = (r: { cells: Cells; second: Cells }, f: FieldKey | 'serial') => {
      const col = group.find((c) => c.field === f);
      if (!col) return [];
      const one = r.cells.get(col) ?? [];
      const two = r.second.get(col) ?? [];
      const sure = (ws: Word[]) => (ws.length ? Math.min(...ws.map((w) => w.conf)) : -1);
      // A first reading that can't be what the column holds (no digit for an age, no M/F) loses outright.
      const plausible = (ws: Word[]) => {
        const t = ws.map((w) => w.text).join('');
        return f === 'age' ? /\d/.test(digits(t)) : f === 'sex' ? parseSex(t) !== null : true;
      };
      if (two.length && !plausible(one)) return two;
      return sure(two) > sure(one) ? two : one;
    };
    const text = (r: { cells: Cells; second: Cells }, f: FieldKey | 'serial') => cellWords(r, f).map((w) => w.text).join(' ');
    const conf = (r: { cells: Cells; second: Cells }, f: FieldKey) => {
      const ws = cellWords(r, f);
      return ws.length ? Math.min(...ws.map((w) => w.conf)) : 0;
    };

    // Card numbers: a prefix and a running number at the end ("0PooI" is OP + 001).
    const cards = tableRows.map((r) => {
      const raw = text(r, 'previousNumber').replace(/\s+/g, '');
      const m = raw.match(/^(.*?)([\doOQlIi|!zZ#sS$bgq&]+)$/);
      const prefix = (m?.[1] ?? raw).toUpperCase().replace(/0(?=[A-Z])|(?<=[A-Z])0/g, 'O').replace(/[^A-Z/-]/g, '');
      return { prefix, number: digits(m?.[2] ?? '') };
    });
    const prefix = mode(cards.map((c) => c.prefix.replace(/[^A-Z/-]/g, '')).filter(Boolean)) ?? '';
    const width = mode(cards.map((c) => c.number.length).filter((n) => n >= 2)) ?? 3;

    // Where each row sits in the register: from its serial number (or card number) when that agrees
    // with a neighbour, otherwise counted on from the row before. A row the reader skipped
    // doesn't shift the numbers after it.
    const agreed = (values: number[]) => values.map((v, i) => (!Number.isNaN(v) && (values[i - 1] === v - 1 || values[i + 1] === v + 1) ? v : NaN));
    const serialRead = agreed(tableRows.map((r) => Number(digits(text(r, 'serial'))) || NaN));
    const cardRead = agreed(cards.map((c) => (c.number ? Number(c.number) : NaN)));
    const cardOffset = mode(cardRead.map((c, i) => c - serialRead[i]).filter((n) => !Number.isNaN(n)));
    const anchors = cardRead.map((c, i) => (!Number.isNaN(c) ? c : !Number.isNaN(serialRead[i]) && cardOffset !== null ? serialRead[i] + cardOffset : NaN));
    // Between two anchors the numbers run on by one per row. When they don't fit the rows in
    // between (a line was skipped or misread), the guesses are marked for checking.
    const cardNumber = anchors.map((n) => (Number.isNaN(n) ? null : n));
    const cardGuessed = anchors.map((n) => Number.isNaN(n));
    const known = anchors.flatMap((n, i) => (Number.isNaN(n) ? [] : [i]));
    for (let i = 0; i < anchors.length; i += 1) {
      if (!cardGuessed[i]) continue;
      const before = [...known].reverse().find((k) => k < i);
      const after = known.find((k) => k > i);
      if (before !== undefined) cardNumber[i] = anchors[before] + (i - before);
      else if (after !== undefined) cardNumber[i] = anchors[after] - (after - i);
      // Filled in between two anchors that agree with each other: as good as read.
      cardGuessed[i] = !(before !== undefined && after !== undefined && anchors[after] - anchors[before] === after - before);
    }
    // Anchors that don't fit their neighbours are doubtful too.
    for (let k = 1; k < known.length; k += 1) {
      const [a, b] = [known[k - 1], known[k]];
      if (anchors[b] - anchors[a] !== b - a) for (let i = a; i <= b; i += 1) cardGuessed[i] = true;
    }

    let lastDate: string | null = null;
    tableRows.forEach((r, i) => {
      const out = new Array(fields.length).fill('');
      const unsure = new Set<number>();
      const put = (f: FieldKey, value: string, sure: boolean) => {
        const at = columnIndex(f);
        if (at < 0) return;
        out[at] = value;
        if (!sure) unsure.add(at);
      };

      if (group.some((c) => c.field === 'previousNumber')) {
        const n = cardNumber[i];
        put('previousNumber', n !== null ? `${prefix}${String(n).padStart(width, '0')}` : '', n !== null && !cardGuessed[i]);
      }

      const dateRaw = text(r, 'referenceDate');
      let date = dateRaw ? readDate(dateRaw) : null;
      const sureDate = Boolean(date) && conf(r, 'referenceDate') >= 75 && (!lastDate || date! >= lastDate);
      if (!date || (lastDate && date < lastDate)) date = lastDate; // registers run forward in time
      if (date) { lastDate = date; put('referenceDate', date, sureDate); }

      for (const f of ['fullName', 'firstName', 'lastName', 'address', 'emergencyContactName', 'occupation', 'state'] as FieldKey[]) {
        const v = text(r, f).replace(/[^A-Za-zÀ-ÿ'’\- ]+/g, ' ').replace(/\b[a-z]\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (v) put(f, v, conf(r, f) >= 70);
      }

      const age = digits(text(r, 'age'));
      if (age) put('age', String(Number(age)), conf(r, 'age') >= 75 && Number(age) < 120);
      else if (group.some((c) => c.field === 'age')) put('age', '', false);

      const sexRaw = text(r, 'sex').replace(/rn/g, 'm').replace(/[^A-Za-z]/g, '');
      const sex = parseSex(sexRaw) ?? parseSex(sexRaw.slice(0, 1));
      if (group.some((c) => c.field === 'sex')) put('sex', sex === 'male' ? 'M' : sex === 'female' ? 'F' : '', Boolean(sex) && conf(r, 'sex') >= 60);

      const dob = text(r, 'dateOfBirth');
      if (dob) put('dateOfBirth', readDate(dob) ?? '', conf(r, 'dateOfBirth') >= 75);
      const phone = digits(text(r, 'phone'));
      if (phone) put('phone', phone, conf(r, 'phone') >= 80);

      if (unsure.size) uncertain.set(String(body.length), unsure);
      body.push(out);
    });
  });

  const detected: Detected = {
    sheet: 'Scanned register',
    headerRow: -1,
    columns: fields.map((field, index) => ({ index, header: FIELD_LABELS[field], field })),
    body,
    score: 100,
  };
  return { detected, uncertain, tables: groups.length, strips };
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}
