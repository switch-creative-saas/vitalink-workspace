// Public page a VitaCard opens (/card/<token>), for the card holder or whoever helps them. Built
// from the VitaLink NFC prototype: emergency information first (no sign-in), and the patient's
// full record behind their PIN for 15 minutes. English, Hausa, Yoruba and Igbo; light and dark.
// Data comes from the vitacard edge function; nothing is kept on the device after locking.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, Building2, CalendarDays, FileText, HeartPulse, Loader2, Lock, MapPin,
  Moon, Phone, Pill, ShieldAlert, Sun, User, Users,
} from 'lucide-react';
import {
  cardEmergency, cardLock, cardRecords, cardUnlock, type CardEmergency, type CardRecords,
} from '@/lib/supabase/vitacard';

type Lang = 'en' | 'ha' | 'yo' | 'ig';
type Section = 'home' | 'profile' | 'allergies' | 'contacts' | 'hospitals' | 'appointments' | 'records' | 'prescriptions' | 'vitals';

// Section names come from the prototype's translations; anything not translated there shows in English.
const T: Record<Lang, Record<string, string>> = {
  en: {
    emergency: 'Emergency information', medicalAlert: 'Medical Alert', allergies: 'Allergies', conditions: 'Conditions', medicines: 'Current medicines',
    emergencyContact: 'Emergency Contact', callContact: 'Call', call112: 'Call 112', shareLocation: 'Send my location', hospital: 'Hospital',
    unlock: 'Open my full record', enterPin: 'Enter your card PIN', wrongPin: 'Wrong PIN', attemptsLeft: 'attempts left', locked: 'Too many wrong PINs. Try again after',
    emergencyOnly: 'This hospital’s plan shows the emergency profile only.', profile: 'Profile', contacts: 'Contacts', hospitals: 'My Hospitals',
    appointments: 'My Appointments', records: 'My Records', prescriptions: 'My Prescriptions', vitals: 'Vital signs', lock: 'Lock', back: 'Back',
    lockIn: 'Locks in', minutes: 'min', personalInfo: 'Personal Information', contactInfo: 'Contact Information', none: 'None recorded',
    labResults: 'Lab results', visits: 'Visits', upcoming: 'Upcoming', past: 'Past', insurance: 'Insurance', powered: 'Powered by VitaLink',
    bloodGroup: 'Blood group', genotype: 'Genotype', age: 'Age', years: 'years', inactive: 'This card isn’t active',
    pregnancy: 'Pregnancy', disability: 'Disability', forResponders: 'For first responders: check the patient’s identity against the photo.',
  },
  ha: {
    allergies: 'Alluran', emergencyContact: 'Lambobin Gaggawa', profile: 'Bayanin Kai', contacts: 'Lambobin Sadarwa', hospitals: 'Asibitoci Na',
    appointments: 'Alƙawurana', records: 'Tarihin Lafiya', prescriptions: 'Magunguna Na', medicalAlert: 'Faɗakarwar Lafiya',
    personalInfo: 'Bayanin Kai', contactInfo: 'Bayanin Sadarwa', powered: 'Ƙarfafa ta VitaLink', emergency: 'Yanayin Gaggawa',
  },
  yo: {
    allergies: 'Ìfarapa', emergencyContact: 'Olubasọrọ Pajawiri', profile: 'Profaili', contacts: 'Àwọn Kọ́ńtáàkì', hospitals: 'Ilé-iwòsàn Mi',
    appointments: 'Ipinnu Mi', records: 'Àkọsílẹ Mi', prescriptions: 'Oògùn Mi', medicalAlert: 'Ikilo Ilera',
    personalInfo: 'Bayanin Ara', contactInfo: 'Bayanin Olubasọrọ', powered: 'Pẹlu agbára VitaLink', emergency: 'Ìpẹ̀yà Pajawiri',
  },
  ig: {
    allergies: 'Nchegbu ọgwụ', emergencyContact: 'Kọntaktị Mberede', profile: 'Profaịlụ', contacts: 'Kọntaktị', hospitals: 'Ụlọ Ọgwụ M',
    appointments: 'Nzute M', records: 'Ndekọ M', prescriptions: 'Ogwu M', medicalAlert: 'Mkpu Ahụike',
    contactInfo: 'Bayanin Kọntaktị', powered: 'Site n’aka VitaLink', emergency: 'Ọnọdụ Mberede',
  },
};

const LANGS: Array<[Lang, string]> = [['en', 'English'], ['ha', 'Hausa'], ['yo', 'Yorùbá'], ['ig', 'Igbo']];
// /card/<token> on the app's address, or /<token> on the card's own address.
const token = () => decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');
const fmtDate = (iso: string | null | undefined, withTime = false) => (iso ? new Date(iso).toLocaleString('en-NG', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—');
const telHref = (phone: string | null | undefined) => (phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined);
const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^0(?=\d{10}$)/, '234');
const list = (value: string | null | undefined) => (value ?? '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);

export function CardPage() {
  const [lang, setLang] = useState<Lang>(() => {
    try { const saved = localStorage.getItem('vitacard-lang'); return (['en', 'ha', 'yo', 'ig'] as string[]).includes(saved ?? '') ? saved as Lang : 'en'; } catch { return 'en'; }
  });
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const t = useCallback((key: string) => T[lang][key] ?? T.en[key] ?? key, [lang]);

  const [info, setInfo] = useState<CardEmergency | null | 'missing'>(null);
  const [error, setError] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [session, setSession] = useState<{ id: string; expiresAt: number } | null>(null);
  const [records, setRecords] = useState<CardRecords | null>(null);
  const [section, setSection] = useState<Section>('home');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { try { localStorage.setItem('vitacard-lang', lang); } catch { /* ignore */ } }, [lang]);

  useEffect(() => {
    cardEmergency(token())
      .then(setInfo)
      .catch((err: Error & { status?: number }) => { if (err.status === 404) setInfo('missing'); else setError(err.message); });
  }, []);

  const lockNow = useCallback(() => {
    if (session) void cardLock(session.id);
    setSession(null);
    setRecords(null);
    setSection('home');
  }, [session]);

  // Auto-lock when the 15 minutes are up (and the countdown).
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= session.expiresAt) lockNow();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [session, lockNow]);

  const onUnlocked = async (id: string, expiresAt: string) => {
    setSession({ id, expiresAt: new Date(expiresAt).getTime() });
    setPinOpen(false);
    try { setRecords(await cardRecords(id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load your record'); setSession(null); }
  };

  const shell = (body: React.ReactNode) => (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-md px-4 pb-10">
          <header className="flex items-center justify-between py-4">
            <div className="flex items-center gap-2"><img src="/vitalink-icon.png" alt="" className="h-7 w-7" /><span className="font-semibold tracking-tight">VitaLink</span></div>
            <div className="flex items-center gap-2">
              <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900">
                {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <button type="button" aria-label="Toggle dark mode" onClick={() => setDark((d) => !d)} className="rounded-lg border border-slate-200 p-1.5 dark:border-slate-700">
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </header>
          {body}
          <p className="mt-8 text-center text-xs text-slate-400">{t('powered')}</p>
        </div>
      </div>
    </div>
  );

  if (error && !info) return shell(<Notice icon={<AlertTriangle className="h-8 w-8 text-amber-500" />} title="Something went wrong" body={error} />);
  if (info === null) return shell(<div className="grid place-items-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>);
  if (info === 'missing') return shell(<Notice icon={<ShieldAlert className="h-8 w-8 text-slate-400" />} title={t('inactive')} body="It may have been replaced or reported lost. Ask the patient’s hospital for help." />);

  if (session && records) {
    const minutesLeft = Math.min(15, Math.max(0, Math.ceil((session.expiresAt - now) / 60_000)));
    return shell(
      <FullRecord records={records} section={section} setSection={setSection} t={t} minutesLeft={minutesLeft} onLock={lockNow} emergency={info} />,
    );
  }

  return shell(
    <>
      <EmergencyView info={info} t={t} />
      {info.fullRecordsAvailable ? (
        <button type="button" onClick={() => setPinOpen(true)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1E4ED8] py-3.5 font-semibold text-white shadow-sm hover:bg-[#1A43BD]">
          <Lock className="h-4 w-4" />{t('unlock')}
        </button>
      ) : (
        <p className="mt-5 rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-500 dark:bg-slate-900">{t('emergencyOnly')}</p>
      )}
      {pinOpen && <PinPad t={t} onClose={() => setPinOpen(false)} onUnlocked={onUnlocked} />}
    </>,
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mt-16 rounded-3xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
      <div className="mx-auto mb-3 w-fit">{icon}</div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function EmergencyView({ info, t }: { info: CardEmergency; t: (key: string) => string }) {
  const contact = info.emergencyContact;
  const [sharing, setSharing] = useState(false);
  const shareLocation = () => {
    if (!contact.phone || !navigator.geolocation) return;
    setSharing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSharing(false);
        const text = `Emergency: ${info.firstName} ${info.lastName} needs help. Location: https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
        window.open(`https://wa.me/${waNumber(contact.phone as string)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      },
      () => setSharing(false),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const allergies = list(info.allergies);
  const conditions = list(info.conditions);

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm dark:bg-slate-900">
        <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-sm font-semibold text-white"><HeartPulse className="h-4 w-4" />{t('emergency')}</div>
        <div className="flex items-center gap-4 p-4">
          {info.photo ? <img src={info.photo} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
            : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><User className="h-9 w-9 text-slate-400" /></div>}
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{info.firstName} {info.lastName}</h1>
            <p className="text-sm text-slate-500">{[info.age != null && `${info.age} ${t('years')}`, info.sex].filter(Boolean).join(' · ')}</p>
            <p className="font-mono text-xs text-slate-400">{info.vitalinkId}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <Fact label={t('bloodGroup')} value={info.bloodGroup} strong />
          <Fact label={t('genotype')} value={info.genotype} strong />
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">{t('forResponders')}</p>
      </div>

      <div className="rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400"><AlertTriangle className="h-4 w-4" />{t('medicalAlert')}</h2>
        <Group title={t('allergies')} items={allergies} tone="red" none={t('none')} />
        <Group title={t('conditions')} items={conditions} tone="amber" none={t('none')} />
        <Group title={t('medicines')} items={info.medicines} tone="blue" none={t('none')} />
        {info.pregnancy && <p className="mt-3 text-sm"><span className="font-medium">{t('pregnancy')}:</span> {info.pregnancy}</p>}
        {info.disability && <p className="mt-1 text-sm"><span className="font-medium">{t('disability')}:</span> {info.disability}</p>}
      </div>

      <div className="grid gap-2">
        {contact.phone && (
          <a href={telHref(contact.phone)} className="flex items-center justify-between rounded-2xl bg-emerald-600 px-4 py-3.5 text-white shadow-sm">
            <span><span className="block text-xs text-white/80">{t('emergencyContact')}</span><span className="font-semibold">{contact.name || contact.phone}{contact.relationship ? ` · ${contact.relationship}` : ''}</span></span>
            <span className="flex items-center gap-1.5 font-semibold"><Phone className="h-4 w-4" />{t('callContact')}</span>
          </a>
        )}
        <div className="grid grid-cols-2 gap-2">
          <a href="tel:112" className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 py-3 font-semibold text-white shadow-sm"><Phone className="h-4 w-4" />{t('call112')}</a>
          <button type="button" disabled={!contact.phone || sharing} onClick={shareLocation}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3 font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900">
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}{t('shareLocation')}
          </button>
        </div>
        {info.hospital.name && (
          <a href={telHref(info.hospital.phone)} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-slate-900">
            <Building2 className="h-5 w-5 text-[#1E4ED8]" />
            <span className="min-w-0 flex-1"><span className="block text-xs text-slate-500">{t('hospital')}</span><span className="block truncate font-medium">{info.hospital.name}</span>
              {info.hospital.address && <span className="block truncate text-xs text-slate-500">{info.hospital.address}</span>}</span>
            {info.hospital.phone && <Phone className="h-4 w-4 text-slate-400" />}
          </a>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value, strong = false }: { label: string; value: string | number | null | undefined; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={strong ? 'text-lg font-bold' : 'text-sm font-medium'}>{value || '—'}</p>
    </div>
  );
}

function Group({ title, items, tone, none }: { title: string; items: string[]; tone: 'red' | 'amber' | 'blue'; none: string }) {
  const colour = tone === 'red' ? 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200'
    : tone === 'amber' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200';
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.length ? items.map((item) => <span key={item} className={`rounded-full px-2.5 py-1 text-sm font-medium ${colour}`}>{item}</span>) : <span className="text-sm text-slate-400">{none}</span>}
      </div>
    </div>
  );
}

function PinPad({ t, onClose, onUnlocked }: { t: (key: string) => string; onClose: () => void; onUnlocked: (session: string, expiresAt: string) => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (value: string) => {
    if (value.length < 4) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await cardUnlock(token(), value);
      if (result.ok) { onUnlocked(result.session, result.expiresAt); return; }
      setPin('');
      if (result.reason === 'locked') setMessage(`${t('locked')} ${result.until ? new Date(result.until).toLocaleTimeString() : ''}`);
      else if (result.reason === 'emergency_only') setMessage(t('emergencyOnly'));
      else setMessage(`${t('wrongPin')}${result.attemptsLeft != null ? ` · ${result.attemptsLeft} ${t('attemptsLeft')}` : ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not check the PIN');
    } finally {
      setBusy(false);
    }
  };

  const press = (digit: string) => setPin((current) => (current.length >= 6 ? current : current + digit));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-label={t('enterPin')}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('enterPin')}</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500">{t('back')}</button>
        </div>
        <div className="my-5 flex justify-center gap-3" aria-live="polite">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-[#1E4ED8]' : 'bg-slate-200 dark:bg-slate-700'}`} />)}
        </div>
        {message && <p className="mb-3 text-center text-sm text-red-600">{message}</p>}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" disabled={busy} onClick={() => press(d)} className="rounded-2xl bg-slate-100 py-4 text-xl font-semibold dark:bg-slate-800">{d}</button>
          ))}
          <button type="button" disabled={busy} onClick={() => setPin((p) => p.slice(0, -1))} className="rounded-2xl py-4 text-sm text-slate-500">⌫</button>
          <button type="button" disabled={busy} onClick={() => press('0')} className="rounded-2xl bg-slate-100 py-4 text-xl font-semibold dark:bg-slate-800">0</button>
          <button type="button" disabled={busy || pin.length < 4} onClick={() => void submit(pin)} className="grid place-items-center rounded-2xl bg-[#1E4ED8] py-4 font-semibold text-white disabled:opacity-40">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FullRecord({ records, section, setSection, t, minutesLeft, onLock, emergency }: {
  records: CardRecords; section: Section; setSection: (s: Section) => void; t: (key: string) => string;
  minutesLeft: number; onLock: () => void; emergency: CardEmergency;
}) {
  const p = records.profile;
  const [openedAt] = useState(() => Date.now());
  const upcoming = useMemo(() => records.appointments.filter((a) => new Date(a.at).getTime() >= openedAt).reverse(), [records.appointments, openedAt]);
  const past = useMemo(() => records.appointments.filter((a) => new Date(a.at).getTime() < openedAt), [records.appointments, openedAt]);
  const tiles: Array<{ id: Section; label: string; icon: typeof User; detail: string }> = [
    { id: 'profile', label: t('profile'), icon: User, detail: p.vitalinkId ?? '' },
    { id: 'allergies', label: t('allergies'), icon: AlertTriangle, detail: `${list(p.allergies).length} · ${list(p.conditions).length} ${t('conditions').toLowerCase()}` },
    { id: 'contacts', label: t('contacts'), icon: Users, detail: p.emergencyContact.name ?? '' },
    { id: 'hospitals', label: t('hospitals'), icon: Building2, detail: records.hospital.name },
    { id: 'appointments', label: t('appointments'), icon: CalendarDays, detail: upcoming[0] ? fmtDate(upcoming[0].at, true) : `${past.length} ${t('past').toLowerCase()}` },
    { id: 'records', label: t('records'), icon: FileText, detail: `${records.visits.length} ${t('visits').toLowerCase()} · ${records.labResults.length} labs` },
    { id: 'prescriptions', label: t('prescriptions'), icon: Pill, detail: `${records.prescriptions.filter((r) => r.status === 'active').length} active` },
    { id: 'vitals', label: t('vitals'), icon: Activity, detail: records.vitals[0] ? fmtDate(records.vitals[0].at) : '' },
  ];

  const bar = (
    <div className="mb-4 flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 text-sm shadow-sm dark:bg-slate-900">
      {section === 'home'
        ? <span className="flex items-center gap-2 font-medium">{p.photo ? <img src={p.photo} alt="" className="h-7 w-7 rounded-full object-cover" /> : <User className="h-5 w-5" />}{p.firstName} {p.lastName}</span>
        : <button type="button" onClick={() => setSection('home')} className="flex items-center gap-1 font-medium"><ArrowLeft className="h-4 w-4" />{t('back')}</button>}
      <span className="flex items-center gap-3 text-xs text-slate-500">{t('lockIn')} {minutesLeft} {t('minutes')}
        <button type="button" onClick={onLock} className="flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 font-semibold text-white dark:bg-white dark:text-slate-900"><Lock className="h-3 w-3" />{t('lock')}</button>
      </span>
    </div>
  );

  if (section === 'home') {
    return (
      <>
        {bar}
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => (
            <button key={tile.id} type="button" onClick={() => setSection(tile.id)} className="rounded-2xl bg-white p-4 text-left shadow-sm transition hover:ring-2 hover:ring-[#1E4ED8]/20 dark:bg-slate-900">
              <tile.icon className="h-5 w-5 text-[#1E4ED8]" />
              <p className="mt-2 font-semibold">{tile.label}</p>
              <p className="truncate text-xs text-slate-500">{tile.detail || '—'}</p>
            </button>
          ))}
        </div>
      </>
    );
  }

  const card = (children: React.ReactNode) => <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-900">{children}</div>;
  const row = (label: string, value: string | number | null | undefined) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800"><span className="text-slate-500">{label}</span><span className="text-right font-medium">{value || '—'}</span></div>
  );
  const empty = <p className="text-sm text-slate-400">{t('none')}</p>;

  return (
    <>
      {bar}
      {section === 'profile' && card(<>
        <h2 className="font-semibold">{t('personalInfo')}</h2>
        {row('Name', [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '))}
        {row('VitaLink ID', p.vitalinkId)}{row('Date of birth', fmtDate(p.dateOfBirth))}{row('Sex', p.sex)}
        {row(t('bloodGroup'), p.bloodGroup)}{row(t('genotype'), p.genotype)}{row('Marital status', p.maritalStatus)}{row('Occupation', p.occupation)}
        <h2 className="pt-2 font-semibold">{t('contactInfo')}</h2>
        {row('Phone', p.phone)}{row('Email', p.email)}{row('Address', [p.address, p.state].filter(Boolean).join(', '))}
        <h2 className="pt-2 font-semibold">{t('insurance')}</h2>
        {row('Provider', p.insurance.provider)}{row('Policy', p.insurance.policyNumber)}{row('Expires', fmtDate(p.insurance.expires))}
      </>)}
      {section === 'allergies' && card(<>
        <Group title={t('allergies')} items={list(p.allergies)} tone="red" none={t('none')} />
        <Group title={t('conditions')} items={list(p.conditions)} tone="amber" none={t('none')} />
        <Group title={t('medicines')} items={emergency.medicines} tone="blue" none={t('none')} />
        {row('Family history', p.familyHistory)}{row('Past surgeries', p.surgeries)}
      </>)}
      {section === 'contacts' && card(<>
        <h2 className="font-semibold">{t('emergencyContact')}</h2>
        {row('Name', p.emergencyContact.name)}{row('Relationship', p.emergencyContact.relationship)}{row('Phone', p.emergencyContact.phone)}{row('Address', p.emergencyContact.address)}
        {p.emergencyContact.phone && <a href={telHref(p.emergencyContact.phone)} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 font-semibold text-white"><Phone className="h-4 w-4" />{t('callContact')}</a>}
      </>)}
      {section === 'hospitals' && card(<>
        <h2 className="font-semibold">{records.hospital.name}</h2>
        {row('Phone', records.hospital.phone)}{row('Email', records.hospital.email)}{row('Address', records.hospital.address)}
        <div className="grid grid-cols-2 gap-2">
          {records.hospital.phone && <a href={telHref(records.hospital.phone)} className="flex items-center justify-center gap-2 rounded-2xl bg-[#1E4ED8] py-3 text-sm font-semibold text-white"><Phone className="h-4 w-4" />{t('callContact')}</a>}
          <a href="https://www.google.com/maps/search/hospital+near+me" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3 text-sm font-semibold dark:border-slate-700"><MapPin className="h-4 w-4" />Nearby</a>
        </div>
      </>)}
      {section === 'appointments' && card(<>
        <h2 className="font-semibold">{t('upcoming')}</h2>
        {upcoming.length ? upcoming.map((a) => <Item key={a.at + a.type} title={`${a.type}${a.department ? ` · ${a.department}` : ''}`} sub={`${fmtDate(a.at, true)}${a.clinician ? ` · ${a.clinician}` : ''}`} badge={a.status} />) : empty}
        <h2 className="pt-2 font-semibold">{t('past')}</h2>
        {past.length ? past.slice(0, 15).map((a) => <Item key={a.at + a.type} title={`${a.type}${a.department ? ` · ${a.department}` : ''}`} sub={fmtDate(a.at)} badge={a.status} />) : empty}
      </>)}
      {section === 'records' && card(<>
        <h2 className="font-semibold">{t('visits')}</h2>
        {records.visits.length ? records.visits.map((v) => <Item key={v.date} title={v.diagnosis || v.complaint || 'Visit'} sub={`${fmtDate(v.date)}${v.clinician ? ` · ${v.clinician}` : ''}${v.followUp ? ` · ${v.followUp}` : ''}`} />) : empty}
        <h2 className="pt-2 font-semibold">{t('labResults')}</h2>
        {records.labResults.length ? records.labResults.map((l) => <Item key={l.test + l.date} title={l.test} sub={`${l.value ?? ''} ${l.unit ?? ''}${l.range ? ` (normal ${l.range})` : ''} · ${fmtDate(l.date)}`} badge={l.flag ?? undefined} warn={l.flag !== null && l.flag !== 'Normal'} />) : empty}
      </>)}
      {section === 'prescriptions' && card(<>
        {records.prescriptions.length ? records.prescriptions.map((r) => <Item key={r.drug + r.date} title={`${r.drug}${r.dosage ? ` · ${r.dosage}` : ''}`} sub={`${[r.frequency, r.duration, r.route].filter(Boolean).join(' · ')} · ${fmtDate(r.date)}${r.instructions ? ` · ${r.instructions}` : ''}`} badge={r.status} />) : empty}
      </>)}
      {section === 'vitals' && card(<>
        {records.vitals.length ? records.vitals.map((v) => <Item key={v.at} title={fmtDate(v.at, true)}
          sub={[v.systolic && v.diastolic ? `BP ${v.systolic}/${v.diastolic}` : '', v.pulse ? `Pulse ${v.pulse}` : '', v.temperature ? `${v.temperature}°C` : '', v.spo2 ? `SpO₂ ${v.spo2}%` : '', v.weight ? `${v.weight} kg` : ''].filter(Boolean).join(' · ')} />) : empty}
      </>)}
    </>
  );
}

function Item({ title, sub, badge, warn = false }: { title: string; sub: string; badge?: string; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      <div className="min-w-0"><p className="font-medium">{title}</p><p className="text-xs text-slate-500">{sub}</p></div>
      {badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${warn ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{badge}</span>}
    </div>
  );
}
