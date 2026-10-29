// Dashboard quick actions for a live (Supabase) workspace: they search the real
// patient registry and write through the same services as the full modules.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CalendarPlus, FlaskConical, Nfc, Pill, QrCode, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { appointmentTypes, useAppointments, type AppointmentRecord, type AppointmentType } from '@/contexts/AppointmentContext';
import { queryPatients, type RegistryPatient } from '@/lib/patientRegistry';
import { createLabOrder, type LabOrderPriority, type LabSampleType } from '@/lib/supabase/lab';
import { dispensePrescription, listInventory, listPatientPrescriptions, type PrescriptionItem, type StockItem } from '@/lib/supabase/pharmacy';
import { findPatientByCode } from '@/lib/supabase/dashboard';
import { allergyConflicts } from '@/lib/allergyCheck';
import { codeFromScan, nfcSupported as hasNfc, qrSupported as hasQr, startNfcScan, startQrScan } from '@/lib/scanners';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const selectClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50';
const labelClass = 'text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block';
const today = () => new Date().toLocaleDateString('en-CA');

const NO_FILTERS = {
  gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '',
  admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '',
};

/** Registry search; shows the chosen patient as a chip that can be cleared. */
export function PatientSearch({ value, onChange, autoFocus }: { value: RegistryPatient | null; onChange: (patient: RegistryPatient | null) => void; autoFocus?: boolean }) {
  const { organization } = useAuth();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<RegistryPatient[]>([]);
  const [searched, setSearched] = useState('');

  useEffect(() => {
    const needle = query.trim();
    if (value || needle.length < 2) return;
    const timer = window.setTimeout(() => {
      queryPatients({ tenantId: organization.id, page: 1, pageSize: 6, query: needle, sortBy: 'name', sortOrder: 'asc', filters: NO_FILTERS })
        .then((result) => { setMatches(result.rows); setSearched(needle); })
        .catch(() => { setMatches([]); setSearched(needle); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, value, organization.id]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#1E4ED8]/30 bg-[#1E4ED8]/5 px-3 py-2 text-sm">
        <span className="min-w-0 truncate text-slate-900 dark:text-slate-50">
          {value.firstName} {value.lastName} <span className="text-xs text-slate-500">{value.switchId}</span>
        </span>
        <button type="button" aria-label="Change patient" onClick={() => { onChange(null); setQuery(''); setMatches([]); }} className="text-slate-500 hover:text-slate-900">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  const needle = query.trim();
  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search by name, VitaLink ID or phone..." className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={autoFocus} />
      </div>
      {needle.length >= 2 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900/50">
          {matches.map((patient) => (
            <button key={patient.id} type="button" onClick={() => onChange(patient)} className="w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-[#1E4ED8]/5 dark:text-slate-200 dark:hover:bg-slate-800/60">
              {patient.firstName} {patient.lastName} <span className="text-xs text-slate-500">{patient.switchId}</span>
            </button>
          ))}
          {matches.length === 0 && searched === needle && <p className="px-3 py-2 text-xs text-slate-500">No matching patients.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Half-hour slots inside the clinician's working hours, skipping breaks and taken times. */
function slotsFor(doctor: { workingHours: [string, string]; breaks: string[] } | undefined, taken: string[]) {
  if (!doctor) return [];
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const [start, end] = doctor.workingHours.map(toMinutes);
  const slots: string[] = [];
  for (let minute = start; minute + 30 <= end; minute += 30) {
    const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!doctor.breaks.includes(label) && !taken.includes(label)) slots.push(label);
  }
  return slots;
}

/** Key the dialog by the preselected patient so it starts fresh for each one. */
export function LiveBookAppointmentDialog({ open, onClose, initialPatient }: { open: boolean; onClose: () => void; initialPatient?: RegistryPatient | null }) {
  const { doctors, appointments, bookAppointment } = useAppointments();
  const [patient, setPatient] = useState<RegistryPatient | null>(initialPatient ?? null);
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [type, setType] = useState<AppointmentType>('Consultation');
  const [priority, setPriority] = useState<AppointmentRecord['priority']>('routine');
  const [reason, setReason] = useState('');

  const doctor = doctors.find((item) => item.id === doctorId);
  const taken = useMemo(
    () => appointments.filter((item) => item.doctorId === doctorId && item.date === date && !['cancelled', 'rescheduled', 'no-show'].includes(item.status)).map((item) => item.time),
    [appointments, doctorId, date],
  );
  const slots = slotsFor(doctor, taken);
  const chosenTime = slots.includes(time) ? time : '';

  const reset = () => { setPatient(initialPatient ?? null); setDoctorId(''); setDate(today()); setTime(''); setType('Consultation'); setPriority('routine'); setReason(''); };
  const close = () => { reset(); onClose(); };

  const book = () => {
    if (!patient || !doctor || !chosenTime) {
      toast.error('Choose a patient, clinician and time.');
      return;
    }
    bookAppointment({
      patientSwitchId: patient.switchId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      doctorId: doctor.id,
      department: doctor.department,
      date,
      time: chosenTime,
      type,
      priority,
      visitReason: reason.trim(),
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-50 flex items-center gap-2"><CalendarPlus className="w-5 h-5" />Book Appointment</DialogTitle>
          <DialogDescription>Times come from the clinician's schedule; booked slots are hidden.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className={labelClass}>Patient *</label>
            <PatientSearch value={patient} onChange={setPatient} autoFocus />
          </div>
          <div>
            <label className={labelClass}>Clinician *</label>
            <select className={selectClass} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(''); }}>
              <option value="">{doctors.length ? 'Select clinician' : 'No clinicians accept appointments yet'}</option>
              {doctors.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.department}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Date *</label>
              <Input type="date" min={today()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
            </div>
            <div>
              <label className={labelClass}>Time *</label>
              <select className={selectClass} value={chosenTime} onChange={(e) => setTime(e.target.value)} disabled={!doctor}>
                <option value="">{!doctor ? 'Pick a clinician' : slots.length ? 'Select time' : 'Fully booked'}</option>
                {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Type</label>
              <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as AppointmentType)}>
                {appointmentTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as AppointmentRecord['priority'])}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">Stat</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Reason for visit</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white" onClick={book} disabled={!patient || !doctor || !chosenTime}>
              <CalendarCheck className="w-4 h-4 mr-2" />Book Appointment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

const COMMON_TESTS = ['Full blood count', 'Malaria parasite', 'Lipid Panel', 'HbA1c', 'Fasting blood sugar', 'Urinalysis', 'Liver function', 'Kidney function', 'Thyroid function'];

/** Key the dialog by the preselected patient so it starts fresh for each one. */
export function LiveOrderLabDialog({ open, onClose, initialPatient }: { open: boolean; onClose: () => void; initialPatient?: RegistryPatient | null }) {
  const [patient, setPatient] = useState<RegistryPatient | null>(initialPatient ?? null);
  const [tests, setTests] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [priority, setPriority] = useState<LabOrderPriority>('routine');
  const [sample, setSample] = useState<LabSampleType>('blood');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => { setPatient(initialPatient ?? null); setTests([]); setCustom(''); setPriority('routine'); setSample('blood'); setNotes(''); onClose(); };
  const all = [...tests, ...custom.split(',').map((item) => item.trim()).filter(Boolean)];

  const order = async () => {
    if (!patient || all.length === 0) {
      toast.error('Choose a patient and at least one test.');
      return;
    }
    setSaving(true);
    try {
      await createLabOrder(patient.id, all.map((name) => ({ name })), { priority, sampleType: sample, notes });
      toast.success('Lab order created', { description: `${all.join(', ')} for ${patient.firstName} ${patient.lastName}. It is now in the Laboratory queue.` });
      close();
    } catch (error) {
      toast.error(errorText(error, 'Could not create the lab order'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-50 flex items-center gap-2"><FlaskConical className="w-5 h-5" />Order Lab Test</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className={labelClass}>Patient *</label>
            <PatientSearch value={patient} onChange={setPatient} autoFocus />
          </div>
          <div>
            <label className={labelClass}>Tests *</label>
            <div className="flex flex-wrap gap-2">
              {COMMON_TESTS.map((test) => (
                <button
                  key={test}
                  type="button"
                  onClick={() => setTests((prev) => (prev.includes(test) ? prev.filter((item) => item !== test) : [...prev, test]))}
                  className={cn('rounded-full border px-3 py-1 text-xs', tests.includes(test) ? 'border-[#1E4ED8] bg-[#1E4ED8]/10 text-[#1E4ED8]' : 'border-gray-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}
                >
                  {test}
                </button>
              ))}
            </div>
            <Input className="mt-2" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other tests, separated by commas" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Priority</label>
              <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as LabOrderPriority)}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">STAT</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Sample</label>
              <select className={selectClass} value={sample} onChange={(e) => setSample(e.target.value as LabSampleType)}>
                <option value="blood">Blood</option>
                <option value="urine">Urine</option>
                <option value="imaging">Imaging</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. fasting sample" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white" onClick={() => void order()} disabled={saving || !patient || all.length === 0}>
              <FlaskConical className="w-4 h-4 mr-2" />{saving ? 'Ordering...' : 'Order Test'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function LiveDispenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { organization } = useAuth();
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[] | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [rxId, setRxId] = useState('');
  const [stockId, setStockId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [allergyChecked, setAllergyChecked] = useState(false);

  useEffect(() => {
    if (!open || !patient) return;
    let cancelled = false;
    Promise.all([listPatientPrescriptions(organization.id, patient.id), listInventory(organization.id)])
      .then(([rx, items]) => {
        if (cancelled) return;
        setPrescriptions(rx.filter((item) => item.status === 'active'));
        setStock(items.filter((item) => item.isActive && item.stock > 0 && (!item.expiryDate || item.expiryDate >= today())));
      })
      .catch((error) => { if (!cancelled) { toast.error(errorText(error, 'Could not load prescriptions')); setPrescriptions([]); } });
    return () => { cancelled = true; };
  }, [open, patient, organization.id]);

  const rx = prescriptions?.find((item) => item.id === rxId);
  const firstWord = rx?.drugName.toLowerCase().split(/\s+/)[0] ?? '';
  const batches = useMemo(
    () => [...stock].sort((a, b) => Number(b.name.toLowerCase().includes(firstWord)) - Number(a.name.toLowerCase().includes(firstWord)) || a.expiryDate.localeCompare(b.expiryDate)),
    [stock, firstWord],
  );
  const batch = stock.find((item) => item.id === stockId);
  const conflicts = rx ? allergyConflicts(patient?.allergies, `${rx.drugName} ${batch?.name ?? ''} ${batch?.genericName ?? ''}`) : [];

  const choosePrescription = (id: string) => {
    setRxId(id);
    setAllergyChecked(false);
    const next = prescriptions?.find((item) => item.id === id);
    const word = next?.drugName.toLowerCase().split(/\s+/)[0] ?? '';
    const match = stock.filter((item) => word && item.name.toLowerCase().includes(word)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
    setStockId(match?.id ?? '');
    setQuantity(next?.quantity ?? 1);
  };

  const close = () => { setPatient(null); setPrescriptions(null); setStock([]); setRxId(''); setStockId(''); setQuantity(1); setAllergyChecked(false); onClose(); };

  const dispense = async () => {
    if (!rx || !batch) return;
    if (conflicts.length && !allergyChecked) {
      toast.error('Confirm the allergy check before dispensing.');
      return;
    }
    if (quantity < 1 || quantity > batch.stock) {
      toast.error(`Quantity must be between 1 and ${batch.stock} for this batch.`);
      return;
    }
    setSaving(true);
    try {
      await dispensePrescription(rx.id, batch.id, quantity);
      toast.success('Medication dispensed', { description: `${quantity} × ${batch.name}${batch.batchNo ? ` (${batch.batchNo})` : ''} to ${patient?.firstName} ${patient?.lastName}. Stock updated.` });
      close();
    } catch (error) {
      toast.error(errorText(error, 'Could not dispense'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-50 flex items-center gap-2"><Pill className="w-5 h-5" />Dispense Medication</DialogTitle>
          <DialogDescription>Dispenses against an active prescription and deducts the chosen stock batch.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className={labelClass}>Patient *</label>
            <PatientSearch value={patient} onChange={(next) => { setPatient(next); setPrescriptions(null); setRxId(''); setStockId(''); }} autoFocus />
          </div>
          {patient && (
            <div>
              <label className={labelClass}>Prescription *</label>
              {prescriptions === null ? (
                <p className="text-xs text-slate-500">Loading prescriptions...</p>
              ) : prescriptions.length === 0 ? (
                <p className="text-xs text-slate-500">No active prescriptions for this patient. Prescriptions are created when a doctor signs an EMR note.</p>
              ) : (
                <select className={selectClass} value={rxId} onChange={(e) => choosePrescription(e.target.value)}>
                  <option value="">Select prescription</option>
                  {prescriptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.drugName}{item.quantity ? ` (qty ${item.quantity})` : ''} · {item.prescriberName}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {patient && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Recorded allergies: <span className="font-medium text-slate-900 dark:text-slate-50">{patient.allergies?.trim() || 'none recorded'}</span>
            </p>
          )}
          {conflicts.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-semibold">Possible allergy conflict</p>
              <p className="text-xs mt-1">This patient is recorded as allergic to {conflicts.join(', ')}. Check with the prescriber before dispensing.</p>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={allergyChecked} onChange={(e) => setAllergyChecked(e.target.checked)} />
                I have confirmed with the prescriber; dispense anyway
              </label>
            </div>
          )}
          {rx && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className={labelClass}>Stock batch *</label>
                <select className={selectClass} value={stockId} onChange={(e) => setStockId(e.target.value)}>
                  <option value="">{batches.length ? 'Select batch' : 'Nothing in stock'}</option>
                  {batches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.strength ? ` ${item.strength}` : ''} · {item.batchNo || 'no batch'} · {item.stock} left{item.stock <= item.reorderThreshold ? ' (low)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Quantity *</label>
                <Input type="number" min={1} max={batch?.stock} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white" onClick={() => void dispense()} disabled={saving || !rx || !batch || (conflicts.length > 0 && !allergyChecked)}>
              <Pill className="w-4 h-4 mr-2" />{saving ? 'Dispensing...' : 'Dispense'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** VitaCard tap / QR scan / typed ID → opens the patient's EMR. */
export function PatientLookupDialog({ open, mode, onClose }: { open: boolean; mode: 'nfc' | 'qr'; onClose: () => void }) {
  const { organization } = useAuth();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nfcSupported = hasNfc();
  const qrSupported = hasQr();

  const lookup = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const found = await findPatientByCode(organization.id, codeFromScan(trimmed));
      if (!found) {
        setStatus(`No patient in this workspace matches "${trimmed}".`);
        return;
      }
      toast.success(`Opening ${found.name}`, { description: found.switchId });
      onClose();
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { switchId: found.switchId } }));
    } catch (error) {
      setStatus(errorText(error, 'Lookup failed'));
    } finally {
      setBusy(false);
    }
  };
  const lookupRef = useRef(lookup);
  useEffect(() => { lookupRef.current = lookup; });

  // Web NFC (Chrome on Android) or the camera, where the browser supports them.
  useEffect(() => {
    if (!open) return;
    if (mode === 'nfc' && hasNfc()) return startNfcScan((value) => void lookupRef.current(value), setStatus);
    if (mode === 'qr' && hasQr() && videoRef.current) return startQrScan(videoRef.current, (value) => void lookupRef.current(value), setStatus);
  }, [open, mode]);

  const close = () => { setCode(''); setStatus(''); onClose(); };
  const supported = mode === 'nfc' ? nfcSupported : qrSupported;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-50 flex items-center gap-2">
            {mode === 'nfc' ? <Nfc className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
            {mode === 'nfc' ? 'Identify by VitaCard' : 'Scan patient QR'}
          </DialogTitle>
          <DialogDescription>
            {supported
              ? mode === 'nfc' ? 'Tap the card, or type the VitaLink ID or card number.' : 'Scan the QR code, or type the VitaLink ID or card number.'
              : `${mode === 'nfc' ? 'NFC reading' : 'QR scanning'} isn't supported in this browser. Type the VitaLink ID or card number.`}
          </DialogDescription>
        </DialogHeader>
        {mode === 'qr' && qrSupported && <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline />}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. VL-2026-000123" autoFocus={!supported} />
          <Button type="submit" disabled={busy || !code.trim()} className="bg-[#1E4ED8] text-white">{busy ? 'Finding...' : 'Find'}</Button>
        </form>
        {status && <p className="text-xs text-slate-600 dark:text-slate-400">{status}</p>}
      </DialogContent>
    </Dialog>
  );
}
