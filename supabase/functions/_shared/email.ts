// VitaLink branded email layout, shared by every email the app sends (Edge
// Functions directly; Supabase Auth templates are generated from it by
// supabase/email/build-auth-templates.ts).
//
// Table-based with inline styles so it renders the same in Gmail, Outlook,
// Apple Mail and phones. The animated heartbeat strip is a GIF (the only
// animation email clients play); Outlook shows its first frame, a still line.

const ASSET_BASE = 'https://ynbdsrazaplzsrllfgym.supabase.co/storage/v1/object/public/brand/email';
export const EMAIL_ASSETS = {
  icon: `${ASSET_BASE}/vitalink-icon-96.png`,
  pulse: `${ASSET_BASE}/vitalink-pulse.gif`,
};

const C = {
  page: '#F3F1F9',
  band: '#140B34',
  tagline: '#B9A8F5',
  card: '#FFFFFF',
  ink: '#0F172A',
  body: '#475569',
  muted: '#94A3B8',
  line: '#ECE9F5',
  accent: '#6D28D9',
  accentSoft: '#F5F3FF',
  accentBorder: '#DDD6FE',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailContent {
  /** Hidden inbox preview text. */
  preheader: string;
  /** Small label above the title, e.g. "Staff invitation". */
  eyebrow?: string;
  title: string;
  greeting?: string;
  /** Plain-text paragraphs (escaped; newlines become line breaks). */
  paragraphs?: string[];
  /** Big amount display for payments, e.g. "₦25,000.00". */
  amount?: { value: string; caption?: string };
  /** One-time code shown in a large box. */
  code?: { value: string; caption?: string };
  button?: { label: string; url: string };
  /** Key/value rows in a light table. */
  details?: Array<[string, string]>;
  /** A quoted message (e.g. a support reply). */
  quote?: { author: string; text: string };
  /** Small grey note under a divider (security advice etc.). */
  note?: string;
  /** Footer line: why the person received this email. */
  reason: string;
  supportEmail?: string;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const text = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');

function button(label: string, url: string) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
  <tr><td bgcolor="${C.accent}" style="border-radius:10px;background:${C.accent};background-image:linear-gradient(135deg,#9333EA,#5B21B6)">
    <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px">${escapeHtml(label)}&nbsp;&rarr;</a>
  </td></tr>
</table>
<p style="margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:${C.accent};word-break:break-all">${escapeHtml(url)}</a></p>`;
}

function codeBlock(value: string, caption?: string) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px">
  <tr><td align="center" bgcolor="${C.accentSoft}" style="background:${C.accentSoft};border:1px solid ${C.accentBorder};border-radius:12px;padding:22px 12px">
    <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;color:${C.ink}">${escapeHtml(value)}</div>
    ${caption ? `<div style="margin-top:8px;font-family:${FONT};font-size:13px;color:${C.body}">${escapeHtml(caption)}</div>` : ''}
  </td></tr>
</table>`;
}

function amountBlock(value: string, caption?: string) {
  return `
<div style="margin:0 0 4px;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;color:${C.ink};letter-spacing:-0.5px">${escapeHtml(value)}</div>
${caption ? `<div style="margin:0 0 18px;font-family:${FONT};font-size:13px;color:${C.body}">${escapeHtml(caption)}</div>` : ''}`;
}

function detailsTable(rows: Array<[string, string]>) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;border:1px solid ${C.line};border-radius:12px;border-collapse:separate">
  ${rows.map(([label, value], index) => `
  <tr>
    <td style="padding:11px 16px;${index ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:13px;color:${C.muted};width:38%;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:11px 16px;${index ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;color:${C.ink};font-weight:500">${text(value)}</td>
  </tr>`).join('')}
</table>`;
}

function quoteBlock(author: string, body: string) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px">
  <tr><td style="border-left:3px solid ${C.accent};background:#FAF9FD;border-radius:0 10px 10px 0;padding:14px 18px">
    <div style="font-family:${FONT};font-size:12px;font-weight:600;color:${C.accent};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">${escapeHtml(author)}</div>
    <div style="font-family:${FONT};font-size:15px;line-height:24px;color:${C.ink}">${text(body)}</div>
  </td></tr>
</table>`;
}

export function renderEmail(content: EmailContent): string {
  const paragraph = (value: string) =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}">${text(value)}</p>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.title)}</title>
<style>
  @media (max-width:620px){ .vl-pad{padding-left:22px!important;padding-right:22px!important} .vl-title{font-size:22px!important;line-height:30px!important} .vl-tag{display:none!important} }
  a{color:${C.accent}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">

    <!-- Header band -->
    <tr><td bgcolor="${C.band}" style="background:${C.band};border-radius:16px 16px 0 0;padding:22px 32px 6px" class="vl-pad">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="vertical-align:middle;padding-right:10px"><img src="${EMAIL_ASSETS.icon}" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px"></td>
            <td style="vertical-align:middle;font-family:${FONT};font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px">VitaLink</td>
          </tr></table>
        </td>
        <td align="right" class="vl-tag" style="vertical-align:middle;font-family:${FONT};font-size:12px;line-height:17px;color:${C.tagline};border-left:1px solid #3B2D72;padding-left:14px;width:150px">Connected care.<br>Anywhere in Africa.</td>
      </tr></table>
    </td></tr>
    <!-- Heartbeat strip (animated GIF) -->
    <tr><td bgcolor="${C.band}" style="background:${C.band};line-height:0;font-size:0">
      <img src="${EMAIL_ASSETS.pulse}" width="600" height="44" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0">
    </td></tr>

    <!-- Body card -->
    <tr><td bgcolor="${C.card}" style="background:${C.card};padding:36px 40px 32px" class="vl-pad">
      ${content.eyebrow ? `<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.accent};margin-bottom:10px">${escapeHtml(content.eyebrow)}</div>` : ''}
      <h1 class="vl-title" style="margin:0 0 18px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${C.ink};letter-spacing:-0.3px">${escapeHtml(content.title)}</h1>
      ${content.amount ? amountBlock(content.amount.value, content.amount.caption) : ''}
      ${content.greeting ? paragraph(content.greeting) : ''}
      ${(content.paragraphs ?? []).map(paragraph).join('')}
      ${content.code ? codeBlock(content.code.value, content.code.caption) : ''}
      ${content.quote ? quoteBlock(content.quote.author, content.quote.text) : ''}
      ${content.details?.length ? detailsTable(content.details) : ''}
      ${content.button ? button(content.button.label, content.button.url) : ''}
      ${content.note ? `
      <div style="height:1px;background:${C.line};margin:28px 0 18px;line-height:1px;font-size:0">&nbsp;</div>
      <p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${text(content.note)}</p>` : ''}
    </td></tr>

    <!-- Footer band -->
    <tr><td bgcolor="${C.band}" style="background:${C.band};border-radius:0 0 16px 16px;padding:26px 32px" class="vl-pad">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:top;padding-right:12px;width:30px"><img src="${EMAIL_ASSETS.icon}" width="28" height="28" alt="" style="display:block;border:0;width:28px;height:28px"></td>
        <td style="vertical-align:top;font-family:${FONT}">
          <div style="font-size:14px;font-weight:600;color:#FFFFFF">VitaLink Africa</div>
          <div style="font-size:12px;line-height:18px;color:${C.tagline}">Connected healthcare records, care and payments for African clinics.</div>
          <div style="margin-top:10px;font-size:12px;line-height:18px">
            <a href="https://vitalink.africa" style="color:#FFFFFF;text-decoration:none">vitalink.africa</a>${content.supportEmail ? `<span style="color:#5B4B95">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="mailto:${escapeHtml(content.supportEmail)}" style="color:#FFFFFF;text-decoration:none">${escapeHtml(content.supportEmail)}</a>` : ''}
          </div>
        </td>
      </tr></table>
      <div style="height:1px;background:#2A1F5C;margin:20px 0 14px;line-height:1px;font-size:0">&nbsp;</div>
      <p style="margin:0;font-family:${FONT};font-size:11px;line-height:17px;color:#8E80C4">${text(content.reason)}</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text version (shown by clients that don't render HTML, and helps spam scoring). */
export function renderText(content: EmailContent): string {
  const parts = [
    content.eyebrow ? content.eyebrow.toUpperCase() : '',
    content.title,
    '',
    content.greeting ?? '',
    ...(content.paragraphs ?? []),
    content.amount ? `${content.amount.value}${content.amount.caption ? ` (${content.amount.caption})` : ''}` : '',
    content.code ? `Code: ${content.code.value}${content.code.caption ? `\n${content.code.caption}` : ''}` : '',
    content.quote ? `${content.quote.author}:\n${content.quote.text}` : '',
    ...(content.details ?? []).map(([label, value]) => `${label}: ${value}`),
    content.button ? `${content.button.label}: ${content.button.url}` : '',
    content.note ? `\n${content.note}` : '',
    '\n--\nVitaLink Africa · https://vitalink.africa' + (content.supportEmail ? ` · ${content.supportEmail}` : ''),
    content.reason,
  ];
  return parts.filter((part, index) => part !== '' || index === 2).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
