// VitaLink Network for live workspaces: the directory of hospitals on the
// network, referrals and transfers between them, consented record sharing and
// arrival registration. Each workspace only acts for itself; the database
// functions enforce who may do what.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Building2, CheckCircle2, Hospital, MapPin, Phone, RefreshCw,
  Search, Send, Settings2, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { PatientSearch } from '@/components/dashboard/LiveQuickActions';
import type { RegistryPatient } from '@/lib/patientRegistry';
import { RecordContent } from './NetworkRecordView';
import { timeAgo } from '@/lib/timeAgo';
import {
  CAPACITY_LABEL, COVERAGE_LABEL, NETWORK_ADMIN_ROLES, NETWORK_ARRIVAL_ROLES, NETWORK_CLINICAL_ROLES, NETWORK_COVERAGE_ROLES,
  NETWORK_ROLES, RECORD_LABEL, STATUS_LABEL,
  cancelTransfer, completeTransfer, createTransfer, getSettings, listDirectory, listEvents, listShareableRecords, listTransferRecords,
  listTransfers, markArrived, respond, saveSettings, sendMessage, setCoverage, subscribeToTransfers,
  type Capacity, type Coverage, type NetworkFacility, type NetworkSettings, type NetworkTransfer, type RecordType, type ShareableRecord,
  type TransferEvent, type TransferKind, type TransferRecord, type TransferStatus, type Urgency,
} from '@/lib/supabase/network';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const fullName = (p: { first_name: string; middle_name?: string | null; last_name: string }) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
const ageOf = (dob: string) => Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const OPEN: TransferStatus[] = ['pending_review', 'info_requested', 'accepted', 'records_shared', 'arrived'];

const STATUS_TONE: Record<TransferStatus, string> = {
  pending_review: 'bg-amber-100 text-amber-800', info_requested: 'bg-orange-100 text-orange-800', accepted: 'bg-sky-100 text-sky-800',
  records_shared: 'bg-indigo-100 text-indigo-800', arrived: 'bg-violet-100 text-violet-800', completed: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-800', cancelled: 'bg-slate-100 text-slate-600',
};
const CAPACITY_TONE: Record<Capacity, string> = {
  available: 'bg-emerald-100 text-emerald-800', limited: 'bg-amber-100 text-amber-800', unavailable: 'bg-red-100 text-red-800', not_reported: 'bg-slate-100 text-slate-600',
};
const URGENCY_TONE: Record<Urgency, string> = { normal: 'text-slate-500', urgent: 'text-orange-600 font-medium', emergency: 'text-red-600 font-semibold' };

type Tab = 'directory' | 'transfers';

export function LiveNetwork() {
  const { organization, currentRole } = useAuth();
  const orgId = organization.id;
  const role = String(currentRole);
  const [tab, setTab] = useState<Tab>('directory');
  const [directory, setDirectory] = useState<NetworkFacility[] | null>(null);
  const [settings, setSettings] = useState<NetworkSettings | null>(null);
  const [transfers, setTransfers] = useState<NetworkTransfer[] | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState<{ facility: NetworkFacility; kind: TransferKind } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadDirectory = useCallback(() => {
    listDirectory().then(setDirectory).catch((error) => { toast.error(errorText(error, 'Could not load the directory')); setDirectory([]); });
    getSettings(orgId).then(setSettings).catch(() => undefined);
  }, [orgId]);
  const loadTransfers = useCallback(() => {
    listTransfers(orgId).then(setTransfers).catch((error) => { toast.error(errorText(error, 'Could not load referrals')); setTransfers([]); });
  }, [orgId]);

  useEffect(() => { loadDirectory(); loadTransfers(); }, [loadDirectory, loadTransfers]);
  useEffect(() => subscribeToTransfers(orgId, loadTransfers), [orgId, loadTransfers]);

  if (!NETWORK_ROLES.includes(role)) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">The VitaLink Network is available to clinical, front-desk, billing and admin staff.</div>;
  }

  const isAdmin = NETWORK_ADMIN_ROLES.includes(role);
  const canSend = NETWORK_CLINICAL_ROLES.includes(role) && Boolean(settings?.joined);
  const incomingOpen = (transfers ?? []).filter((t) => t.receivingOrgId === orgId && OPEN.includes(t.status)).length;
  const needsAction = (transfers ?? []).filter((t) => (t.receivingOrgId === orgId && t.status === 'pending_review') || (t.referringOrgId === orgId && ['info_requested', 'accepted'].includes(t.status))).length;
  const others = (directory ?? []).filter((f) => !f.isMine);
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);

  const openTransfer = (id: string) => { setSelectedTransferId(id); setTab('transfers'); };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">VitaLink Network</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Find hospitals on VitaLink, refer or transfer patients, and share records with the patient's consent.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {settings && (
            <span data-tour-id="network-status" className={cn('rounded-full px-3 py-1 text-xs', settings.joined ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
              {settings.joined ? (settings.visibleInDirectory ? 'On the network · listed' : 'On the network · not listed') : 'Not on the network'}
            </span>
          )}
          {isAdmin && <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-1 h-4 w-4" />Network settings</Button>}
        </div>
      </header>

      {settings && !settings.joined && (
        <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <p>Your workspace isn't on the VitaLink Network yet, so you can browse but not send or receive referrals.</p>
          {isAdmin ? <Button onClick={() => setSettingsOpen(true)}>Join the network</Button> : <p className="text-xs">Ask a workspace admin to join.</p>}
        </div>
      )}

      <section data-tour-id="network-stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Hospitals on the network" value={others.length} hint={`${others.filter((f) => f.verified).length} verified`} />
        <Metric label="Incoming, open" value={incomingOpen} hint={`${(transfers ?? []).filter((t) => t.receivingOrgId === orgId && t.status === 'pending_review').length} awaiting your review`} />
        <Metric label="Sent, open" value={(transfers ?? []).filter((t) => t.referringOrgId === orgId && OPEN.includes(t.status)).length} hint="referrals and transfers" />
        <Metric label="Completed this month" value={(transfers ?? []).filter((t) => t.status === 'completed' && new Date(t.updatedAt) >= thisMonth).length} hint="both directions" />
      </section>

      <div data-tour-id="network-tabs" className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900/70">
        {([['directory', 'Directory'], ['transfers', 'Referrals & transfers']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={cn('rounded-lg px-4 py-2 text-sm', tab === id ? 'bg-white font-medium text-royal-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400')}>
            {label}{id === 'transfers' && needsAction > 0 && <span className="ml-2 rounded-full bg-royal-600 px-1.5 text-[11px] text-white">{needsAction}</span>}
          </button>
        ))}
      </div>

      {tab === 'directory' && (
        <DirectoryView facilities={directory} canSend={canSend} joined={Boolean(settings?.joined)} onSend={(facility, kind) => setSendTo({ facility, kind })} />
      )}
      {tab === 'transfers' && (
        <TransfersView transfers={transfers} orgId={orgId} role={role} selectedId={selectedTransferId} onSelect={setSelectedTransferId} onChanged={loadTransfers} />
      )}

      {sendTo && (
        <SendDialog key={sendTo.facility.organizationId + sendTo.kind} facility={sendTo.facility} kind={sendTo.kind} onClose={() => setSendTo(null)}
          onSent={(id) => { setSendTo(null); loadTransfers(); openTransfer(id); }} />
      )}
      {settingsOpen && settings && (
        <SettingsDialog initial={settings} onClose={() => setSettingsOpen(false)}
          onSave={async (next) => { await saveSettings(orgId, next); toast.success('Network settings saved'); setSettingsOpen(false); loadDirectory(); }} />
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/80">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DIRECTORY

const CAPABILITIES = [
  ['emergency', 'Emergency'], ['laboratory', 'Laboratory'], ['imaging', 'Imaging'], ['pharmacy', 'Pharmacy'], ['telemedicine', 'Telemedicine'],
] as const;

function DirectoryView({ facilities, canSend, joined, onSend }: {
  facilities: NetworkFacility[] | null; canSend: boolean; joined: boolean; onSend: (facility: NetworkFacility, kind: TransferKind) => void;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [needs, setNeeds] = useState<string[]>([]);
  const [onlyAccepting, setOnlyAccepting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const states = useMemo(() => [...new Set((facilities ?? []).map((f) => f.state).filter(Boolean))].sort(), [facilities]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (facilities ?? []).filter((f) => {
      if (term && ![f.name, f.city, f.state, f.facilityType, f.description, ...f.specialties, ...f.services].join(' ').toLowerCase().includes(term)) return false;
      if (state && f.state !== state) return false;
      if (needs.some((key) => !f[key as keyof NetworkFacility])) return false;
      if (onlyAccepting && !(f.acceptingReferrals || f.acceptingTransfers)) return false;
      return true;
    }).sort((a, b) => Number(a.isMine) - Number(b.isMine) || Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name));
  }, [facilities, query, state, needs, onlyAccepting]);
  const selected = visible.find((f) => f.organizationId === selectedId) ?? visible.find((f) => !f.isMine) ?? visible[0];

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="grid gap-2 md:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by hospital, specialty, service or city" />
          </div>
          <select value={state} onChange={(e) => setState(e.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm dark:bg-slate-900/50">
            <option value="">All states</option>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {CAPABILITIES.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setNeeds((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))}
              className={cn('rounded-full border px-3 py-1 text-xs', needs.includes(key) ? 'border-royal-600 bg-royal-600 text-white' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}>
              {label}
            </button>
          ))}
          <button type="button" onClick={() => setOnlyAccepting((v) => !v)}
            className={cn('rounded-full border px-3 py-1 text-xs', onlyAccepting ? 'border-royal-600 bg-royal-600 text-white' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}>
            Accepting patients
          </button>
          {(query || state || needs.length > 0 || onlyAccepting) && (
            <button type="button" className="text-xs text-royal-700 underline" onClick={() => { setQuery(''); setState(''); setNeeds([]); setOnlyAccepting(false); }}>Clear</button>
          )}
        </div>
      </div>

      {facilities === null && <p className="text-sm text-slate-500">Loading the directory...</p>}
      {facilities && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          <Hospital className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          {facilities.length ? 'No hospital matches these filters.' : 'No other hospitals have joined the VitaLink Network yet.'}
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid gap-3 lg:grid-cols-2">
            {visible.map((f) => (
              <button key={f.organizationId} type="button" onClick={() => setSelectedId(f.organizationId)}
                className={cn('rounded-2xl border bg-white p-4 text-left dark:bg-slate-800/80',
                  selected?.organizationId === f.organizationId ? 'border-royal-400 ring-2 ring-royal-100 dark:ring-blue-900/50' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-50">
                      {f.name}{f.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-royal-600" aria-label="Verified by VitaLink" />}
                    </p>
                    <p className="text-xs text-slate-500">{[f.facilityType || f.organizationType, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
                  </div>
                  {f.isMine ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Your workspace</span>
                    : <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', CAPACITY_TONE[f.capacity])}>{CAPACITY_LABEL[f.capacity]}</span>}
                </div>
                {f.specialties.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.specialties.slice(0, 4).map((s) => <span key={s} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">{s}</span>)}
                    {f.specialties.length > 4 && <span className="text-[11px] text-slate-500">+{f.specialties.length - 4}</span>}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  {CAPABILITIES.filter(([key]) => f[key]).map(([, label]) => label).join(' · ') || 'Services not listed yet'}
                </p>
              </button>
            ))}
          </div>
          {selected && <FacilityPanel facility={selected} canSend={canSend} joined={joined} onSend={onSend} />}
        </div>
      )}
    </div>
  );
}

function FacilityPanel({ facility: f, canSend, joined, onSend }: { facility: NetworkFacility; canSend: boolean; joined: boolean; onSend: (facility: NetworkFacility, kind: TransferKind) => void }) {
  const blockedReason = f.isMine ? 'This is your workspace.' : !joined ? 'Join the network to send referrals.' : !canSend ? 'Only doctors and admins can send referrals.' : '';
  return (
    <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800/90 xl:sticky xl:top-24">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-royal-50 p-3 text-royal-700"><Building2 className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-50">{f.name}{f.verified && <BadgeCheck className="h-4 w-4 text-royal-600" />}</h2>
          <p className="text-xs text-slate-500">{f.facilityType || f.organizationType}</p>
          {f.verified && <p className="text-[11px] text-royal-700">Verified by VitaLink</p>}
        </div>
      </div>
      {f.description && <p className="text-sm text-slate-700 dark:text-slate-300">{f.description}</p>}
      <div className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {(f.address || f.city || f.state) && <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{[f.address, f.city, f.state].filter(Boolean).join(', ')}</p>}
        {f.phone && <p className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><a href={`tel:${f.phone}`} className="hover:underline">{f.phone}</a></p>}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Capacity</p>
        <span className={cn('rounded-full px-2 py-0.5 text-xs', CAPACITY_TONE[f.capacity])}>{CAPACITY_LABEL[f.capacity]}</span>
        {f.capacityUpdatedAt && <span className="ml-2 text-[11px] text-slate-500">updated {timeAgo(f.capacityUpdatedAt)}</span>}
        <p className="mt-1 text-[11px] text-slate-500">Reported by the hospital; call ahead for emergencies.</p>
      </div>
      {f.specialties.length > 0 && <TagList label="Specialties" items={f.specialties} />}
      {f.services.length > 0 && <TagList label="Services" items={f.services} />}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {CAPABILITIES.map(([key, label]) => <Flag key={key} label={label} on={f[key]} />)}
        <Flag label="Takes referrals" on={f.acceptingReferrals} />
        <Flag label="Takes transfers" on={f.acceptingTransfers} />
      </div>
      {!f.isMine && (
        <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-700">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={Boolean(blockedReason) || !f.acceptingReferrals} onClick={() => onSend(f, 'referral')}>Send referral</Button>
            <Button disabled={Boolean(blockedReason) || !f.acceptingTransfers} onClick={() => onSend(f, 'transfer')}>Request transfer</Button>
          </div>
          {blockedReason && <p className="text-xs text-slate-500">{blockedReason}</p>}
        </div>
      )}
    </aside>
  );
}

function TagList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-1">{items.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">{s}</span>)}</div>
    </div>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={cn('flex items-center gap-1 rounded-lg px-2 py-1', on ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500 dark:bg-slate-900/50')}>
      {on ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SEND A REFERRAL / TRANSFER

const CONSENT_METHODS = ['Verbal consent, witnessed', 'Signed consent form', 'Consent by next of kin', 'Emergency (patient unable to consent)'];

function SendDialog({ facility, kind, onClose, onSent }: { facility: NetworkFacility; kind: TransferKind; onClose: () => void; onSent: (transferId: string) => void }) {
  const [step, setStep] = useState(1);
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const [specialty, setSpecialty] = useState(facility.specialties[0] ?? '');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [requestedDate, setRequestedDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [records, setRecords] = useState<ShareableRecord[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [consentMethod, setConsentMethod] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'transfer' ? 'transfer' : 'referral';

  useEffect(() => {
    if (!patient) return;
    let cancelled = false;
    listShareableRecords(patient.id)
      .then((list) => { if (!cancelled) { setRecords(list); setChosen([]); } }) // nothing pre-selected: share only what's needed
      .catch(() => { if (!cancelled) setRecords([]); });
    return () => { cancelled = true; };
  }, [patient]);

  const next = () => {
    if (step === 1 && !patient) return toast.error('Choose the patient');
    if (step === 2 && !reason.trim()) return toast.error(`Give a reason for the ${noun}`);
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (!patient) return;
    if (!consentMethod) return toast.error('Record how the patient gave consent');
    if (!consentConfirmed) return toast.error('Confirm the patient consented to this sharing');
    setBusy(true);
    try {
      const id = await createTransfer({
        kind, receivingOrgId: facility.organizationId, patientId: patient.id, reason: reason.trim(), specialty: specialty.trim(),
        clinicalSummary: summary.trim(), urgency, requestedDate, notes: notes.trim(), consentMethod,
        records: chosen.map((key) => { const [type, id] = key.split(':'); return { type: type as RecordType, id }; }),
      });
      toast.success(`${kind === 'transfer' ? 'Transfer request' : 'Referral'} sent to ${facility.name}`);
      onSent(id);
    } catch (error) {
      toast.error(errorText(error, 'Could not send'));
    } finally {
      setBusy(false);
    }
  };

  const steps = ['Patient', 'Details', 'Records', 'Consent'];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{kind === 'transfer' ? 'Request a transfer' : 'Send a referral'} to {facility.name}</DialogTitle>
          <DialogDescription>{facility.name} only sees the records you choose, and only after they accept and you share them.</DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-4 gap-1 text-xs">
          {steps.map((label, i) => (
            <li key={label} className={cn('rounded-lg px-2 py-1.5 text-center', step === i + 1 ? 'bg-royal-600 text-white' : step > i + 1 ? 'bg-royal-50 text-royal-700' : 'bg-slate-100 text-slate-500 dark:bg-slate-800')}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Patient</label>
            <PatientSearch value={patient} onChange={setPatient} autoFocus />
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">Specialty needed
              {facility.specialties.length ? (
                <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm font-normal dark:bg-slate-900/50">
                  {facility.specialties.map((s) => <option key={s}>{s}</option>)}
                  <option value="">Other / general</option>
                </select>
              ) : <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="e.g. Cardiology" />}
            </label>
            <label className="space-y-1 text-sm font-medium">Urgency
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm font-normal dark:bg-slate-900/50">
                <option value="normal">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">{kind === 'transfer' ? 'Transfer date' : 'Preferred appointment date'}
              <Input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
            </label>
            <div />
            <label className="space-y-1 text-sm font-medium sm:col-span-2">Reason *
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Why this ${noun} is needed`} />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">Clinical summary
              <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Presenting problem, findings, treatment so far" />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">Notes for the receiving team
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <p className="font-medium">Records to share ({chosen.length} chosen)</p>
              {records && records.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-royal-700 underline" onClick={() => setChosen(records.map((r) => `${r.type}:${r.id}`))}>All</button>
                  <button type="button" className="text-royal-700 underline" onClick={() => setChosen([])}>None</button>
                </div>
              )}
            </div>
            {records === null && <p className="text-sm text-slate-500">Loading records...</p>}
            {records?.length === 0 && <p className="text-sm text-slate-500">This patient has no signed notes, vitals, results, prescriptions or documents yet. You can still send the {noun}.</p>}
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {records?.map((r) => {
                const key = `${r.type}:${r.id}`;
                return (
                  <label key={key} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-700">
                    <input type="checkbox" className="mt-1" checked={chosen.includes(key)} onChange={(e) => setChosen((list) => (e.target.checked ? [...list, key] : list.filter((k) => k !== key)))} />
                    <span className="min-w-0"><span className="block truncate">{r.label}</span><span className="text-[11px] text-slate-500">{RECORD_LABEL[r.type]} · {date(r.date)}</span></span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && patient && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900">
              {facility.name} will see {patient.firstName} {patient.lastName}'s details and, once they accept, the {chosen.length} record{chosen.length === 1 ? '' : 's'} you chose. Share only what the patient agreed to.
            </div>
            <label className="space-y-1 font-medium">How did the patient consent?
              <select value={consentMethod} onChange={(e) => setConsentMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm font-normal dark:bg-slate-900/50">
                <option value="">Choose...</option>
                {CONSENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} />
              <span>I confirm the patient (or their representative) agreed to this {noun} and to sharing these records with {facility.name}.</span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}>{step === 1 ? 'Cancel' : 'Back'}</Button>
          {step < 4 ? <Button onClick={next}>Continue</Button>
            : <Button disabled={busy} onClick={() => void submit()}><Send className="mr-1 h-4 w-4" />{busy ? 'Sending...' : `Send ${noun}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// REFERRALS & TRANSFERS

function TransfersView({ transfers, orgId, role, selectedId, onSelect, onChanged }: {
  transfers: NetworkTransfer[] | null; orgId: string; role: string; selectedId: string | null; onSelect: (id: string | null) => void; onChanged: () => void;
}) {
  const [direction, setDirection] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [showClosed, setShowClosed] = useState(false);
  const list = (transfers ?? []).filter((t) => (direction === 'all' || (direction === 'incoming' ? t.receivingOrgId === orgId : t.referringOrgId === orgId)) && (showClosed || OPEN.includes(t.status)));
  const selected = (transfers ?? []).find((t) => t.id === selectedId) ?? list[0] ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {(['all', 'incoming', 'outgoing'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDirection(d)} className={cn('rounded-full px-3 py-1 text-xs capitalize', direction === d ? 'bg-royal-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{d}</button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show closed</label>
          <button type="button" onClick={onChanged} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
        {transfers === null && <p className="text-sm text-slate-500">Loading...</p>}
        {transfers && list.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            Nothing here yet. Send a referral or transfer from the Directory.
          </div>
        )}
        {list.map((t) => {
          const incoming = t.receivingOrgId === orgId;
          return (
            <button key={t.id} type="button" onClick={() => onSelect(t.id)}
              className={cn('w-full rounded-2xl border bg-white p-3 text-left dark:bg-slate-800/80', selected?.id === t.id ? 'border-royal-400 ring-2 ring-royal-100 dark:ring-blue-900/50' : 'border-slate-200 dark:border-slate-700')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {incoming ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-royal-600" />}
                    {fullName(t.patient)}
                  </p>
                  <p className="truncate text-xs text-slate-500">{incoming ? `From ${t.referringOrgName}` : `To ${t.receivingOrgName}`} · {t.kind}{t.specialty ? ` · ${t.specialty}` : ''}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', STATUS_TONE[t.status])}>{STATUS_LABEL[t.status]}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {t.number} · <span className={URGENCY_TONE[t.urgency]}>{t.urgency}</span> · updated {timeAgo(t.updatedAt)}
              </p>
            </button>
          );
        })}
      </div>
      {selected ? <TransferDetail key={selected.id} transfer={selected} orgId={orgId} role={role} onChanged={onChanged} />
        : <div className="hidden rounded-2xl border border-dashed border-slate-200 xl:block dark:border-slate-700" />}
    </div>
  );
}

function TransferDetail({ transfer: t, orgId, role, onChanged }: { transfer: NetworkTransfer; orgId: string; role: string; onChanged: () => void }) {
  const incoming = t.receivingOrgId === orgId;
  const [events, setEvents] = useState<TransferEvent[] | null>(null);
  const [records, setRecords] = useState<TransferRecord[] | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [register, setRegister] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listEvents(t.id).then(setEvents).catch(() => setEvents([]));
    listTransferRecords(t.id).then(setRecords).catch(() => setRecords([]));
  }, [t.id]);
  useEffect(() => { load(); }, [load, t.updatedAt]);

  const run = async (label: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await action(); if (done) toast.success(done); setNote(''); onChanged(); load(); }
    catch (error) { toast.error(errorText(error, `Could not ${label}`)); }
    finally { setBusy(false); }
  };

  const clinical = NETWORK_CLINICAL_ROLES.includes(role);
  const canReview = incoming && clinical && ['pending_review', 'info_requested'].includes(t.status);
  const canArrive = incoming && NETWORK_ARRIVAL_ROLES.includes(role) && ['accepted', 'records_shared'].includes(t.status);
  const canComplete = incoming && clinical && t.status === 'arrived';
  const canCancel = !incoming && clinical && ['pending_review', 'info_requested', 'accepted', 'records_shared'].includes(t.status);
  const canCoverage = NETWORK_COVERAGE_ROLES.includes(role) && OPEN.includes(t.status);
  const closed = ['completed', 'declined', 'cancelled'].includes(t.status);
  const p = t.patient;
  const lastInfoRequest = [...(events ?? [])].reverse().find((e) => e.kind === 'info_requested');

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{t.number} · {t.kind === 'transfer' ? 'Transfer' : 'Referral'} · sent {date(t.createdAt)} by {t.clinicianName}</p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{t.referringOrgName} → {t.receivingOrgName}</h2>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs', STATUS_TONE[t.status])}>{STATUS_LABEL[t.status]}</span>
      </div>

      {t.status === 'info_requested' && lastInfoRequest && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
          <b>{t.receivingOrgName} asked:</b> {lastInfoRequest.body}
          {!incoming && <p className="mt-1 text-xs">Reply in the message box below; it goes back for review.</p>}
        </div>
      )}
      {t.status === 'declined' && t.declineReason && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><b>Declined:</b> {t.declineReason}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-700">
          <p className="mb-1 text-xs font-medium text-slate-500">Patient</p>
          <p className="font-semibold">{fullName(p)}</p>
          <p className="text-xs text-slate-500">{p.switch_id} · {p.gender}{p.date_of_birth ? `, ${ageOf(p.date_of_birth)} yrs (${date(p.date_of_birth)})` : ''}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {p.blood_group && <><dt className="text-slate-500">Blood group</dt><dd>{p.blood_group}{p.genotype ? ` · ${p.genotype}` : ''}</dd></>}
            {p.allergies && <><dt className="text-slate-500">Allergies</dt><dd className="font-medium text-red-700">{p.allergies}</dd></>}
            {p.chronic_conditions && <><dt className="text-slate-500">Conditions</dt><dd>{p.chronic_conditions}</dd></>}
            {p.current_medications && <><dt className="text-slate-500">Medications</dt><dd>{p.current_medications}</dd></>}
            {p.phone && <><dt className="text-slate-500">Phone</dt><dd>{p.phone}</dd></>}
            {p.emergency_contact_name && <><dt className="text-slate-500">Next of kin</dt><dd>{p.emergency_contact_name}{p.emergency_phone ? ` · ${p.emergency_phone}` : ''}</dd></>}
          </dl>
        </section>
        <section className="space-y-2 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-700">
          <div>
            <p className="text-xs font-medium text-slate-500">Reason</p>
            <p>{t.reason}</p>
          </div>
          {t.clinicalSummary && <div><p className="text-xs font-medium text-slate-500">Clinical summary</p><p className="whitespace-pre-wrap">{t.clinicalSummary}</p></div>}
          <p className="text-xs text-slate-500">
            <span className={URGENCY_TONE[t.urgency]}>{t.urgency}</span>{t.specialty ? ` · ${t.specialty}` : ''}{t.requestedDate ? ` · for ${date(t.requestedDate)}` : ''}
          </p>
          {t.notes && <p className="text-xs"><b>Notes:</b> {t.notes}</p>}
          <p className="flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Consent: {t.consentMethod} · {date(t.consentRecordedAt)}</p>
        </section>
      </div>

      {/* Actions for this side */}
      {!closed && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
          {canReview && (
            <>
              {records && records.length > 0 && <p className="text-xs text-slate-600 dark:text-slate-400">Accepting gives you the {records.length} record{records.length === 1 ? '' : 's'} below; the patient consented to this sharing.</p>}
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the sender (needed to decline or ask for information)" />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void run('accept', () => respond(t.id, 'accept', note), records?.length ? `Accepted. ${records.length} record${records.length === 1 ? '' : 's'} received.` : 'Accepted')}><CheckCircle2 className="mr-1 h-4 w-4" />Accept</Button>
                <Button disabled={busy} variant="outline" onClick={() => void run('ask', () => respond(t.id, 'request_info', note), 'Information requested')}>Ask for more information</Button>
                <Button disabled={busy} variant="outline" className="border-red-200 text-red-700" onClick={() => void run('decline', () => respond(t.id, 'decline', note), 'Declined')}><XCircle className="mr-1 h-4 w-4" />Decline</Button>
              </div>
            </>
          )}
          {canArrive && (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy} onClick={() => void run('record arrival', () => markArrived(t.id, register), 'Arrival recorded')}>Patient has arrived</Button>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />Add to our patient registry (keeps VitaLink ID {p.switch_id})</label>
            </div>
          )}
          {canComplete && <Button disabled={busy} onClick={() => void run('complete', () => completeTransfer(t.id), 'Completed')}>Mark completed</Button>}
          {!canReview && !canArrive && !canComplete && (
            <p className="text-xs text-slate-500">
              {incoming ? 'Nothing for you to do right now.'
                : t.status === 'pending_review' ? `Waiting for ${t.receivingOrgName} to review.` : ['accepted', 'records_shared'].includes(t.status) ? `Accepted. Waiting for the patient to arrive at ${t.receivingOrgName}.` : t.status === 'arrived' ? `${t.receivingOrgName} will close it after admission.` : 'Nothing for you to do right now.'}
            </p>
          )}
          {canCancel && (
            <button type="button" className="text-xs text-red-700 underline" disabled={busy}
              onClick={() => { const reason = window.prompt('Why are you cancelling?'); if (reason?.trim()) void run('cancel', () => cancelTransfer(t.id, reason), 'Cancelled'); }}>
              Cancel this {t.kind}
            </button>
          )}
        </div>
      )}
      {t.receivedPatientId && incoming && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { switchId: p.switch_id } }))}>Open patient record</Button>
          Shared records are in their EMR under "From other hospitals".
        </div>
      )}

      <RecordsPanel records={records} incoming={incoming} transfer={t} />

      <CoverageRow transfer={t} editable={canCoverage} onSaved={() => { onChanged(); load(); }} />

      <section>
        <p className="mb-2 text-sm font-semibold">Timeline & messages</p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {events?.map((e) => (
            <div key={e.id} className={cn('rounded-lg px-3 py-2 text-sm', ['message', 'info_requested', 'info_provided'].includes(e.kind) ? (e.organizationId === orgId ? 'ml-6 bg-royal-50' : 'mr-6 bg-slate-100 dark:bg-slate-900/60') : 'border-l-2 border-slate-200 bg-transparent pl-3 dark:border-slate-700')}>
              <p className="text-[11px] text-slate-500">{e.organizationName} · {e.actorName} · {new Date(e.at).toLocaleString('en-GB')}</p>
              <p><b className="capitalize">{EVENT_LABEL[e.kind] ?? e.kind}</b>{e.body ? `: ${e.body}` : ''}</p>
            </div>
          ))}
        </div>
        {!closed && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (message.trim()) void run('send', () => sendMessage(t.id, message), undefined).then(() => setMessage('')); }}>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Message ${incoming ? t.referringOrgName : t.receivingOrgName}`} />
            <Button type="submit" disabled={busy || !message.trim()}><Send className="h-4 w-4" /></Button>
          </form>
        )}
      </section>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Sent', accepted: 'Accepted', declined: 'Declined', info_requested: 'Asked for information', info_provided: 'Replied',
  message: 'Message', records_shared: 'Records shared', arrived: 'Patient arrived', registered: 'Registered', completed: 'Completed',
  cancelled: 'Cancelled', coverage: 'Coverage',
};

function CoverageRow({ transfer: t, editable, onSaved }: { transfer: NetworkTransfer; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = useState<Coverage>(t.coverage);
  const ins = t.insurance;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-700">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500">Insurance</p>
        <p>{ins.provider ? `${ins.provider}${ins.policy_number ? ` · ${ins.policy_number}` : ''}${ins.type ? ` · ${ins.type}` : ''}` : 'No insurance on file'}</p>
      </div>
      {editable ? (
        <div className="flex items-center gap-2">
          <select value={value} onChange={(e) => setValue(e.target.value as Coverage)} className="h-9 rounded-md border border-input bg-white px-2 text-sm dark:bg-slate-900/50">
            {Object.entries(COVERAGE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={value === t.coverage}
            onClick={() => setCoverage(t.id, value).then(() => { toast.success('Coverage recorded'); onSaved(); }).catch((error) => toast.error(errorText(error, 'Could not save')))}>Save</Button>
        </div>
      ) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">{COVERAGE_LABEL[t.coverage]}</span>}
    </section>
  );
}

function RecordsPanel({ records, incoming, transfer: t }: { records: TransferRecord[] | null; incoming: boolean; transfer: NetworkTransfer }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!records) return null;
  return (
    <section>
      <p className="mb-2 text-sm font-semibold">Records ({records.length})</p>
      {records.length === 0 && <p className="text-xs text-slate-500">No records were attached.</p>}
      {incoming && records.length > 0 && !records.some((r) => r.content) && (
        <p className="mb-2 text-xs text-slate-500">{t.status === 'pending_review' || t.status === 'info_requested' ? 'Accept to receive these records.' : 'These records were not shared.'}</p>
      )}
      <div className="space-y-1">
        {records.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-100 dark:border-slate-700">
            <button type="button" disabled={!r.content} onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:cursor-default">
              <span className="min-w-0"><span className="block truncate">{r.label}</span><span className="text-[11px] text-slate-500">{RECORD_LABEL[r.type]} · {date(r.date)}</span></span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', r.sharedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>{r.sharedAt ? (r.content ? 'Shared · view' : 'Shared') : 'Not shared yet'}</span>
            </button>
            {open === r.id && r.content && <RecordContent type={r.type} content={r.content} />}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SETTINGS

function SettingsDialog({ initial, onClose, onSave }: { initial: NetworkSettings; onClose: () => void; onSave: (s: NetworkSettings) => Promise<void> }) {
  const [s, setS] = useState(initial);
  const [specialties, setSpecialties] = useState(initial.specialties.join(', '));
  const [services, setServices] = useState(initial.services.join(', '));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NetworkSettings>(key: K, value: NetworkSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const split = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    try { await onSave({ ...s, specialties: split(specialties), services: split(services) }); }
    catch (error) { toast.error(errorText(error, 'Could not save')); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Network settings</DialogTitle>
          <DialogDescription>Join the VitaLink Network to send and receive referrals and transfers, and choose what other hospitals see about you.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <span><b>Join the VitaLink Network</b><br /><span className="text-xs text-slate-500">Lets you send referrals and receive them from other hospitals.</span></span>
          <input type="checkbox" className="h-5 w-5" checked={s.joined} onChange={(e) => set('joined', e.target.checked)} />
        </label>
        {s.joined && (
          <div className="space-y-3 text-sm">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <span><b>List us in the directory</b><br /><span className="text-xs text-slate-500">Off: you can still send referrals, but others can't find you to refer patients.</span></span>
              <input type="checkbox" className="h-5 w-5" checked={s.visibleInDirectory} onChange={(e) => set('visibleInDirectory', e.target.checked)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 font-medium">Facility type<Input value={s.facilityType} onChange={(e) => set('facilityType', e.target.value)} placeholder="e.g. Specialist Hospital" /></label>
              <label className="space-y-1 font-medium">City<Input value={s.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Ikeja" /></label>
              <label className="space-y-1 font-medium">State<Input value={s.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Lagos" /></label>
            </div>
            <label className="block space-y-1 font-medium">About<Textarea rows={2} value={s.description} onChange={(e) => set('description', e.target.value)} placeholder="One or two lines other hospitals will see" /></label>
            <label className="block space-y-1 font-medium">Specialties (comma separated)<Input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="Cardiology, Paediatrics, General Surgery" /></label>
            <label className="block space-y-1 font-medium">Services (comma separated)<Input value={services} onChange={(e) => setServices(e.target.value)} placeholder="ICU, Dialysis, CT scan" /></label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([['emergency', 'Emergency'], ['laboratory', 'Laboratory'], ['imaging', 'Imaging'], ['pharmacy', 'Pharmacy'], ['telemedicine', 'Telemedicine'], ['acceptingReferrals', 'Taking referrals'], ['acceptingTransfers', 'Taking transfers']] as Array<[keyof NetworkSettings, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-slate-700">
                  <input type="checkbox" checked={Boolean(s[key])} onChange={(e) => set(key, e.target.checked as never)} />{label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 font-medium">Bed capacity
                <select value={s.capacity} onChange={(e) => set('capacity', e.target.value as Capacity)} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm font-normal dark:bg-slate-900/50">
                  {Object.entries(CAPACITY_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1 font-medium">Referral email<Input type="email" value={s.referralEmail} onChange={(e) => set('referralEmail', e.target.value)} placeholder="Gets referral alerts" /></label>
              <label className="space-y-1 font-medium">Referral phone<Input value={s.referralPhone} onChange={(e) => set('referralPhone', e.target.value)} placeholder="Shown in the directory" /></label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
