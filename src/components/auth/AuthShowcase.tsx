// Left panel of the sign-in / sign-up pages: the VitaLink artwork with a rotating preview of the
// product (drawn in HTML, not screenshots, so it stays sharp and on-brand) and a short message.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, CloudOff, CreditCard, FlaskConical, HeartPulse, RefreshCw, Users } from 'lucide-react';
import { BRAND } from '@/config/brand';

const websiteUrl = BRAND.website;

function Window({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/60 bg-white text-slate-900 shadow-[0_30px_80px_-20px_rgba(2,6,23,0.65)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2"><img src="/vitalink-icon.png" alt="" className="h-4 w-4" /><span className="text-[11px] font-semibold">{title}</span></div>
        <div className="flex gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-200" /><span className="h-1.5 w-1.5 rounded-full bg-slate-200" /><span className="h-1.5 w-1.5 rounded-full bg-slate-200" /></div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DashboardPreview() {
  const bars = [38, 52, 44, 70, 58, 82, 64];
  return (
    <Window title="Dashboard">
      <div className="grid grid-cols-3 gap-2">
        {[{ icon: Users, label: "Today's patients", value: '48', delta: '+12%' }, { icon: CalendarDays, label: 'Appointments', value: '31', delta: '6 left' }, { icon: CreditCard, label: 'Collected', value: '₦1.2m', delta: '+8%' }].map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-50 p-2.5">
            <s.icon className="h-3.5 w-3.5 text-[#1E4ED8]" />
            <p className="mt-1.5 text-[15px] font-bold leading-none">{s.value}</p>
            <p className="mt-1 text-[9px] text-slate-500">{s.label}</p>
            <p className="text-[9px] font-semibold text-emerald-600">{s.delta}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[1.2fr_1fr] gap-3">
        <div className="rounded-xl border border-slate-100 p-2.5">
          <p className="text-[10px] font-semibold">Patients this week</p>
          <div className="mt-2 flex h-16 items-end gap-1.5">{bars.map((h, i) => <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-[#1E4ED8] to-[#6D8BFF]" style={{ height: `${h}%`, opacity: i === bars.length - 2 ? 1 : 0.55 }} />)}</div>
        </div>
        <div className="space-y-1.5 rounded-xl border border-slate-100 p-2.5">
          <p className="text-[10px] font-semibold">Up next</p>
          {[['09:30', 'Adaeze Okafor', 'Dr. Bello'], ['10:00', 'Musa Ibrahim', 'Dr. Ade'], ['10:15', 'Funke Ajayi', 'Dr. Bello']].map(([t, p, d]) => (
            <div key={p} className="flex items-center gap-1.5 text-[9px]"><span className="rounded bg-[#1E4ED8]/10 px-1 font-semibold text-[#1E4ED8]">{t}</span><span className="truncate font-medium">{p}</span><span className="ml-auto truncate text-slate-400">{d}</span></div>
          ))}
        </div>
      </div>
    </Window>
  );
}

function RecordPreview() {
  return (
    <Window title="Patient record">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#1E4ED8] to-[#7B4DFF] text-xs font-bold text-white">AO</div>
        <div className="min-w-0"><p className="text-[13px] font-bold">Adaeze Okafor</p><p className="text-[9px] text-slate-500">VL-2026-004812 · 34 · Female · O+</p></div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-700"><CloudOff className="h-3 w-3" />Offline · 3 to sync</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[['BP', '118/76'], ['Pulse', '72'], ['Temp', '36.8°'], ['SpO₂', '98%']].map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] text-slate-500">{k}</p><p className="text-[12px] font-bold">{v}</p></div>)}
      </div>
      <div className="mt-3 space-y-1.5">
        {[{ icon: HeartPulse, t: 'Consultation note', d: 'Dr. Bello · today 09:42', c: 'text-rose-500' }, { icon: FlaskConical, t: 'Full blood count: normal', d: 'Lab · yesterday', c: 'text-violet-500' }, { icon: RefreshCw, t: 'Records from Lagos General', d: 'Shared with consent', c: 'text-[#1E4ED8]' }].map((row) => (
          <div key={row.t} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2"><row.icon className={`h-3.5 w-3.5 ${row.c}`} /><span className="text-[10px] font-medium">{row.t}</span><span className="ml-auto text-[9px] text-slate-400">{row.d}</span></div>
        ))}
      </div>
    </Window>
  );
}

function BillingPreview() {
  const rows: Array<[string, string, string, string]> = [['INV-1042', 'Musa Ibrahim', '₦45,000', 'Paid'], ['INV-1041', 'Funke Ajayi', '₦12,500', 'HMO claim'], ['INV-1040', 'Chidi Eze', '₦80,000', 'Part paid'], ['INV-1039', 'Grace Udoh', '₦9,800', 'Paid']];
  const tone: Record<string, string> = { Paid: 'border-emerald-500 text-emerald-700', 'HMO claim': 'border-[#1E4ED8] text-[#1E4ED8]', 'Part paid': 'border-amber-500 text-amber-700' };
  return (
    <Window title="Billing & insurance">
      <div className="mb-3 flex items-end justify-between">
        <div><p className="text-[9px] text-slate-500">Collected this month</p><p className="text-[18px] font-bold">₦4,860,000</p></div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" />12 claims approved</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-100">
        {rows.map(([id, name, amount, status], i) => (
          <div key={id} className={`grid grid-cols-[64px_1fr_64px_68px] items-center gap-2 px-2.5 py-2 text-[10px] ${i % 2 ? '' : 'bg-slate-50'}`}>
            <span className="font-mono text-[9px] text-slate-500">{id}</span><span className="truncate font-medium">{name}</span><span className="text-right font-semibold">{amount}</span>
            <span className={`justify-self-end rounded-full border px-1.5 py-0.5 text-[8.5px] font-semibold ${tone[status]}`}>{status}</span>
          </div>
        ))}
      </div>
    </Window>
  );
}

const SLIDES = [
  { title: 'Every patient, one record.', body: 'Registration, consultations, lab results, prescriptions and billing, connected in a single workspace for your whole team.', Preview: DashboardPreview },
  { title: "Keeps working when the internet doesn't.", body: 'Record vitals and notes offline. VitaLink syncs everything the moment you are back online, and shares records between hospitals with consent.', Preview: RecordPreview },
  { title: 'Bill accurately, get paid faster.', body: 'Invoices, payments and HMO claims in one place, so nothing falls through the cracks.', Preview: BillingPreview },
];

export function AuthShowcase() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % SLIDES.length), 7000);
    return () => window.clearInterval(timer);
  }, [index]);
  const slide = SLIDES[index];
  const go = (step: number) => setIndex((current) => (current + step + SLIDES.length) % SLIDES.length);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-[#05060f]">
      <img src="/auth-poster.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#05060f]/10 via-[#05060f]/25 to-[#05060f]/85" />

      <a href={websiteUrl} className="absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/25">
        <ArrowLeft className="h-4 w-4" />Back to website
      </a>

      <div className="absolute inset-x-0 top-[17%] z-10 flex justify-center px-8">
        <div key={index} className="w-full max-w-[460px] animate-[auth-form-slide-up_0.6s_ease-out_both]">
          <slide.Preview />
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 z-10 rounded-[22px] border border-white/15 bg-white/10 p-6 text-white backdrop-blur-xl">
        <h2 key={`t-${index}`} className="text-[26px] font-semibold leading-tight tracking-tight animate-[auth-form-slide-up_0.5s_ease-out_both] xl:text-[30px]">{slide.title}</h2>
        <p key={`b-${index}`} className="mt-2 max-w-[460px] text-sm leading-relaxed text-white/75 animate-[auth-form-slide-up_0.6s_ease-out_both]">{slide.body}</p>
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {SLIDES.map((item, i) => <button key={item.title} type="button" aria-label={`Show slide ${i + 1}`} onClick={() => setIndex(i)} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-white' : 'w-3 bg-white/35 hover:bg-white/60'}`} />)}
          </div>
          <div className="flex gap-2">
            <button type="button" aria-label="Previous" onClick={() => go(-1)} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"><ArrowLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next" onClick={() => go(1)} className="grid h-10 w-10 place-items-center rounded-full bg-white text-slate-900 transition hover:bg-white/90"><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
