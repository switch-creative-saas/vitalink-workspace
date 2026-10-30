// Digital Health Identity for a live (Supabase) workspace: identify patients by
// VitaCard (Web NFC or a USB reader that types the card number), QR code or
// search; show their identity summary; link VitaCards; print ID cards. Free workspaces see a basic
// profile and can't set up cards (the 'nfc-scanning' entitlement on paid plans; the database enforces linking).
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePatientPhoto } from '@/lib/supabase/patientPhotos';
import QRCode from 'qrcode';
import {
  AlertTriangle, ArrowUpRight, CalendarDays, Clock, CreditCard, Droplets, FileText, Link2, Nfc, Plus, Printer, QrCode,
  Search, Shield, Smartphone, Unlink, User, Wifi, WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PatientOnboardingWizard } from '@/components/patients/PatientOnboardingWizard';
import { LiveBookAppointmentDialog } from '@/components/dashboard/LiveQuickActions';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { findPatientBySwitchId, queryPatients, type RegistryPatient } from '@/lib/patientRegistry';
import {
  findPatientByCode, getLastVisit, listIdentityScans, logIdentityScan, setPatientCard,
  type IdentityScan, type ScanMethod,
} from '@/lib/supabase/dashboard';
import { codeFromScan, nfcSupported, qrSupported, startNfcScan, startQrScan } from '@/lib/scanners';
import { timeAgo } from '@/lib/timeAgo';

const NO_FILTERS = {
  gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '',
  admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '',
};
const splitList = (value?: string) =>
  (value ?? '').split(/[,;\n]+/).map((item) => item.trim()).filter((item) => item && !/^(none|nil|nkda|n\/a)$/i.test(item));
const ageFrom = (dob: string) => {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age;
};
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

function insuranceState(patient: RegistryPatient): { label: string; tone: 'ok' | 'bad' | 'none' } {
  if (!patient.insuranceProvider) return { label: 'No insurance on file', tone: 'none' };
  if (patient.insuranceExpiryDate && new Date(patient.insuranceExpiryDate) < new Date()) {
    return { label: `${patient.insuranceProvider} · expired`, tone: 'bad' };
  }
  return { label: `${patient.insuranceProvider} · active`, tone: 'ok' };
}

/** Prints a wallet-size identity card with the VitaLink ID as a QR code (no clinical detail in the QR). */
async function printIdCard(patient: RegistryPatient, facility: string) {
  const qr = await QRCode.toDataURL(patient.switchId, { margin: 1, width: 220 });
  const allergies = splitList(patient.allergies).join(', ') || 'None recorded';
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>VitaLink ID ${escapeHtml(patient.switchId)}</title>
<style>@page{size:auto;margin:12mm}body{font-family:system-ui,sans-serif;color:#0f172a}
.card{width:86mm;border:1px solid #cbd5e1;border-radius:10px;padding:10px;display:flex;gap:10px}
.qr{width:28mm;height:28mm}h1{font-size:13px;margin:0 0 2px}.id{font-size:15px;font-weight:800;color:#1E4ED8;margin:2px 0 6px}
p{font-size:9.5px;margin:1px 0}.brand{font-size:9px;color:#64748b;margin-top:6px}</style></head><body>
<div class="card"><img class="qr" src="${qr}" alt=""><div>
<h1>${escapeHtml(`${patient.firstName} ${patient.lastName}`)}</h1><div class="id">${escapeHtml(patient.switchId)}</div>
<p><b>Blood group:</b> ${escapeHtml(patient.bloodGroup || '—')} · <b>Genotype:</b> ${escapeHtml(patient.genotype || '—')}</p>
<p><b>Allergies:</b> ${escapeHtml(allergies)}</p>
<p><b>Emergency:</b> ${escapeHtml(patient.emergencyContactName || '—')} ${escapeHtml(patient.emergencyPhone || '')}</p>
<div class="brand">VitaLink Health Identity · ${escapeHtml(facility)}</div></div></div></body></html>`;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export function LiveHealthIdentity() {
  const { canCreate, canEdit, userName, organization } = useAuth();
  const organizationId = organization.id;
  const [mode, setMode] = useState<ScanMethod>('nfc');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const photoUrl = usePatientPhoto(patient?.profilePhoto);
  const [lastVisit, setLastVisit] = useState<{ at: string; type: string; status: string; department: string } | null>(null);
  const [qr, setQr] = useState('');
  const [scans, setScans] = useState<IdentityScan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [cardInput, setCardInput] = useState('');
  const [unlinkedCard, setUnlinkedCard] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasModule } = usePlan();
  const fullProfile = hasModule('nfc-scanning');
  const canLink = canEdit('Patients') && fullProfile;
  const upgrade = () => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }));

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const loadScans = useCallback(() => {
    listIdentityScans(organizationId).then(setScans).catch(() => setScans([]));
  }, [organizationId]);
  useEffect(() => { loadScans(); }, [loadScans]);

  // Profile extras: last visit and the ID QR.
  useEffect(() => {
    if (!patient) return;
    let cancelled = false;
    getLastVisit(organizationId, patient.id).then((visit) => { if (!cancelled) setLastVisit(visit); }).catch(() => undefined);
    QRCode.toDataURL(patient.switchId, { margin: 1, width: 160 }).then((url) => { if (!cancelled) setQr(url); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient, organizationId]);

  const showPatient = useCallback(async (switchId: string, method: ScanMethod) => {
    const record = await findPatientBySwitchId(switchId);
    if (!record) {
      setStatus(`No patient with VitaLink ID ${switchId} in this workspace.`);
      return;
    }
    setLastVisit(null);
    setQr('');
    setPatient(record);
    setUnlinkedCard(null);
    setStatus('');
    toast.success('Patient identified', { description: `${record.firstName} ${record.lastName} · ${record.switchId}` });
    logIdentityScan(organizationId, record.id, method).then(loadScans).catch(() => undefined);
  }, [organizationId, loadScans]);

  /** Card number or QR payload → patient; an unknown card is offered for linking. */
  const identify = useCallback(async (raw: string, method: ScanMethod) => {
    const code = codeFromScan(raw);
    if (!code) return;
    setBusy(true);
    try {
      const found = await findPatientByCode(organizationId, code);
      if (found) {
        await showPatient(found.switchId, method);
      } else if (method === 'nfc') {
        setPatient(null);
        setUnlinkedCard(code);
        setStatus('');
      } else {
        setStatus(`No patient in this workspace matches "${code}".`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Lookup failed');
    } finally {
      setBusy(false);
      setCardInput('');
    }
  }, [organizationId, showPatient]);
  const identifyRef = useRef(identify);
  useEffect(() => { identifyRef.current = identify; });

  // Scanning sessions (Web NFC / camera) run only while "scanning" is on.
  useEffect(() => {
    if (!scanning) return;
    const done = (value: string) => { setScanning(false); void identifyRef.current(value, mode); };
    if (mode === 'nfc') return startNfcScan(done, setStatus);
    if (mode === 'qr' && videoRef.current) return startQrScan(videoRef.current, done, setStatus);
  }, [scanning, mode]);

  // ---- manual search ----
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<RegistryPatient[] | null>(null);
  useEffect(() => {
    const needle = query.trim();
    if (mode !== 'manual' || needle.length < 2) return;
    const timer = window.setTimeout(() => {
      queryPatients({ tenantId: organizationId, page: 1, pageSize: 8, query: needle, sortBy: 'name', sortOrder: 'asc', filters: NO_FILTERS })
        .then((result) => setMatches(result.rows))
        .catch(() => setMatches([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, mode, organizationId]);

  // ---- VitaCard linking ----
  const [linkSearch, setLinkSearch] = useState('');
  const [linkMatches, setLinkMatches] = useState<RegistryPatient[]>([]);
  useEffect(() => {
    const needle = linkSearch.trim();
    if (!unlinkedCard || needle.length < 2) return;
    const timer = window.setTimeout(() => {
      queryPatients({ tenantId: organizationId, page: 1, pageSize: 6, query: needle, sortBy: 'name', sortOrder: 'asc', filters: NO_FILTERS })
        .then((result) => setLinkMatches(result.rows))
        .catch(() => setLinkMatches([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [linkSearch, unlinkedCard, organizationId]);

  const linkCard = async (target: RegistryPatient, card: string) => {
    try {
      await setPatientCard(target.id, card);
      toast.success('VitaCard linked', { description: `${card} → ${target.firstName} ${target.lastName}` });
      setUnlinkedCard(null);
      setLinkSearch('');
      setLinkMatches([]);
      await showPatient(target.switchId, 'nfc');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not link the card');
    }
  };

  const [newCard, setNewCard] = useState('');
  const unlinkCard = async () => {
    if (!patient) return;
    try {
      await setPatientCard(patient.id, null);
      toast.success('VitaCard unlinked');
      setPatient({ ...patient, nfcCardId: undefined, nfcActive: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not unlink the card');
    }
  };
  const linkTyped = async () => {
    if (!patient || !newCard.trim()) return;
    try {
      await setPatientCard(patient.id, newCard.trim());
      toast.success('VitaCard linked');
      setPatient({ ...patient, nfcCardId: newCard.trim(), nfcActive: true });
      setNewCard('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not link the card');
    }
  };

  const switchMode = (next: ScanMethod) => {
    setMode(next);
    setScanning(false);
    setStatus('');
    setCardInput('');
    setMatches(null);
    setQuery('');
  };

  const allergies = splitList(patient?.allergies);
  const conditions = splitList(patient?.chronicConditions);
  const age = patient ? ageFrom(patient.dateOfBirth) : null;
  const insurance = patient ? insuranceState(patient) : null;

  return (
    <div className="space-y-6 page-transition">
      <PatientOnboardingWizard
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        tenantId={organizationId}
        creatorName={userName}
        canCreate={canCreate('Patients')}
      />
      <LiveBookAppointmentDialog key={patient?.id ?? 'none'} open={bookOpen} onClose={() => setBookOpen(false)} initialPatient={patient} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 truncate">Digital Health Identity</h1>
          <p className="text-sm text-gray-500 mt-1 truncate">Identify patients by VitaCard, QR code or search</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium shrink-0', isOnline ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
            {isOnline ? <Wifi className="w-4 h-4 shrink-0" /> : <WifiOff className="w-4 h-4 shrink-0" />}
            <span className="truncate">{isOnline ? 'Online' : 'Offline: lookups need a connection'}</span>
          </div>
          {canCreate('Patients') && (
            <Button data-tour-id="identity-register" onClick={() => setShowOnboarding(true)} className="bg-gradient-to-r from-royal-500 to-royal-700 text-white min-w-0">
              <Plus className="w-4 h-4 mr-2 shrink-0" />
              <span className="truncate">Register New Patient</span>
            </Button>
          )}
        </div>
      </div>

      <div data-tour-id="identity-modes" className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-xl min-w-0 dark:bg-slate-800">
        {[
          { id: 'nfc' as const, label: 'VitaCard (NFC)', icon: Nfc },
          { id: 'qr' as const, label: 'QR Code', icon: QrCode },
          { id: 'manual' as const, label: 'Search', icon: Search },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => switchMode(item.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-w-0',
              mode === item.id ? 'bg-white text-royal-600 shadow-sm dark:bg-slate-900' : 'text-gray-500 hover:text-gray-700 dark:text-slate-400')}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6 min-w-0">
          {mode !== 'manual' && (
            <div className="premium-card p-6 sm:p-8 min-w-0 overflow-hidden">
              <div className="text-center mb-5">
                <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4', mode === 'nfc' ? 'bg-royal-100' : 'bg-purple-100')}>
                  {mode === 'nfc' ? <Nfc className="w-8 h-8 text-royal-600" /> : <QrCode className="w-8 h-8 text-purple-600" />}
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-50">{mode === 'nfc' ? 'Tap VitaCard' : 'Scan QR Code'}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {mode === 'nfc'
                    ? nfcSupported() ? 'Start scanning, then hold the card to this device. A USB card reader works in the box below.' : 'This browser cannot read NFC directly. Use a USB card reader (tap with the box below focused) or type the card number.'
                    : qrSupported() ? 'Open the camera and point it at the QR code on the patient\'s VitaLink ID card.' : 'This browser cannot scan with the camera. Type the VitaLink ID printed under the QR code.'}
                </p>
              </div>

              {mode === 'qr' && qrSupported() && (
                <video ref={videoRef} className={cn('w-full max-w-xs mx-auto mb-4 rounded-2xl bg-black aspect-square object-cover', !scanning && 'hidden')} muted playsInline />
              )}
              {((mode === 'nfc' && nfcSupported()) || (mode === 'qr' && qrSupported())) && (
                <Button
                  onClick={() => setScanning((value) => !value)}
                  className={cn('w-full text-white py-6 mb-4', mode === 'nfc' ? 'bg-gradient-to-r from-royal-500 to-royal-700' : 'bg-gradient-to-r from-purple-500 to-purple-700')}
                >
                  {mode === 'nfc' ? <Nfc className="w-5 h-5 mr-2" /> : <Smartphone className="w-5 h-5 mr-2" />}
                  {scanning ? 'Stop scanning' : mode === 'nfc' ? 'Start NFC scan' : 'Open camera'}
                </Button>
              )}

              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void identify(cardInput, mode); }}>
                <Input
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)}
                  placeholder={mode === 'nfc' ? 'Card number (or tap with a USB reader)' : 'VitaLink ID, e.g. VL-2026-000123'}
                  autoComplete="off"
                />
                <Button type="submit" disabled={busy || !cardInput.trim()}>{busy ? 'Finding...' : 'Find'}</Button>
              </form>
              {status && <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{status}</p>}
            </div>
          )}

          {mode === 'manual' && (
            <div className="premium-card p-6 sm:p-8 min-w-0 overflow-hidden">
              <div className="text-center mb-5">
                <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-50">Search</h2>
                <p className="text-sm text-gray-500 mt-1">By VitaLink ID, name or phone number</p>
              </div>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input placeholder="Type at least 2 characters..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-12 py-6 text-base rounded-xl" autoFocus />
              </div>
              <div className="mt-3 space-y-1">
                {query.trim().length >= 2 && matches?.length === 0 && <p className="text-sm text-slate-500">No matching patients.</p>}
                {matches?.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => void showPatient(match.switchId, 'manual')}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-900 dark:text-slate-50">{match.firstName} {match.lastName}</span>
                    <span className="shrink-0 text-xs text-slate-500">{match.switchId}{match.phone ? ` · ${match.phone}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="premium-card p-6 min-w-0 overflow-hidden">
            <h3 className="font-semibold text-gray-900 dark:text-slate-50 mb-4">Recent Scans</h3>
            <div className="space-y-3">
              {scans === null && <p className="text-sm text-slate-500">Loading...</p>}
              {scans?.length === 0 && <p className="text-sm text-slate-500">No patients identified yet in this workspace.</p>}
              {scans?.map((scan) => (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => void showPatient(scan.switchId, scan.method)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left min-w-0 dark:bg-slate-900/50 dark:hover:bg-slate-800"
                >
                  <div className="w-10 h-10 rounded-lg bg-royal-100 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-royal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-slate-50 truncate">{scan.patientName}</p>
                    <p className="text-xs text-gray-500 truncate">{scan.switchId}{scan.scannedBy ? ` · by ${scan.scannedBy}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">{timeAgo(scan.at)}</p>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full uppercase',
                      scan.method === 'nfc' ? 'bg-blue-100 text-blue-600' : scan.method === 'qr' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-700')}>
                      {scan.method === 'manual' ? 'search' : scan.method}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {unlinkedCard ? (
            <div className="premium-card p-6 space-y-4 min-w-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center"><CreditCard className="w-6 h-6 text-amber-600" /></div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-slate-50">Unregistered VitaCard</h3>
                  <p className="text-xs text-gray-500 truncate">Card {unlinkedCard} isn't linked to anyone in this workspace.</p>
                </div>
              </div>
              {!fullProfile ? (
                <div className="rounded-xl bg-royal-50 p-4 text-sm text-royal-900 dark:bg-royal-500/10 dark:text-royal-100">
                  <p>Setting up VitaCards for patients is on Starter and above. Your workspace can still order cards and find patients by QR code or search.</p>
                  <Button size="sm" className="mt-3" onClick={upgrade}><ArrowUpRight className="mr-1 h-4 w-4" />See plans</Button>
                </div>
              ) : canLink ? (
                <>
                  <Input value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} placeholder="Find the patient to link it to..." autoFocus />
                  <div className="space-y-1">
                    {linkMatches.map((match) => (
                      <button key={match.id} type="button" onClick={() => void linkCard(match, unlinkedCard)}
                        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-800">
                        <span className="truncate">{match.firstName} {match.lastName}</span>
                        <span className="text-xs text-slate-500 shrink-0">{match.switchId}{match.nfcCardId ? ' · has a card' : ''}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">New patient? Register them first, then tap the card again.</p>
                </>
              ) : (
                <p className="text-sm text-slate-600">Ask a clinician or admin to link this card.</p>
              )}
            </div>
          ) : patient && insurance ? (
            <div className="premium-card overflow-hidden min-w-0">
              <div className="p-6 bg-gradient-to-br from-royal-500 to-royal-700 text-white min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt="" className="w-20 h-20 rounded-2xl object-cover border border-white/30 shrink-0" />
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center border border-white/30 shrink-0">
                        <User className="w-10 h-10 text-white" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="text-2xl font-bold truncate">{patient.firstName} {patient.lastName}</h2>
                      <p className="text-white/80 truncate">{patient.switchId}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs">{capitalize(patient.gender)}{age !== null ? `, ${age} years` : ''}</span>
                        <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs flex items-center gap-1">
                          <Nfc className="w-3 h-3" />{patient.nfcCardId ? `VitaCard ${patient.nfcCardId}` : 'No VitaCard'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {fullProfile && <div className={cn('px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 shrink-0',
                    insurance.tone === 'ok' ? 'bg-green-500/30 text-green-100' : insurance.tone === 'bad' ? 'bg-red-500/30 text-red-100' : 'bg-white/20 text-white/90')}>
                    <Shield className="w-3 h-3" />{insurance.label}
                  </div>}
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center min-w-0">
                    <Droplets className="w-6 h-6 text-red-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-red-700 truncate">{patient.bloodGroup || '—'}{patient.genotype ? ` · ${patient.genotype}` : ''}</p>
                    <p className="text-xs text-red-600">Blood group{patient.genotype ? ' · genotype' : ''}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-center min-w-0">
                    <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-amber-700">{allergies.length}</p>
                    <p className="text-xs text-amber-600">Allergies</p>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-center min-w-0">
                    <FileText className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-blue-700">{conditions.length}</p>
                    <p className="text-xs text-blue-600">Conditions</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-50 mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Allergies</h3>
                  <div className="flex flex-wrap gap-2">
                    {allergies.length === 0 && <span className="text-sm text-slate-500">None recorded</span>}
                    {allergies.map((item) => <span key={item} className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-sm font-medium">{item}</span>)}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-50 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" />Medical conditions</h3>
                  <div className="flex flex-wrap gap-2">
                    {conditions.length === 0 && <span className="text-sm text-slate-500">None recorded</span>}
                    {conditions.map((item) => <span key={item} className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm">{item}</span>)}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fullProfile && <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-slate-900/50 min-w-0">
                    <Clock className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Last visit</p>
                      <p className="font-medium text-gray-900 dark:text-slate-50 truncate">
                        {lastVisit ? `${new Date(lastVisit.at).toLocaleDateString()} · ${lastVisit.type}` : 'No visits yet'}
                      </p>
                    </div>
                  </div>}
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-slate-900/50 min-w-0">
                    <User className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Emergency contact</p>
                      <p className="font-medium text-gray-900 dark:text-slate-50 truncate">
                        {patient.emergencyContactName ? `${patient.emergencyContactName}${patient.emergencyPhone ? ` · ${patient.emergencyPhone}` : ''}` : 'Not recorded'}
                      </p>
                    </div>
                  </div>
                </div>

                {!fullProfile && (
                  <div className="flex flex-col gap-3 rounded-xl bg-royal-50 p-4 text-sm text-royal-900 sm:flex-row sm:items-center sm:justify-between dark:bg-royal-500/10 dark:text-royal-100">
                    <p>This is the basic profile on the Free plan. Upgrade for the full record on scan: visits, insurance, VitaCard setup, ID card printing and the EMR.</p>
                    <Button size="sm" className="shrink-0" onClick={upgrade}><ArrowUpRight className="mr-1 h-4 w-4" />Upgrade</Button>
                  </div>
                )}

                {fullProfile && <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
                  {qr && <img src={qr} alt={`QR code for ${patient.switchId}`} className="w-24 h-24 rounded-lg bg-white p-1 shrink-0" />}
                  <div className="min-w-0 space-y-2">
                    <p className="text-xs text-slate-500">The QR holds only the VitaLink ID. Scanning it opens this profile.</p>
                    <Button size="sm" variant="outline" onClick={() => void printIdCard(patient, organization.name)}><Printer className="w-4 h-4 mr-2" />Print ID card</Button>
                  </div>
                </div>}

                {canLink && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-50 flex items-center gap-2"><Nfc className="w-4 h-4 text-royal-600" />VitaCard</h3>
                    {patient.nfcCardId ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-slate-900/50">
                        <span className="truncate">Linked: {patient.nfcCardId}</span>
                        <Button size="sm" variant="ghost" onClick={() => void unlinkCard()}><Unlink className="w-4 h-4 mr-1" />Unlink</Button>
                      </div>
                    ) : (
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void linkTyped(); }}>
                        <Input value={newCard} onChange={(e) => setNewCard(e.target.value)} placeholder="Card number (or tap with a USB reader)" autoComplete="off" />
                        <Button type="submit" variant="outline" disabled={!newCard.trim()}><Link2 className="w-4 h-4 mr-1" />Link</Button>
                      </form>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {fullProfile ? (
                    <Button
                      className="bg-gradient-to-r from-royal-500 to-royal-700 text-white py-5 min-w-0"
                      onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { switchId: patient.switchId } }))}
                    >
                      <FileText className="w-4 h-4 mr-2" />View Full Record
                    </Button>
                  ) : (
                    <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white py-5 min-w-0" onClick={upgrade}>
                      <ArrowUpRight className="w-4 h-4 mr-2" />Unlock full record
                    </Button>
                  )}
                  <Button variant="outline" className="border-royal-200 text-royal-600 hover:bg-royal-50 py-5 min-w-0" onClick={() => setBookOpen(true)}>
                    <CalendarDays className="w-4 h-4 mr-2" />Book Appointment
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="premium-card p-12 text-center min-w-0 overflow-hidden">
              <div className="w-24 h-24 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-6 dark:bg-slate-800">
                <Nfc className="w-12 h-12 text-gray-300" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-50 mb-2">No patient identified</h3>
              <p className="text-gray-500 max-w-sm mx-auto">Tap a VitaCard, scan a QR code, or search to bring up a patient's identity.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
