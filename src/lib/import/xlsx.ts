// A small Excel (.xlsx / .xlsm) reader for patient imports: unzips the workbook with the browser's
// own DecompressionStream and reads every sheet as rows of text. Dates come out as YYYY-MM-DD.
// No dependency, so nothing extra is downloaded unless someone imports a spreadsheet.

export interface Sheet { name: string; rows: string[][] }

async function unzip(buffer: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // End of central directory record: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file isn’t a valid Excel workbook. Save it again as .xlsx or .csv.');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<string>>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    files.set(name.replace(/^\/+/, ''), async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) throw new Error('This workbook uses compression the importer can’t read. Save it again as .xlsx or .csv.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
  }
  return files;
}

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel day number → YYYY-MM-DD (1900 or 1904 date system). */
export function excelSerialToIso(serial: number, date1904 = false) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial * 86_400_000)).toISOString().slice(0, 10);
}

export async function readXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(buffer);
  const xml = async (path: string) => {
    const read = files.get(path);
    return read ? new DOMParser().parseFromString(await read(), 'application/xml') : null;
  };
  // By local name: some writers prefix every tag (<x:sheet>), most don't.
  const all = (doc: Document | Element | null, tag: string) => (doc ? Array.from(doc.getElementsByTagNameNS('*', tag)) : []);

  const workbook = await xml('xl/workbook.xml');
  if (!workbook) throw new Error('This file isn’t a valid Excel workbook. Save it again as .xlsx or .csv.');
  const date1904 = all(workbook, 'workbookPr')[0]?.getAttribute('date1904') === '1';

  const rels = await xml('xl/_rels/workbook.xml.rels');
  const targets = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));

  const shared = all(await xml('xl/sharedStrings.xml'), 'si').map((si) => all(si, 't').map((t) => t.textContent ?? '').join(''));

  // Which cell styles are dates, so day numbers become dates.
  const styles = await xml('xl/styles.xml');
  const customDate = new Set(all(styles, 'numFmt')
    .filter((f) => /[dy]/i.test((f.getAttribute('formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '')))
    .map((f) => Number(f.getAttribute('numFmtId'))));
  const cellXfs = all(styles, 'cellXfs')[0];
  const dateStyle = all(cellXfs ?? null, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    return BUILT_IN_DATE_FORMATS.has(id) || customDate.has(id);
  });

  const sheets: Sheet[] = [];
  for (const entry of all(workbook, 'sheet')) {
    const relId = entry.getAttribute('r:id') ?? entry.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(relId) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const doc = await xml(path);
    if (!doc) continue;
    const rows: string[][] = [];
    for (const row of all(doc, 'row')) {
      const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
      const cells: string[] = [];
      all(row, 'c').forEach((c, i) => {
        const ref = c.getAttribute('r');
        const col = ref ? colIndex(ref) : i;
        const type = c.getAttribute('t');
        const raw = all(c, 'v')[0]?.textContent ?? '';
        let value = raw;
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent ?? '').join('');
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (raw && !type && dateStyle[Number(c.getAttribute('s') ?? 0)] && !Number.isNaN(Number(raw))) {
          const serial = Number(raw);
          value = serial >= 1 ? excelSerialToIso(serial, date1904) : ''; // time-only cells
        }
        cells[col] = value.trim();
      });
      rows[r] = Array.from(cells, (v) => v ?? '');
    }
    sheets.push({ name: entry.getAttribute('name') ?? `Sheet ${sheets.length + 1}`, rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}
