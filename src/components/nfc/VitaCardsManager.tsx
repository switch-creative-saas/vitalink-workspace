// The hospital's side of VitaCards: set up a patient's card (their PIN, then write the link to the
// card or print its QR), see every active card, reset PINs, switch off lost cards, and see who
// opened which card. The card page itself (what a phone shows when the card is tapped) is
// pages/CardPage.tsx, served on its own address; both use the same patient records.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CreditCard, ExternalLink, KeyRound, Loader2, Lock, Nfc, Search, ShieldCheck, Smartphone, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CardAccessPanel } from '@/components/identity/CardAccessPanel';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { usePatientPhoto } from '@/lib/supabase/patientPhotos';
import { queryPatients, type PatientQueryInput, type RegistryPatient } from '@/lib/patientRegistry';
import { cardLink, listCardAccess, listWorkspaceCards, type CardAccess, type CardHolder, type WorkspaceCard } from '@/lib/supabase/vitacard';

type Holder = Pick<RegistryPatient, 'id' | 'firstName' | 'lastName' | 'switchId'>;

const ACCESS_LABEL: Record<CardAccess['kind'], string> = {
  emergency: 'Emergency profile viewed', unlock: 'Opened with PIN', records: 'Full record read', wrong_pin: 'Wrong PIN', locked: 'Locked after wrong PINs',
};
const NO_FILTERS: PatientQueryInput['filters'] = {
  gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '', admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '',
};
const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'never');

function Avatar({ photo }: { photo: string | null }) {
  const url = usePatientPhoto(photo ?? '');
  return url ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
    : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 dark:bg-slate-800"><User className="h-4 w-4 text-slate-400" /></span>;
}

export function VitaCardsManager() {
  const { organization, canEdit } = useAuth();
  const { hasModule } = usePlan();
  const allowed = hasModule('nfc-scanning');
  const canManage = canEdit('Patients');
  const [cards, setCards] = useState<WorkspaceCard[] | null>(null);
  const [access, setAccess] = useState<CardAccess[]>([]);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<RegistryPatient[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<Holder | null>(null);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const load = useCallback(() => {
    if (!allowed) return;
    listWorkspaceCards(organization.id).then((list) => { setNow(Date.now()); setCards(list); }).catch(() => setCards([]));
    listCardAccess(organization.id).then(setAccess);
  }, [organization.id, allowed]);
  useEffect(() => { load(); }, [load]);

  // Find a patient to give a card to.
  useEffect(() => {
    const needle = term.trim();
    if (needle.length < 2) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      queryPatients({ tenantId: organization.id, page: 1, pageSize: 8, query: needle, sortBy: 'name', sortOrder: 'asc', filters: NO_FILTERS })
        .then((r) => setFound(r.rows)).catch(() => setFound([])).finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, organization.id]);

  const results = term.trim().length < 2 ? [] : found;
  const withCard = useMemo(() => new Set((cards ?? []).map((c) => c.patient.id)), [cards]);
  const stats = useMemo(() => {
    const list = cards ?? [];
    const monthAgo = now - 30 * 86_400_000;
    return {
      active: list.length,
      used: list.filter((c) => c.lastUsedAt && new Date(c.lastUsedAt).getTime() > monthAgo).length,
      locked: list.filter((c) => c.lockedUntil && new Date(c.lockedUntil).getTime() > now).length,
      wrongPins: access.filter((a) => a.kind === 'wrong_pin' && new Date(a.at).getTime() > now - 86_400_000).length,
    };
  }, [cards, access, now]);

  const openHolder = (p: CardHolder | RegistryPatient) => setOpen({ id: p.id, firstName: p.firstName, lastName: p.lastName, switchId: p.switchId });

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm dark:border-slate-700 dark:bg-slate-900">
        <Lock className="h-6 w-6 text-slate-400" />
        <p className="mt-2 font-semibold text-slate-900 dark:text-slate-50">Patient VitaCards are included from the Starter plan</p>
        <p className="mt-1 text-slate-500">Give each patient a card that shows their emergency profile when tapped, and their full record with their PIN.</p>
        <Button className="mt-4 bg-royal-600 text-white hover:bg-royal-700" onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }))}>See plans</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!online && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          You’re offline. Setting up cards, changing PINs and switching cards off need internet; patients’ cards still work on their phones.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Active cards', value: stats.active, icon: CreditCard },
          { label: 'Opened in the last 30 days', value: stats.used, icon: Smartphone },
          { label: 'Locked now (wrong PINs)', value: stats.locked, icon: Lock },
          { label: 'Wrong PINs today', value: stats.wrongPins, icon: AlertTriangle },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <s.icon className="h-4 w-4 text-royal-600" />
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">{cards ? s.value : '–'}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-50">Set up a card</h2>
            <p className="text-xs text-slate-500">Find the patient, then they choose their PIN and you write the link to their card or print its QR code.</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, VitaLink ID, phone or old card number" className="pl-9" />
            {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
          {results.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {results.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2.5">
                  <Avatar photo={p.profilePhoto ?? null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{p.firstName} {p.lastName}</p>
                    <p className="font-mono text-xs text-slate-500">{p.switchId}{p.previousNumber ? ` · old no. ${p.previousNumber}` : ''}</p>
                  </div>
                  <Button size="sm" variant={withCard.has(p.id) ? 'outline' : 'default'} disabled={!canManage}
                    className={withCard.has(p.id) ? '' : 'gap-1.5 bg-royal-600 text-white hover:bg-royal-700'} onClick={() => openHolder(p)}>
                    {withCard.has(p.id) ? 'Manage card' : <><KeyRound className="h-3.5 w-3.5" />Set up card</>}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <h3 className="pt-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Patients with a card</h3>
          {cards === null ? <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
            : !cards.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/50">No cards set up yet. Search for a patient above to set up the first one.</p>
            : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {cards.map((c) => {
                  const locked = c.lockedUntil && new Date(c.lockedUntil).getTime() > now;
                  return (
                    <button key={c.id} type="button" onClick={() => openHolder(c.patient)} className="flex w-full items-center gap-3 py-2.5 text-left">
                      <Avatar photo={c.patient.profilePhoto} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{c.patient.firstName} {c.patient.lastName}</p>
                        <p className="text-xs text-slate-500"><span className="font-mono">{c.patient.switchId}</span> · set up {ago(c.createdAt)} · last opened {ago(c.lastUsedAt)}</p>
                      </div>
                      {locked ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">PIN locked</span>
                        : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Active</span>}
                    </button>
                  );
                })}
              </div>
            )}
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50"><ShieldCheck className="h-4 w-4 text-royal-600" />How a card works</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-slate-600 dark:text-slate-300">
              <li>Tapping the card (or scanning its QR) opens the card page on any phone. No app or sign-in needed.</li>
              <li>Anyone sees the emergency profile: photo, blood group, genotype, allergies, conditions, medicines and who to call.</li>
              <li>The patient’s PIN opens their full record for 15 minutes, then it locks.</li>
              <li>Five wrong PINs lock the card for 15 minutes. Every view is logged below.</li>
            </ol>
            {cards?.[0] && (
              <a href={cardLink(cards[0].token)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-royal-600 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />See what a phone shows ({cards[0].patient.firstName}’s card)
              </a>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50"><Nfc className="h-4 w-4 text-royal-600" />Recent card activity</h2>
            {!access.length ? <p className="mt-2 text-xs text-slate-500">No activity yet. Admins see every tap and PIN attempt here.</p> : (
              <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto text-xs">
                {access.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span className={a.kind === 'wrong_pin' || a.kind === 'locked' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}>
                      {ACCESS_LABEL[a.kind]}{a.patient ? ` · ${a.patient.firstName} ${a.patient.lastName}` : ''}
                    </span>
                    <span className="shrink-0 text-slate-400">{ago(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Dialog open={Boolean(open)} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{open?.firstName} {open?.lastName}’s VitaCard</DialogTitle>
            <DialogDescription><span className="font-mono">{open?.switchId}</span> · the patient chooses their PIN on this screen; nobody else ever sees it.</DialogDescription>
          </DialogHeader>
          {open && <CardAccessPanel key={open.id} patient={open} onChange={load} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
