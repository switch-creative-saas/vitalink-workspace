// One way to hand any list in VitaLink to the user: CSV (opens in Excel and Google Sheets), a real
// Excel workbook, or a print-ready PDF page with the hospital's name. No libraries: the .xlsx is
// written directly (a zip of a few XML files).
import { escapeHtml, printHtml } from '@/lib/printDocument';

export type ExportFormat = 'csv' | 'excel' | 'pdf';
export type Cell = string | number | null | undefined;

export interface TableExport {
  title: string;      // "Patient registry"
  facility: string;   // hospital name, on the PDF
  fileName: string;   // without extension
  columns: string[];
  rows: Cell[][];
  subtitle?: string;
}

const text = (value: Cell) => (value === null || value === undefined ? '' : String(value));

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(columns: string[], rows: Cell[][]) {
  const quote = (value: Cell) => {
    const v = text(value);
    return /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v; // no formula injection
  };
  return [columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
}

// ---------- .xlsx ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with stored (uncompressed) entries: all Excel needs. */
function zip(files: Array<[string, string]>): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xml = (value: string) => value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // eslint-disable-line no-control-regex
const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function toXlsx(sheetName: string, columns: string[], rows: Cell[][]): Blob {
  const cell = (value: Cell, ref: string, header = false) => {
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    const v = text(value);
    return v ? `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>` : '';
  };
  const widths = columns.map((c, i) => Math.min(60, Math.max(c.length, ...rows.slice(0, 200).map((r) => text(r[i]).length)) + 2));
  const sheetRows = [columns, ...rows].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${colName(c)}${r + 1}`, r === 0)).join('')}</row>`).join('');
  const name = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

// ---------- PDF (print) ----------

function printTable(t: TableExport) {
  const wide = t.columns.length > 6;
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t.title)}</title>
<style>@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:12mm}body{font-family:system-ui,sans-serif;color:#0f172a;font-size:${wide ? 9 : 11}px}
header{border-bottom:2px solid #1E4ED8;padding-bottom:6px;margin-bottom:10px}.facility{font-size:10px;color:#64748b}h1{font-size:16px;margin:2px 0}.sub{color:#334155}
table{width:100%;border-collapse:collapse}th{background:#f1f5f9;text-align:left;font-weight:600;color:#334155}th,td{border:1px solid #e2e8f0;padding:3px 5px;vertical-align:top}
tr{page-break-inside:avoid}thead{display:table-header-group}footer{margin-top:12px;font-size:9px;color:#64748b}</style></head><body>
<header><div class="facility">${escapeHtml(t.facility)} · VitaLink</div><h1>${escapeHtml(t.title)}</h1><div class="sub">${escapeHtml(t.subtitle ?? `${t.rows.length} record${t.rows.length === 1 ? '' : 's'}`)}</div></header>
<table><thead><tr>${t.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>
${t.rows.map((r) => `<tr>${t.columns.map((_, i) => `<td>${escapeHtml(text(r[i]))}</td>`).join('')}</tr>`).join('')}
</tbody></table>${t.rows.length ? '' : '<p>Nothing to show.</p>'}
<footer>Printed ${escapeHtml(new Date().toLocaleString())}. Choose “Save as PDF” in the print window to keep a copy.</footer></body></html>`);
}

export function exportTable(t: TableExport, format: ExportFormat) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'pdf') return printTable(t);
  if (format === 'excel') return download(toXlsx(t.title, t.columns, t.rows), `${t.fileName}-${stamp}.xlsx`);
  return download(new Blob(['\uFEFF', toCsv(t.columns, t.rows)], { type: 'text/csv;charset=utf-8;' }), `${t.fileName}-${stamp}.csv`);
}
