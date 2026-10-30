// Bring a hospital's existing patient list into VitaLink, whatever it looks like: a spreadsheet or
// CSV from another EMR, FHIR / HL7 exports, or a photographed register page (read on this device).
// Columns are matched automatically and can be changed; every row is checked before anything is
// saved, and cells the reader wasn't sure of are highlighted. See lib/import/patientImport.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Loader2, Lock, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPatient, type PatientTag } from '@/lib/patientRegistry';
import { isLowData } from '@/lib/network/dataSaver';
import {
  FIELD_LABELS, buildRows, detect, readImportFile, rowProblems,
  type ColumnMap, type Detected, type FieldKey, type ImportPatient, type ImportRow, type Sheet,
} from '@/lib/import/patientImport';

type Stage = 'pick' | 'reading' | 'review' | 'saving' | 'done';
type Outcome = { ok: true; switchId: string } | { ok: false; message: string; existing?: boolean };

const PAGE = 50;
const FIELD_CHOICES = (Object.keys(FIELD_LABELS) as FieldKey[]).filter((f) => f !== 'ageBand');
const ageOf = (iso: string) => (iso ? Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 31_557_600_000) : null);

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function SmartImportDialog({ open, onOpenChange, tenantId, creatorName, canScan, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  creatorName: string;
  /** Reading photographed registers: Starter plan and up. */
  canScan: boolean;
  onCreated: () => void;
}) {
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [uncertainCells, setUncertainCells] = useState<Map<string, Set<number>> | undefined>(undefined);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [showColumns, setShowColumns] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [page, setPage] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // Get the on-device reader ready (and saved for offline use) while the user picks a file.
  useEffect(() => {
    if (!open || !canScan || !navigator.onLine || isLowData()) return;
    const timer = window.setTimeout(() => { void import('@/lib/import/ocrRegister').then((m) => m.preloadReader()); }, 1500);
    return () => window.clearTimeout(timer);
  }, [open, canScan]);

  const reset = () => {
    setStage('pick'); setFileName(''); setSheets([]); setDetected(null); setUncertainCells(undefined); setRows([]);
    setProgress(0); setShowColumns(false); setOnlyProblems(false); setPage(0); setOutcomes({});
  };
  const close = (next: boolean) => {
    if (!next && stage === 'saving') return;
    if (!next) reset();
    onOpenChange(next);
  };

  const applyDetection = (d: Detected | null, uncertain?: Map<string, Set<number>>) => {
    if (!d || !d.body.length) {
      toast.error('No patients found in this file. Check it has a row per patient, then try again.');
      setStage('pick');
      return;
    }
    setDetected(d);
    setUncertainCells(uncertain);
    setRows(buildRows(d, uncertain));
    setPage(0);
    setStage('review');
  };

  const openFile = async (file: File) => {
    setFileName(file.name);
    setStage('reading');
    try {
      const found = await readImportFile(file);
      setSheets(found);
      applyDetection(detect(found));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this file');
      setStage('pick');
    }
  };

  const openPhoto = async (file: File) => {
    setFileName(file.name || 'Register photo');
    setStage('reading');
    setProgress(0);
    try {
      const { readRegisterPhoto } = await import('@/lib/import/ocrRegister');
      const scan = await readRegisterPhoto(file, setProgress);
      setSheets([]);
      applyDetection(scan.detected, scan.uncertain);
      toast.success(`Read ${scan.tables > 1 ? `${scan.tables} pages` : 'the page'}. Check the highlighted cells before registering.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this photo');
      setStage('pick');
    }
  };

  const remap = (index: number, field: FieldKey | null) => {
    if (!detected) return;
    const columns: ColumnMap[] = detected.columns.map((c) => {
      if (c.index === index) return { ...c, field, guessed: false };
      return field && c.field === field && field !== 'ageBand' ? { ...c, field: null } : c; // one column per field
    });
    const next = { ...detected, columns };
    setDetected(next);
    setRows(buildRows(next, uncertainCells));
  };

  const chooseSheet = (name: string) => {
    const sheet = sheets.find((s) => s.name === name);
    if (sheet) applyDetection(detect([sheet]));
  };

  const update = (key: string, patch: Partial<ImportPatient>) =>
    setRows((list) => list.map((row) => (row.key === key ? {
      ...row,
      patient: { ...row.patient, ...patch, ...(patch.dateOfBirth !== undefined ? { dobEstimated: false } : {}) },
      uncertain: row.uncertain.filter((f) => !(f in patch)),
    } : row)));
  const toggle = (key: string, include: boolean) => setRows((list) => list.map((row) => (row.key === key ? { ...row, include } : row)));

  const stats = useMemo(() => {
    const chosen = rows.filter((r) => r.include);
    return {
      chosen: chosen.length,
      ready: chosen.filter((r) => !rowProblems(r.patient).length).length,
      problems: chosen.filter((r) => rowProblems(r.patient).length).length,
      check: chosen.filter((r) => r.uncertain.length).length,
      estimated: chosen.filter((r) => r.patient.dobEstimated).length,
      duplicates: rows.filter((r) => r.duplicateOf).length,
    };
  }, [rows]);

  const visible = useMemo(() => (onlyProblems ? rows.filter((r) => rowProblems(r.patient).length || r.uncertain.length) : rows), [rows, onlyProblems]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);

  const register = async () => {
    const queue = rows.filter((r) => r.include && !rowProblems(r.patient).length && !outcomes[r.key]?.ok);
    if (!queue.length) return;
    setStage('saving');
    setProgress(0);
    let done = 0;
    const results: Record<string, Outcome> = { ...outcomes };
    const save = async (row: ImportRow) => {
      const p = row.patient;
      const age = ageOf(p.dateOfBirth);
      const tags: PatientTag[] = age !== null && age < 18 ? ['pediatric'] : age !== null && age >= 65 ? ['geriatric'] : [];
      try {
        const saved = await createPatient(creatorName, {
          tenantId,
          firstName: p.firstName,
          middleName: p.middleName || undefined,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth,
          dobEstimated: p.dobEstimated,
          gender: p.gender as 'male' | 'female' | 'other',
          phone: p.phone,
          email: p.email || undefined,
          address: p.address,
          state: p.state,
          country: p.country || 'Nigeria',
          maritalStatus: p.maritalStatus || undefined,
          occupation: p.occupation || undefined,
          nationalId: p.nationalId || undefined,
          bloodGroup: p.bloodGroup || undefined,
          genotype: p.genotype || undefined,
          allergies: p.allergies || undefined,
          chronicConditions: p.chronicConditions || undefined,
          currentMedications: p.currentMedications || undefined,
          emergencyContactName: p.emergencyContactName,
          emergencyRelationship: p.emergencyRelationship,
          emergencyPhone: p.emergencyPhone,
          emergencyAddress: p.emergencyAddress || undefined,
          insuranceProvider: p.insuranceProvider || undefined,
          insurancePolicyNumber: p.insurancePolicyNumber || undefined,
          insuranceType: p.insuranceType || undefined,
          insuranceExpiryDate: p.insuranceExpiryDate || undefined,
          insuranceProviderFilter: p.insuranceProvider || undefined,
          previousNumber: p.previousNumber || undefined,
          department: p.department || undefined,
          doctorAssigned: p.doctorAssigned || undefined,
          nfcActive: false,
          status: p.status,
          tags,
          documents: [],
          timeline: [],
        });
        results[row.key] = { ok: true, switchId: saved.switchId };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not register';
        results[row.key] = { ok: false, message, existing: /duplicate/i.test(message) };
      }
      done += 1;
      setProgress(done / queue.length);
    };
    // A few at a time: quick for long lists without overloading a slow connection.
    const workers = Array.from({ length: Math.min(4, queue.length) }, async (_, w) => {
      for (let i = w; i < queue.length; i += 4) await save(queue[i]);
    });
    await Promise.all(workers);
    setOutcomes(results);
    setStage('done');
    const created = Object.values(results).filter((r) => r.ok).length;
    if (created) onCreated();
  };

  const summary = useMemo(() => {
    const list = Object.values(outcomes);
    return {
      created: list.filter((r) => r.ok).length,
      existing: list.filter((r) => !r.ok && r.existing).length,
      failed: list.filter((r) => !r.ok && !r.existing).length,
    };
  }, [outcomes]);

  const downloadProblems = () => {
    const header = ['Row', 'Old number', 'First name', 'Middle name', 'Surname', 'Date of birth', 'Sex', 'Phone', 'Problem'];
    const lines = rows
      .filter((r) => r.include && (rowProblems(r.patient).length || (outcomes[r.key] && !outcomes[r.key].ok)))
      .map((r) => {
        const o = outcomes[r.key];
        const problem = o && !o.ok ? o.message : `Missing ${rowProblems(r.patient).join(', ')}`;
        const p = r.patient;
        return [String(r.line), p.previousNumber, p.firstName, p.middleName, p.lastName, p.dateOfBirth, p.gender, p.phone, problem].map(csvCell).join(',');
      });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'patients-to-fix.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const cell = (row: ImportRow, field: keyof ImportPatient, placeholder: string, className = '') => (
    <Input
      value={String(row.patient[field] ?? '')}
      placeholder={placeholder}
      disabled={outcomes[row.key]?.ok}
      onChange={(e) => update(row.key, { [field]: e.target.value } as Partial<ImportPatient>)}
      className={cn('h-8 min-w-0 px-2 text-sm', row.uncertain.includes(field) && 'border-amber-400 bg-amber-50/70 dark:bg-amber-500/10', className)}
    />
  );

  const mapped = detected?.columns.filter((c) => c.field).length ?? 0;
  const unmapped = detected?.columns.filter((c) => !c.field && c.header.trim()) ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn('max-h-[92vh] overflow-hidden flex flex-col', stage === 'review' || stage === 'done' ? 'sm:max-w-6xl' : 'sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>Import patients</DialogTitle>
          <DialogDescription>
            {stage === 'pick' && 'Bring in your existing patient list as it is. No need to rearrange columns or retype anything.'}
            {stage === 'reading' && `Reading ${fileName}…`}
            {stage === 'review' && `${fileName}${detected?.headerRow !== undefined && detected.headerRow >= 0 ? ` · headings on row ${detected.headerRow + 1}` : ''} · check the list, fix anything highlighted, then register.`}
            {stage === 'saving' && 'Registering patients. Keep this window open.'}
            {stage === 'done' && 'Finished.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => fileInput.current?.click()}
              className="rounded-2xl border-2 border-dashed border-slate-200 p-5 text-left transition hover:border-royal-400 hover:bg-royal-50/40 dark:border-slate-700 dark:hover:bg-slate-800/50">
              <FileSpreadsheet className="h-7 w-7 text-royal-600" />
              <p className="mt-3 font-semibold text-slate-900 dark:text-slate-50">Spreadsheet or EMR export</p>
              <p className="mt-1 text-xs text-slate-500">Excel (.xlsx), CSV or text from any system, FHIR JSON or HL7 messages. Any column order or headings; title rows are skipped.</p>
            </button>
            <div className={cn('rounded-2xl border-2 border-dashed border-slate-200 p-5 dark:border-slate-700', !canScan && 'opacity-70')}>
              {canScan ? <Camera className="h-7 w-7 text-royal-600" /> : <Lock className="h-7 w-7 text-slate-400" />}
              <p className="mt-3 font-semibold text-slate-900 dark:text-slate-50">Photo of a register page</p>
              <p className="mt-1 text-xs text-slate-500">
                {canScan ? 'Handwritten or printed registers, including two-page spreads. Read on this device; you check it before anything is saved.' : 'Included from the Starter plan.'}
              </p>
              {canScan && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => cameraInput.current?.click()}><Camera className="h-4 w-4" />Take photo</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => photoInput.current?.click()}><Upload className="h-4 w-4" />Upload</Button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Only an age written down? The date of birth is worked out from the visit date on that row and marked as estimated.
              Old card or hospital numbers are kept, so patients can still be found by them, and every patient gets a VitaLink ID.
            </p>
            <input ref={fileInput} type="file" className="hidden" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,.ndjson,.hl7,.xls,.ods,.numbers"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); }} />
            <input ref={photoInput} type="file" className="hidden" accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openPhoto(f); }} />
            <input ref={cameraInput} type="file" className="hidden" accept="image/*" capture="environment"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openPhoto(f); }} />
          </div>
        )}

        {stage === 'reading' && (
          <div className="grid place-items-center gap-3 py-12 text-sm text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-royal-600" />
            {progress > 0 ? `Reading the page… ${Math.round(progress * 100)}%` : 'Reading…'}
            {progress > 0 && <p className="max-w-sm text-center text-xs">The first photo takes a little longer while the reader loads. Nothing is sent anywhere.</p>}
          </div>
        )}

        {stage === 'review' && detected && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{stats.ready} ready</span>
              {stats.problems > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{stats.problems} missing details</span>}
              {stats.check > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{stats.check} to check</span>}
              {stats.estimated > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{stats.estimated} birth dates from age</span>}
              {stats.duplicates > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{stats.duplicates} repeated in file (left out)</span>}
              <span className="flex-1" />
              {sheets.length > 1 && (
                <select className="h-8 rounded-md border border-input bg-background px-2" value={detected.sheet} onChange={(e) => chooseSheet(e.target.value)} aria-label="Sheet">
                  {sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              )}
              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => { setOnlyProblems(e.target.checked); setPage(0); }} />Only rows to fix
              </label>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setShowColumns((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
                <span><span className="font-medium">Columns</span> <span className="text-slate-500">· {mapped} matched{unmapped.length ? ` · ${unmapped.length} not imported (${unmapped.slice(0, 3).map((c) => c.header).join(', ')}${unmapped.length > 3 ? '…' : ''})` : ''}</span></span>
                <ChevronDown className={cn('h-4 w-4 transition', showColumns && 'rotate-180')} />
              </button>
              {showColumns && (
                <div className="grid max-h-56 gap-2 overflow-y-auto border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">
                  {detected.columns.filter((c) => c.header.trim() || c.field).map((c) => (
                    <label key={c.index} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 truncate font-medium text-slate-700 dark:text-slate-200" title={c.header}>{c.header || `Column ${c.index + 1}`}</span>
                      <select className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5" value={c.field ?? ''}
                        onChange={(e) => remap(c.index, (e.target.value || null) as FieldKey | null)}>
                        <option value="">Don’t import</option>
                        {c.field === 'ageBand' && <option value="ageBand">{FIELD_LABELS.ageBand}</option>}
                        {FIELD_CHOICES.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                      </select>
                      {c.guessed && <span className="text-[10px] text-amber-600">guessed</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-1 py-2">Row</th>
                    <th className="px-1 py-2">Old no.</th>
                    <th className="px-1 py-2">First name</th>
                    <th className="px-1 py-2">Middle</th>
                    <th className="px-1 py-2">Surname</th>
                    <th className="px-1 py-2">Sex</th>
                    <th className="px-1 py-2">Date of birth</th>
                    <th className="px-1 py-2">Phone</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const problems = rowProblems(row.patient);
                    const outcome = outcomes[row.key];
                    return (
                      <tr key={row.key} className={cn('border-t border-slate-100 align-top dark:border-slate-800', !row.include && 'opacity-50')}>
                        <td className="px-2 py-1.5"><input type="checkbox" checked={row.include} disabled={outcome?.ok} onChange={(e) => toggle(row.key, e.target.checked)} aria-label={`Include row ${row.line}`} /></td>
                        <td className="px-1 py-2 text-xs text-slate-400">{row.line}</td>
                        <td className="w-28 px-1 py-1">{cell(row, 'previousNumber', '—')}</td>
                        <td className="px-1 py-1">{cell(row, 'firstName', 'First name', !row.patient.firstName ? 'border-red-300' : '')}</td>
                        <td className="w-28 px-1 py-1">{cell(row, 'middleName', '')}</td>
                        <td className="px-1 py-1">{cell(row, 'lastName', 'Surname', !row.patient.lastName ? 'border-red-300' : '')}</td>
                        <td className="w-24 px-1 py-1">
                          <select value={row.patient.gender} disabled={outcome?.ok} onChange={(e) => update(row.key, { gender: e.target.value as ImportPatient['gender'] })}
                            className={cn('h-8 w-full rounded-md border border-input bg-background px-1.5 text-sm', !row.patient.gender && 'border-red-300', row.uncertain.includes('gender') && 'border-amber-400 bg-amber-50/70 dark:bg-amber-500/10')}>
                            <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                          </select>
                        </td>
                        <td className="w-40 px-1 py-1">
                          <Input type="date" value={row.patient.dateOfBirth} disabled={outcome?.ok} onChange={(e) => update(row.key, { dateOfBirth: e.target.value })}
                            className={cn('h-8 px-2 text-sm', !row.patient.dateOfBirth && 'border-red-300', row.uncertain.includes('dateOfBirth') && 'border-amber-400 bg-amber-50/70 dark:bg-amber-500/10')} />
                          {row.patient.dobEstimated && <p className="mt-0.5 text-[11px] text-slate-500">Estimated from age {row.ageText}</p>}
                        </td>
                        <td className="w-32 px-1 py-1">{cell(row, 'phone', '—')}</td>
                        <td className="px-2 py-2 text-xs">
                          {outcome?.ok ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{outcome.switchId}</span>
                            : outcome && !outcome.ok ? <span className="text-red-600">{outcome.existing ? 'Already registered' : outcome.message}</span>
                            : row.duplicateOf ? <span className="text-slate-500">Same as row {row.duplicateOf}</span>
                            : problems.length ? <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Needs {problems.join(', ')}</span>
                            : row.uncertain.length ? <span className="text-amber-600">Check highlighted</span>
                            : <span className="text-emerald-600">Ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!shown.length && <p className="p-6 text-center text-sm text-slate-500">Nothing to fix.</p>}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                Page {page + 1} of {pages}
                <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        )}

        {stage === 'saving' && (
          <div className="grid place-items-center gap-3 py-12 text-sm text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-royal-600" />
            Registering… {Math.round(progress * 100)}%
            <div className="h-2 w-64 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-royal-600 transition-all" style={{ width: `${progress * 100}%` }} /></div>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 className="h-6 w-6 shrink-0" />
              <p className="text-sm"><span className="font-semibold">{summary.created} patient{summary.created === 1 ? '' : 's'} registered</span>, each with a VitaLink ID.
                {summary.existing > 0 && ` ${summary.existing} were already in your registry and were left as they are.`}
                {summary.failed > 0 && ` ${summary.failed} couldn’t be registered.`}
                {stats.problems > 0 && ` ${stats.problems} still need details.`}</p>
            </div>
            {(summary.failed > 0 || stats.problems > 0) && (
              <p className="text-sm text-slate-500">Fix the remaining rows here and register again, or download them to finish later.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={reset}>Choose another file</Button>
              {stats.problems > 0 && <Button variant="outline" className="gap-1.5" onClick={downloadProblems}><Download className="h-4 w-4" />Rows to fix</Button>}
              <Button className="bg-royal-600 text-white hover:bg-royal-700" disabled={!stats.ready} onClick={() => void register()}>
                Register {stats.ready} patient{stats.ready === 1 ? '' : 's'}
              </Button>
            </>
          )}
          {stage === 'done' && (
            <>
              {(summary.failed > 0 || stats.problems > 0) && (
                <>
                  <Button variant="outline" className="gap-1.5" onClick={downloadProblems}><Download className="h-4 w-4" />Rows to fix</Button>
                  <Button variant="outline" onClick={() => { setOnlyProblems(true); setPage(0); setStage('review'); }}>Fix remaining</Button>
                </>
              )}
              <Button onClick={() => close(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
