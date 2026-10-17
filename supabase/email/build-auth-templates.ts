// Builds the Supabase Auth email templates (and previews of the Edge Function
// emails) from the shared VitaLink layout, so every email looks the same.
//
//   node supabase/email/build-auth-templates.ts
//
// Then paste each file in supabase/email/auth-templates/ into Supabase →
// Authentication → Emails → Templates, with the subject from SUBJECTS.md.
// The {{ .Token }} / {{ .ConfirmationURL }} tags are filled in by Supabase.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEmail, type EmailContent } from '../functions/_shared/email.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SECURITY = 'VitaLink will never ask for this code or your password by phone, WhatsApp or email. If you did not request this, you can ignore this email; your account is safe.';

const auth: Array<{ file: string; template: string; subject: string; content: EmailContent }> = [
  {
    file: 'confirm-signup.html',
    template: 'Confirm signup',
    subject: 'Your VitaLink verification code: {{ .Token }}',
    content: {
      preheader: 'Your verification code is {{ .Token }}. It expires in 1 hour.',
      eyebrow: 'Verify your email',
      title: 'Welcome to VitaLink',
      paragraphs: ['Enter this code in VitaLink to confirm {{ .Email }} and finish creating your account.'],
      code: { value: '{{ .Token }}', caption: 'Expires in 1 hour' },
      note: SECURITY,
      reason: 'You received this because someone signed up for VitaLink with this email address.',
    },
  },
  {
    file: 'reset-password.html',
    template: 'Reset password',
    subject: 'Reset your VitaLink password',
    content: {
      preheader: 'Use this link to choose a new password. It expires in 1 hour.',
      eyebrow: 'Password reset',
      title: 'Reset your password',
      paragraphs: ['We received a request to reset the password for {{ .Email }}. Choose a new one with the button below.'],
      button: { label: 'Choose a new password', url: '{{ .ConfirmationURL }}' },
      note: 'This link expires in 1 hour and can only be used once. If you did not ask to reset your password, ignore this email; your password will not change.',
      reason: 'You received this because a password reset was requested for your VitaLink account.',
    },
  },
  {
    file: 'magic-link.html',
    template: 'Magic link',
    subject: 'Your VitaLink sign-in code: {{ .Token }}',
    content: {
      preheader: 'Your sign-in code is {{ .Token }}.',
      eyebrow: 'Sign in',
      title: 'Your sign-in code',
      paragraphs: ['Use this code to sign in to VitaLink as {{ .Email }}.'],
      code: { value: '{{ .Token }}', caption: 'Expires in 1 hour' },
      note: SECURITY,
      reason: 'You received this because a sign-in was requested for your VitaLink account.',
    },
  },
  {
    file: 'change-email.html',
    template: 'Change email address',
    subject: 'Confirm your new VitaLink email address',
    content: {
      preheader: 'Confirm the change to {{ .NewEmail }}.',
      eyebrow: 'Email change',
      title: 'Confirm your new email',
      paragraphs: ['You asked to change your VitaLink sign-in email from {{ .Email }} to {{ .NewEmail }}. Confirm the change below.'],
      button: { label: 'Confirm new email', url: '{{ .ConfirmationURL }}' },
      note: 'If you did not ask for this, ignore this email and your sign-in email stays the same.',
      reason: 'You received this because an email change was requested for a VitaLink account.',
    },
  },
  {
    file: 'reauthentication.html',
    template: 'Reauthentication',
    subject: 'Your VitaLink confirmation code: {{ .Token }}',
    content: {
      preheader: 'Your confirmation code is {{ .Token }}.',
      eyebrow: 'Confirm it\'s you',
      title: 'Your confirmation code',
      paragraphs: ['Enter this code to confirm a sensitive change to your VitaLink account.'],
      code: { value: '{{ .Token }}', caption: 'Expires in 1 hour' },
      note: SECURITY,
      reason: 'You received this because a protected action was started on your VitaLink account.',
    },
  },
  {
    file: 'invite-user.html',
    template: 'Invite user',
    subject: "You've been invited to VitaLink",
    content: {
      preheader: 'Accept your invitation to VitaLink.',
      eyebrow: 'Invitation',
      title: "You've been invited to VitaLink",
      paragraphs: ['You have been invited to create a VitaLink account with {{ .Email }}.'],
      button: { label: 'Accept invitation', url: '{{ .ConfirmationURL }}' },
      reason: 'You received this because someone invited this email address to VitaLink.',
    },
  },
];

const outDir = join(here, 'auth-templates');
mkdirSync(outDir, { recursive: true });
for (const item of auth) writeFileSync(join(outDir, item.file), renderEmail(item.content));
writeFileSync(join(outDir, 'SUBJECTS.md'), [
  '# Supabase Auth email templates',
  '',
  'Supabase → Authentication → Emails → Templates. For each template, set the subject and paste the HTML file as the body.',
  'Regenerate with `node supabase/email/build-auth-templates.ts` after changing the layout.',
  '',
  '| Template | Subject | Body file |',
  '|---|---|---|',
  ...auth.map((item) => `| ${item.template} | \`${item.subject}\` | ${item.file} |`),
  '',
].join('\n'));

// Previews of the Edge Function emails with sample data (open in a browser).
const previews: Record<string, EmailContent> = {
  'staff-invite': {
    preheader: 'Join Switch Health as Doctor. The invitation expires on 24 October 2026.',
    eyebrow: 'Staff invitation', title: 'Join Switch Health on VitaLink',
    paragraphs: ["Fredrick Akojuru has invited you to work in Switch Health's VitaLink workspace, where the team manages patients, appointments, labs, pharmacy and billing in one place."],
    details: [['Workspace', 'Switch Health'], ['Your role', 'Doctor · Outpatients'], ['Sign in with', 'ada@example.com'], ['Expires', '24 October 2026']],
    button: { label: 'Accept invitation', url: 'https://vitalink.africa/invite?token=sample' },
    note: "Sign in or create your account with ada@example.com so the invitation matches. If you weren't expecting this, you can ignore this email.",
    reason: 'You received this because Fredrick Akojuru invited ada@example.com to a VitaLink workspace.',
  },
  'appointment-reminder': {
    preheader: 'Monday, 19 October 2026 at 10:30 with Dr. Ada Obi',
    eyebrow: 'Appointment reminder', title: 'See you on Monday, 19 October 2026', greeting: 'Hello Chinedu,',
    paragraphs: ['This is a reminder of your upcoming appointment at Switch Health. Please arrive 10 minutes early.'],
    details: [['Date', 'Monday, 19 October 2026'], ['Time', '10:30 (WAT)'], ['Visit', 'Consultation · Outpatients'], ['With', 'Dr. Ada Obi'], ['Clinic', 'Switch Health'], ['To reschedule', 'Call 0814 826 2447']],
    note: 'If you can no longer make it, please let the clinic know so someone else can have the slot.',
    reason: 'You received this because Switch Health booked an appointment for you on VitaLink.',
  },
  'console-payment-alert': {
    preheader: 'Growth Corridor (monthly) · ref VL-PAY-8812', eyebrow: 'Payment',
    title: 'Payment received: ₦25,000.00 from Switch Health', amount: { value: '₦25,000.00', caption: 'Switch Health' },
    paragraphs: ['Growth Corridor (monthly) incl. setup fee ₦5,000.00 · ref VL-PAY-8812'],
    details: [['Workspace', 'Switch Health'], ['When', '17 Oct 2026, 14:20 WAT']],
    button: { label: 'Open in VitaLink Console', url: 'https://vitalink.africa/console/workspaces/sample' },
    reason: 'You get this because you are a VitaLink platform admin. Choose which alerts you get in VitaLink Console → Settings.',
  },
  'support-reply': {
    preheader: 'Thanks for the report! We can reproduce it and a fix is on the way.', eyebrow: 'Support · SUP-2026-0001',
    title: 'Re: Lab result print shows blank page', greeting: 'Hello Fredrick,',
    paragraphs: ['The VitaLink support team replied to your request:'],
    quote: { author: 'VitaLink Support', text: 'Thanks for the report! We can reproduce it and a fix is on the way. We will update you here.' },
    button: { label: 'View conversation', url: 'https://vitalink.africa/help' },
    note: 'Reply from Help & Support in your VitaLink workspace so your whole conversation stays in one place.',
    reason: 'You received this because you contacted VitaLink Support (SUP-2026-0001).',
  },
};
const previewDir = join(here, 'previews');
mkdirSync(previewDir, { recursive: true });
for (const [name, content] of Object.entries(previews)) writeFileSync(join(previewDir, `${name}.html`), renderEmail(content));
const sample = (html: string) => html.replaceAll('{{ .Token }}', '482915').replaceAll('{{ .ConfirmationURL }}', 'https://vitalink.africa/reset-password').replaceAll('{{ .Email }}', 'ada@example.com').replaceAll('{{ .NewEmail }}', 'ada.obi@example.com');
for (const item of auth) writeFileSync(join(previewDir, `auth-${item.file}`), sample(renderEmail(item.content)));

console.log(`Wrote ${auth.length} auth templates to ${outDir} and ${Object.keys(previews).length + auth.length} previews to ${previewDir}`);
