// Prints a simple branded document through a hidden iframe; the browser's print dialog also
// offers "Save as PDF". Used for clinical notes, lab reports and payment receipts.

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export interface PrintSection { heading: string; rows: Array<[label: string, value: string]> }

export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export interface ReceiptDocument {
  number: string;
  facilityName: string;
  facilityAddress: string;
  facilityPhone: string;
  facilityEmail: string;
  patientName: string;
  patientSwitchId: string;
  invoiceNumber: string;
  amount: number;
  methodLabel: string;
  reference: string;
  invoiceTotal: number;
  paidToDate: number;
  balance: number;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  receivedBy: string;
  issuedAt: string;
}

/** A payment receipt headed with the hospital's own name and contact details. */
export function printReceipt(receipt: ReceiptDocument) {
  const money = (value: number) => `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const contact = [receipt.facilityAddress, receipt.facilityPhone, receipt.facilityEmail].filter(Boolean).map(escapeHtml).join(' · ');
  const items = receipt.items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td class="n">${item.quantity}</td><td class="n">${money(item.unitPrice)}</td><td class="n">${money(item.total)}</td></tr>`).join('');
  const row = (label: string, value: string, strong = false) => `<tr${strong ? ' class="strong"' : ''}><th>${escapeHtml(label)}</th><td class="n">${escapeHtml(value)}</td></tr>`;
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(receipt.number)}</title>
<style>@page{size:A5;margin:12mm}body{font-family:system-ui,sans-serif;color:#0f172a;font-size:12px;margin:0}
header{text-align:center;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:12px}h1{font-size:18px;margin:0}
.contact{font-size:10.5px;color:#475569;margin-top:3px}.title{margin-top:8px;font-size:12px;font-weight:700;letter-spacing:.14em}
.meta{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.meta div{line-height:1.5}.label{color:#64748b}
table{width:100%;border-collapse:collapse}.items th{text-align:left;font-size:10.5px;color:#64748b;border-bottom:1px solid #cbd5e1;padding:4px 0}
.items td{padding:4px 0;border-bottom:1px solid #f1f5f9}.n{text-align:right;white-space:nowrap}
.totals{margin-top:10px;margin-left:auto;width:60%}.totals th{text-align:left;font-weight:500;color:#475569;padding:3px 0}.totals td{padding:3px 0}
.strong th,.strong td{font-weight:700;color:#0f172a;font-size:13px;border-top:1px solid #0f172a;padding-top:6px}
footer{margin-top:18px;border-top:1px dashed #cbd5e1;padding-top:8px;font-size:10px;color:#64748b;text-align:center}</style></head><body>
<header><h1>${escapeHtml(receipt.facilityName)}</h1>${contact ? `<div class="contact">${contact}</div>` : ''}<div class="title">PAYMENT RECEIPT</div></header>
<div class="meta"><div><span class="label">Receipt</span> <strong>${escapeHtml(receipt.number)}</strong><br><span class="label">Date</span> ${escapeHtml(new Date(receipt.issuedAt).toLocaleString('en-NG'))}<br><span class="label">Invoice</span> ${escapeHtml(receipt.invoiceNumber)}</div>
<div style="text-align:right"><span class="label">Received from</span><br><strong>${escapeHtml(receipt.patientName)}</strong>${receipt.patientSwitchId ? `<br>${escapeHtml(receipt.patientSwitchId)}` : ''}</div></div>
${items ? `<table class="items"><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${items}</tbody></table>` : ''}
<table class="totals">${row('Invoice total', money(receipt.invoiceTotal))}${row('Paid to date', money(receipt.paidToDate))}${row('Balance', money(receipt.balance))}${row('Amount paid', money(receipt.amount), true)}</table>
<p style="margin-top:10px"><span class="label">Payment method</span> ${escapeHtml(receipt.methodLabel)}${receipt.reference ? ` · <span class="label">Ref</span> ${escapeHtml(receipt.reference)}` : ''}${receipt.receivedBy ? `<br><span class="label">Received by</span> ${escapeHtml(receipt.receivedBy)}` : ''}</p>
<footer>Thank you. Please keep this receipt for your records.<br>Issued through VitaLink</footer></body></html>`);
}

export function printDocument(options: { title: string; facility: string; subtitle: string; sections: PrintSection[]; footer?: string }) {
  const sections = options.sections
    .map((section) => ({ ...section, rows: section.rows.filter(([, value]) => value.trim()) }))
    .filter((section) => section.rows.length)
    .map((section) => `<h2>${escapeHtml(section.heading)}</h2><table>${section.rows
      .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`)
    .join('');
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title>
<style>@page{size:A4;margin:16mm}body{font-family:system-ui,sans-serif;color:#0f172a;font-size:12px}
header{border-bottom:2px solid #1E4ED8;padding-bottom:8px;margin-bottom:12px}.facility{font-size:11px;color:#64748b}
h1{font-size:18px;margin:4px 0}.sub{color:#334155}h2{font-size:13px;color:#1E4ED8;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}th{width:32%;text-align:left;vertical-align:top;color:#475569;font-weight:600;padding:4px 8px 4px 0}
td{padding:4px 0;vertical-align:top}footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#64748b}</style></head><body>
<header><div class="facility">${escapeHtml(options.facility)} · VitaLink</div><h1>${escapeHtml(options.title)}</h1><div class="sub">${escapeHtml(options.subtitle)}</div></header>
${sections || '<p>Nothing recorded yet.</p>'}
<footer>${escapeHtml(options.footer ?? `Printed ${new Date().toLocaleString()}`)}</footer></body></html>`);
}
