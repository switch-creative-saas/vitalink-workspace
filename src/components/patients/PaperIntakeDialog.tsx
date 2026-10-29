// Register patients from paper: photograph patient cards, registration forms or a page of the
// register book, check what VitaMind read, and add them to the registry in one go.
// Starter plan and up (vitamind-assist checks the plan and role again).
import { useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ImagePlus, Loader2, ScanText, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPatient, type RegistryPatient } from '@/lib/patientRegistry';
import { AssistError, extractPatients, preparePhoto, type ExtractedPatient } from '@/lib/supabase/assist';

const MAX_PHOTOS = 4;

interface Row {
  key: string;
  include: boolean;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  dobEstimated: boolean;
  gender: '' | 'male' | 'female';
  phone: string;
  address: string;
  state: string;
  bloodGroup: string;
  genotype: string;
  allergies: string;
  chronicConditions: string;
  currentMedications: string;
  occupation: string;
  maritalStatus: string;
  email: string;
  emergencyContactName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  hospitalNumber: string;
  confidence: ExtractedPatient['confidence'];
  unclear: string[];
  result?: { ok: true; switchId: string } | { ok: false; message: string };
}

const clean = (value: string | null | undefined) => (value ?? '').trim();

function toRow(p: ExtractedPatient, index: number): Row {
  const validDob = /^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth ?? '') && !Number.isNaN(Date.parse(p.date_of_birth as string));
  const age = p.age_years != null && p.age_years >= 0 && p.age_years < 125 ? Math.floor(p.age_years) : null;
  const gender = clean(p.gender).toLowerCase();
  return {
    key: `${index}-${p.first_name}-${p.last_name}`,
    include: true,
    firstName: clean(p.first_name),
    middleName: clean(p.middle_name),
    lastName: clean(p.last_name),
    // Only an age on the card: 1 January of the birth year, marked as estimated.
    dateOfBirth: validDob ? (p.date_of_birth as string) : age != null ? `${new Date().getFullYear() - age}-01-01` : '',
    dobEstimated: !validDob && age != null,
    gender: gender.startsWith('f') ? 'female' : gender.startsWith('m') ? 'male' : '',
    phone: clean(p.phone),
    address: clean(p.address),
    state: clean(p.state),
    bloodGroup: clean(p.blood_group),
    genotype: clean(p.genotype),
    allergies: clean(p.allergies),
    chronicConditions: clean(p.chronic_conditions),
    currentMedications: clean(p.current_medications),
    occupation: clean(p.occupation),
    maritalStatus: clean(p.marital_status),
    email: clean(p.email),
    emergencyContactName: clean(p.emergency_contact_name),
    emergencyRelationship: clean(p.emergency_relationship),
    emergencyPhone: clean(p.emergency_phone),
    insuranceProvider: clean(p.insurance_provider),
    insurancePolicyNumber: clean(p.insurance_policy_number),
    hospitalNumber: clean(p.hospital_number),
    confidence: p.confidence,
    unclear: p.unclear_fields ?? [],
  };
}

const missing = (row: Row) => [
  !row.firstName && 'first name', !row.lastName && 'last name', !row.dateOfBirth && 'date of birth', !row.gender && 'sex',
].filter(Boolean) as string[];

// Model field names → the row fields they describe, to highlight what was hard to read.
const UNCLEAR_MAP: Record<string, keyof Row> = {
  first_name: 'firstName', last_name: 'lastName', middle_name: 'middleName', date_of_birth: 'dateOfBirth', age_years: 'dateOfBirth',
  gender: 'gender', phone: 'phone', address: 'address',
};

export function PaperIntakeDialog({ open, onOpenChange, tenantId, creatorName, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  creatorName: string;
  onCreated: () => void;
}) {
  const [photos, setPhotos] = useState<Array<{ name: string; mediaType: string; data: string; preview: string }>>([]);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const reset = () => { setPhotos([]); setRows(null); setNote(''); setReading(false); setSaving(false); };
  const close = (next: boolean) => {
    if (!next && saving) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) toast.info(`Up to ${MAX_PHOTOS} photos at a time. Scan the rest next.`);
    const prepared: typeof photos = [];
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      try {
        prepared.push({ name: file.name, ...(await preparePhoto(file)) });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not read that photo');
      }
    }
    setPhotos((list) => [...list, ...prepared]);
  };

  const read = async () => {
    setReading(true);
    try {
      const result = await extractPatients(tenantId, photos.map(({ mediaType, data }) => ({ mediaType, data })));
      setRows(result.patients.map(toRow));
      setNote(result.notes);
      if (!result.patients.length) toast.info('No patients found on these photos. Try a sharper, well-lit photo of the whole page.');
    } catch (error) {
      if (error instanceof AssistError && error.code === 'upgrade_required') {
        toast.info(error.message);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }));
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not read the photos');
      }
    } finally {
      setReading(false);
    }
  };

  const update = (key: string, patch: Partial<Row>) => setRows((list) => list?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? null);

  const chosen = (rows ?? []).filter((row) => row.include && !row.result?.ok);
  const blocked = chosen.filter((row) => missing(row).length > 0);

  const register = async () => {
    if (!rows || !chosen.length || blocked.length) return;
    setSaving(true);
    let created = 0;
    for (const row of chosen) {
      try {
        const saved: RegistryPatient = await createPatient(creatorName, {
          tenantId,
          firstName: row.firstName,
          middleName: row.middleName || undefined,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
          gender: row.gender as 'male' | 'female',
          phone: row.phone,
          email: row.email || undefined,
          address: row.address,
          state: row.state,
          country: 'Nigeria',
          maritalStatus: row.maritalStatus || undefined,
          occupation: row.occupation || undefined,
          bloodGroup: row.bloodGroup || undefined,
          genotype: row.genotype || undefined,
          allergies: row.allergies || undefined,
          chronicConditions: row.chronicConditions || undefined,
          currentMedications: row.currentMedications || undefined,
          emergencyContactName: row.emergencyContactName,
          emergencyRelationship: row.emergencyRelationship,
          emergencyPhone: row.emergencyPhone,
          insuranceProvider: row.insuranceProvider || undefined,
          insurancePolicyNumber: row.insurancePolicyNumber || undefined,
          nfcActive: false,
          status: 'active',
          tags: [],
          documents: [],
          timeline: [],
        });
        created += 1;
        update(row.key, { result: { ok: true, switchId: saved.switchId } });
      } catch (error) {
        update(row.key, { result: { ok: false, message: error instanceof Error ? error.message : 'Could not register' } });
      }
    }
    setSaving(false);
    if (created) {
      toast.success(`${created} patient${created === 1 ? '' : 's'} registered from paper`);
      onCreated();
    }
  };

  const allDone = Boolean(rows?.length) && rows!.filter((row) => row.include).every((row) => row.result?.ok);
  const field = (row: Row, name: keyof Row, placeholder: string, className = '') => (
    <Input
      value={String(row[name] ?? '')}
      placeholder={placeholder}
      disabled={row.result?.ok}
      onChange={(e) => update(row.key, { [name]: e.target.value } as Partial<Row>)}
      className={cn('h-9 min-w-0 text-sm', row.unclear.some((u) => UNCLEAR_MAP[u] === name) && 'border-amber-400 bg-amber-50/60 dark:bg-amber-500/10', className)}
    />
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanText className="h-5 w-5" />Register patients from paper</DialogTitle>
          <DialogDescription>
            Photograph patient cards, registration forms or a page of your register book. VitaMind reads them; you check every patient before they are added.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((photo, index) => (
                <div key={`${photo.name}-${index}`} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700">
                  <img src={photo.preview} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((list) => list.filter((_, i) => i !== index))} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <div className="flex aspect-[3/4] flex-col items-stretch justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-3 dark:border-slate-700">
                  <Button type="button" variant="outline" className="gap-2" onClick={() => cameraInput.current?.click()}><Camera className="h-4 w-4" />Take photo</Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" />Upload</Button>
                </div>
              )}
            </div>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <li>• Lay the page flat in good light and fill the frame; one page per photo.</li>
              <li>• Handwriting works. Anything hard to read is highlighted for you to check.</li>
              <li>• Photos are only used to read the records and are not stored.</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            {note && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{note}</p>}
            {rows.length === 0 && <p className="text-sm text-slate-500">No patients were found. Go back and try clearer photos.</p>}
            {rows.map((row) => {
              const gaps = missing(row);
              return (
                <div key={row.key} className={cn('rounded-xl border p-3', row.result?.ok ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : row.include ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 opacity-60 dark:border-slate-800')}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                      <input type="checkbox" checked={row.include} disabled={row.result?.ok || saving} onChange={(e) => update(row.key, { include: e.target.checked })} />
                      {row.firstName || row.lastName ? `${row.firstName} ${row.lastName}` : 'Unnamed patient'}
                    </label>
                    {row.hospitalNumber && <span className="text-xs text-slate-500">Old no. {row.hospitalNumber}</span>}
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', row.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : row.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>{row.confidence} confidence</span>
                    {row.result?.ok && <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Registered · {row.result.switchId}</span>}
                    {row.result && !row.result.ok && <span className="text-xs text-red-600">{row.result.message}</span>}
                    {!row.result?.ok && row.include && gaps.length > 0 && <span className="text-xs text-red-600">Needs {gaps.join(', ')}</span>}
                    {!row.result?.ok && <button type="button" aria-label="Remove" disabled={saving} onClick={() => setRows((list) => list?.filter((item) => item.key !== row.key) ?? null)} className="ml-auto text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    {field(row, 'firstName', 'First name')}
                    {field(row, 'lastName', 'Last name')}
                    <div className="min-w-0">
                      {field(row, 'dateOfBirth', 'YYYY-MM-DD')}
                      {row.dobEstimated && <p className="mt-0.5 text-[10px] text-amber-700">Estimated from age</p>}
                    </div>
                    <select value={row.gender} disabled={row.result?.ok} onChange={(e) => update(row.key, { gender: e.target.value as Row['gender'] })}
                      className={cn('h-9 rounded-md border border-input bg-white px-2 text-sm dark:bg-slate-900', row.unclear.includes('gender') && 'border-amber-400')}>
                      <option value="">Sex</option><option value="female">Female</option><option value="male">Male</option>
                    </select>
                    {field(row, 'phone', 'Phone')}
                    {field(row, 'address', 'Address')}
                    {field(row, 'genotype', 'Genotype')}
                    {field(row, 'bloodGroup', 'Blood group')}
                    {field(row, 'allergies', 'Allergies', 'md:col-span-2')}
                    {field(row, 'chronicConditions', 'Chronic conditions', 'md:col-span-2')}
                    {field(row, 'emergencyContactName', 'Next of kin')}
                    {field(row, 'emergencyPhone', 'Next of kin phone')}
                    {field(row, 'insuranceProvider', 'HMO / insurer')}
                    {field(row, 'insurancePolicyNumber', 'Policy number')}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2">
          {rows === null ? (
            <>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button className="gap-2 bg-royal-700 text-white hover:bg-royal-800" disabled={!photos.length || reading} onClick={() => void read()}>
                {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}{reading ? 'Reading…' : `Read ${photos.length || ''} photo${photos.length === 1 ? '' : 's'}`}
              </Button>
            </>
          ) : allDone ? (
            <>
              <Button variant="outline" onClick={reset}>Scan more</Button>
              <Button onClick={() => close(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={() => { setRows(null); setNote(''); }}>Back to photos</Button>
              <Button className="gap-2 bg-royal-700 text-white hover:bg-royal-800" disabled={!chosen.length || blocked.length > 0 || saving} onClick={() => void register()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {blocked.length ? `Complete ${blocked.length} patient${blocked.length === 1 ? '' : 's'} first` : `Register ${chosen.length} patient${chosen.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
