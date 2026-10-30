// Reads any list a hospital uploads (Excel, CSV, JSON…) into records keyed by our own field names,
// using a vocabulary of headings for that kind of list. Title rows above the headings are skipped
// and the best-matching sheet is used. Patients have their own, richer engine (patientImport.ts).
import { readImportFile } from './patientImport';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function fieldFor<F extends string>(header: string, vocab: Record<F, string[]>): { field: F; score: number } | null {
  const h = norm(header);
  if (!h) return null;
  let best: { field: F; score: number } | null = null;
  for (const [field, words] of Object.entries(vocab) as Array<[F, string[]]>) {
    for (const word of words) {
      const score = h === word ? 100 + word.length : ` ${h} `.includes(` ${word} `) ? word.length : 0;
      if (score > (best?.score ?? 0)) best = { field, score };
    }
  }
  return best;
}

type Row<F extends string> = { [K in F]?: string } & { line: number };
export interface ReadTable<F extends string> { records: Array<Row<F>>; matched: F[]; ignored: string[]; sheet: string }

export async function readTable<V extends Record<string, string[]>, F extends Extract<keyof V, string> = Extract<keyof V, string>>(file: File, vocab: V, required: NoInfer<F>[]): Promise<ReadTable<F>> {
  const sheets = await readImportFile(file);
  let best: { sheet: string; row: number; map: Array<F | null>; headers: string[]; rows: string[][]; score: number } | null = null;
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(40, sheet.rows.length); r += 1) {
      const headers = (sheet.rows[r] ?? []).map((c) => c ?? '');
      const found = headers.map((h) => fieldFor(h, vocab as unknown as Record<F, string[]>));
      // One column per field: the best-matching heading keeps it.
      const map = found.map((m, i) => (m && !found.some((o, j) => j !== i && o?.field === m.field && (o.score > m.score || (o.score === m.score && j < i))) ? m.field : null));
      const score = map.filter(Boolean).length + (required.every((f) => map.includes(f)) ? 10 : 0);
      if (map.filter(Boolean).length >= 1 && score > (best?.score ?? 0)) best = { sheet: sheet.name, row: r, map, headers, rows: sheet.rows, score };
    }
  }
  if (!best || !required.every((f) => best!.map.includes(f))) {
    const names = required.map((f) => vocab[f][0]).join(' and ');
    throw new Error(`Couldn’t find a ${names} column. Check the file has a heading row.`);
  }
  const { map, headers, rows, row } = best;
  const records = rows.slice(row + 1).flatMap((cells, i) => {
    if (!cells?.some((c) => c?.trim())) return [];
    const rec = { line: row + 2 + i } as Row<F>;
    map.forEach((f, c) => { if (f && cells[c]?.trim()) (rec as Record<string, unknown>)[f] = cells[c].trim(); });
    return [rec];
  });
  return { records, matched: map.filter((f): f is F => Boolean(f)), ignored: headers.filter((h, i) => h.trim() && !map[i]), sheet: best.sheet };
}

/** "₦12,500.00", "NGN 12500", "12.5k" → 12500. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.toLowerCase().replace(/ngn|naira|n(?=\s*\d)|₦|,|\s/g, '');
  const m = v.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
}
