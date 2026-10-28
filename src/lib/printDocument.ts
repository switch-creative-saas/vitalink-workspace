// Prints a simple branded document through a hidden iframe; the browser's print dialog also
// offers "Save as PDF". Used for clinical notes and lab reports.

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export interface PrintSection { heading: string; rows: Array<[label: string, value: string]> }

export function printDocument(options: { title: string; facility: string; subtitle: string; sections: PrintSection[]; footer?: string }) {
  const sections = options.sections
    .map((section) => ({ ...section, rows: section.rows.filter(([, value]) => value.trim()) }))
    .filter((section) => section.rows.length)
    .map((section) => `<h2>${escapeHtml(section.heading)}</h2><table>${section.rows
      .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`)
    .join('');
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title>
<style>@page{size:A4;margin:16mm}body{font-family:system-ui,sans-serif;color:#0f172a;font-size:12px}
header{border-bottom:2px solid #1E4ED8;padding-bottom:8px;margin-bottom:12px}.facility{font-size:11px;color:#64748b}
h1{font-size:18px;margin:4px 0}.sub{color:#334155}h2{font-size:13px;color:#1E4ED8;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}th{width:32%;text-align:left;vertical-align:top;color:#475569;font-weight:600;padding:4px 8px 4px 0}
td{padding:4px 0;vertical-align:top}footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#64748b}</style></head><body>
<header><div class="facility">${escapeHtml(options.facility)} · VitaLink</div><h1>${escapeHtml(options.title)}</h1><div class="sub">${escapeHtml(options.subtitle)}</div></header>
${sections || '<p>Nothing recorded yet.</p>'}
<footer>${escapeHtml(options.footer ?? `Printed ${new Date().toLocaleString()}`)}</footer></body></html>`;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
