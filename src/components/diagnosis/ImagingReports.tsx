// Imaging: studies are stored on the patient's chart and reported by a clinician.
// VitaLink does not run automated image analysis.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileImage, ImageUp, Info, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { documentLink, listDocuments, uploadDocument, type PatientDocument } from '@/lib/supabase/documents';
import { listImagingReports, saveImagingReport, type DxPatientMatch, type ImagingReport } from '@/lib/supabase/diagnosis';

const MODALITIES = ['X-ray', 'Ultrasound', 'CT', 'MRI', 'ECG', 'Echocardiogram', 'Mammogram', 'Other'];
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function ImagingReports({ organizationId, patient, canReport }: { organizationId: string; patient: DxPatientMatch | null; canReport: boolean }) {
  const [studies, setStudies] = useState<PatientDocument[]>([]);
  const [reports, setReports] = useState<ImagingReport[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ modality: 'X-ray', findings: '', impression: '', status: 'final' as 'preliminary' | 'final' });
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!patient) return;
    Promise.all([listDocuments(organizationId, patient.id), listImagingReports(organizationId, patient.id)])
      .then(([docs, reps]) => {
        const imaging = docs.filter((d) => d.category === 'Imaging');
        setStudies(imaging);
        setReports(reps);
        setSelected((current) => (current && imaging.some((d) => d.id === current) ? current : imaging[0]?.id ?? null));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load imaging'));
  }, [organizationId, patient]);
  useEffect(() => { load(); }, [load]);

  if (!patient) {
    return (
      <div className="premium-card p-8 text-center">
        <FileImage className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 font-medium text-gray-900">Choose a patient</p>
        <p className="mt-1 text-sm text-gray-500">Find a patient above to upload and report their imaging.</p>
      </div>
    );
  }

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { await uploadDocument(organizationId, patient.id, file, 'Imaging'); toast.success('Study added to the chart'); load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Upload failed'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const open = async (doc: PatientDocument) => {
    try { window.open(await documentLink(doc.storagePath), '_blank', 'noopener'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not open the study'); }
  };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await saveImagingReport(selected, form);
      toast.success('Report saved');
      setForm((f) => ({ ...f, findings: '', impression: '' }));
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the report');
    } finally {
      setBusy(false);
    }
  };

  const current = studies.find((d) => d.id === selected) ?? null;
  const currentReports = reports.filter((r) => r.documentId === selected);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>VitaLink does not read images automatically. Studies are stored on the patient's chart and reported by a clinician; reports appear in the patient's record.</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-5">
          <div className="premium-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Studies</h3>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><ImageUp className="mr-2 h-4 w-4" />Upload</Button>
              <input ref={fileInput} type="file" className="hidden" accept="image/*,.pdf,.dcm" onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
            {studies.length === 0 ? <p className="text-sm text-gray-500">No imaging on {patient.name}'s chart yet.</p> : (
              <div className="space-y-2">
                {studies.map((d) => {
                  const count = reports.filter((r) => r.documentId === d.id).length;
                  return (
                    <button key={d.id} onClick={() => setSelected(d.id)} className={cn('w-full rounded-xl border p-3 text-left', selected === d.id ? 'border-royal-300 bg-royal-50' : 'border-gray-100 bg-white hover:bg-gray-50')}>
                      <p className="truncate text-sm font-medium text-gray-900">{d.name}</p>
                      <p className="text-xs text-gray-500">{d.uploadedAt} · {d.size} · {count ? `${count} report${count === 1 ? '' : 's'}` : 'Not reported'}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:col-span-7">
          {!current ? <div className="premium-card p-8 text-center text-sm text-gray-500">Upload or choose a study to report it.</div> : (
            <>
              <div className="premium-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate font-semibold text-gray-900">{current.name}</h3><p className="text-xs text-gray-500">Uploaded {current.uploadedAt} by {current.uploadedBy}</p></div>
                  <Button size="sm" variant="outline" onClick={() => void open(current)}><ExternalLink className="mr-2 h-4 w-4" />View</Button>
                </div>
                <div className="mt-4 space-y-3">
                  {currentReports.length === 0 ? <p className="text-sm text-gray-500">No report yet.</p> : currentReports.map((r) => (
                    <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                      <div className="flex justify-between gap-2 text-xs text-gray-500">
                        <span>{r.modality} · {r.status === 'preliminary' ? 'Preliminary' : 'Final'}</span><span>{r.reportedBy ? `${r.reportedBy} · ` : ''}{day(r.createdAt)}</span>
                      </div>
                      {r.findings && <p className="mt-2 whitespace-pre-wrap text-gray-700"><span className="font-medium">Findings:</span> {r.findings}</p>}
                      <p className="mt-1 whitespace-pre-wrap text-gray-900"><span className="font-medium">Impression:</span> {r.impression}</p>
                    </div>
                  ))}
                </div>
              </div>

              {canReport ? (
                <div className="premium-card space-y-3 p-4">
                  <h3 className="font-semibold text-gray-900">Add report</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <select aria-label="Modality" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.modality} onChange={(e) => setForm((f) => ({ ...f, modality: e.target.value }))}>
                      {MODALITIES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                    <select aria-label="Report status" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'preliminary' | 'final' }))}>
                      <option value="final">Final</option>
                      <option value="preliminary">Preliminary</option>
                    </select>
                  </div>
                  <Textarea className="min-h-20" placeholder="Findings" value={form.findings} onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))} />
                  <Input placeholder="Impression (required)" value={form.impression} onChange={(e) => setForm((f) => ({ ...f, impression: e.target.value }))} />
                  <Button className="bg-royal-700 text-white hover:bg-royal-800" disabled={busy || form.impression.trim().length < 2} onClick={() => void submit()}>
                    <Save className="mr-2 h-4 w-4" />Save report
                  </Button>
                </div>
              ) : <p className="text-xs text-gray-500">Only doctors can report imaging.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
