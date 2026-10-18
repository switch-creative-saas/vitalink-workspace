// History-aware analysis: rules over the patient's own record (labs, vitals,
// visits, prescriptions, allergies and past analyses).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPatientInsights, markReviewed, type DxPatientInsights, type DxPatientMatch } from '@/lib/supabase/diagnosis';

const SEVERITY = {
  high: { box: 'border-red-100 bg-red-50 text-red-800', icon: AlertTriangle },
  moderate: { box: 'border-amber-100 bg-amber-50 text-amber-800', icon: AlertTriangle },
  info: { box: 'border-blue-100 bg-blue-50 text-blue-800', icon: Info },
} as const;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

export function HistoryAnalysis({ patient, canReview, refreshKey }: { patient: DxPatientMatch | null; canReview: boolean; refreshKey: number }) {
  const [data, setData] = useState<DxPatientInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!patient) return;
    getPatientInsights(patient.id)
      .then((r) => { setData(r); setLoading(false); })
      .catch((error) => { toast.error(error instanceof Error ? error.message : 'Could not analyse the record'); setLoading(false); });
  }, [patient]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!patient) {
    return (
      <div className="premium-card p-8 text-center">
        <History className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 font-medium text-gray-900">Choose a patient</p>
        <p className="mt-1 text-sm text-gray-500">Find a patient above to analyse their labs, vitals, visits and prescriptions.</p>
      </div>
    );
  }
  if (!data || data.patient.id !== patient.id) return <div className="premium-card p-8 text-center text-sm text-gray-500">Analysing {patient.name}'s record…</div>;

  const p = data.patient;
  const review = async () => {
    setSaving(true);
    try { await markReviewed(patient.id, note); setNote(''); toast.success('Review recorded'); load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not record the review'); }
    finally { setSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <div className="premium-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Findings from the record</h3>
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); load(); }} disabled={loading}><RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />Re-run</Button>
          </div>
          {data.insights.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-green-100 bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />Nothing in the record needs attention.</p>
          ) : (
            <div className="space-y-2">
              {data.insights.map((i, idx) => {
                const s = SEVERITY[i.severity];
                return (
                  <div key={idx} className={cn('flex items-start gap-2 rounded-xl border p-3 text-sm', s.box)}>
                    <s.icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><p className="font-medium">{i.title}</p><p className="mt-0.5 opacity-90">{i.detail}</p></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">Rules over labs, vitals, visits, prescriptions and allergies in this workspace. Review before acting.</p>
        </div>

        <div className="premium-card p-4">
          <h3 className="mb-3 font-semibold text-gray-900">Diagnosis history</h3>
          {data.diagnoses.length === 0 ? <p className="text-sm text-gray-500">No diagnoses recorded yet.</p> : (
            <div className="space-y-2">
              {data.diagnoses.map((d, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{d.diagnosis || d.complaint || '—'}</p>
                    <p className="text-xs text-gray-500">{d.diagnosis && d.complaint ? `${d.complaint} · ` : ''}{d.source}{d.status === 'draft' ? ' (draft)' : ''}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{day(d.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="premium-card p-4">
          <h3 className="mb-3 font-semibold text-gray-900">Recent lab results</h3>
          {data.labs.length === 0 ? <p className="text-sm text-gray-500">No completed lab results.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1.5 pr-3">Test</th><th className="pr-3">Result</th><th className="pr-3">Flag</th><th>Date</th></tr></thead>
                <tbody>
                  {data.labs.map((l, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 text-gray-900">{l.test}</td>
                      <td className="pr-3 text-gray-700">{l.value || '—'}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="pr-3"><span className={cn('rounded-full px-2 py-0.5 text-xs', l.flag === 'Normal' ? 'bg-green-100 text-green-700' : l.flag === 'Critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>{l.flag}</span></td>
                      <td className="whitespace-nowrap text-xs text-gray-500">{day(l.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 lg:col-span-5">
        <div className="premium-card p-4">
          <h3 className="mb-3 font-semibold text-gray-900">{p.name}</h3>
          <div className="space-y-2 text-sm">
            {([['VitaLink ID', p.switchId], ['Age / sex', `${p.age ?? '—'} · ${p.sex ?? '—'}`], ['Genotype', p.genotype], ['Blood group', p.bloodGroup],
              ['Allergies', p.allergies], ['Chronic conditions', p.chronicConditions], ['Current medicines', p.currentMedications]] as Array<[string, string | null]>).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><span className="text-gray-500">{k}</span><span className="text-right font-medium text-gray-900">{v || '—'}</span></div>
            ))}
          </div>
        </div>

        <div className="premium-card p-4">
          <h3 className="mb-3 font-semibold text-gray-900">Vitals trend</h3>
          {data.vitals.length === 0 ? <p className="text-sm text-gray-500">No vitals recorded.</p> : (
            <div className="space-y-1.5 text-xs">
              {data.vitals.slice().reverse().map((v, idx) => (
                <div key={idx} className="flex justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <span className="text-gray-500">{day(v.at)}</span>
                  <span className="text-gray-800">
                    {[v.systolic ? `BP ${v.systolic}/${v.diastolic}` : null, v.heartRate ? `HR ${v.heartRate}` : null, v.temperature ? `${v.temperature}°C` : null,
                      v.spo2 ? `SpO₂ ${v.spo2}%` : null, v.weight ? `${v.weight} kg` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="premium-card p-4">
          <h3 className="mb-3 font-semibold text-gray-900">Past analyses</h3>
          {data.sessions.length === 0 ? <p className="text-sm text-gray-500">No saved analyses for this patient.</p> : (
            <div className="space-y-2">
              {data.sessions.map((s) => (
                <div key={s.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-xs">
                  <div className="flex justify-between gap-2"><span className="font-medium text-gray-900">{s.confirmed ?? s.note ?? s.top ?? '—'}</span><span className="text-gray-400">{day(s.at)}</span></div>
                  <p className="mt-0.5 text-gray-500">{s.status === 'confirmed' ? 'Confirmed' : s.status === 'closed' ? 'Closed' : `Open · top suggestion ${s.top ?? '—'}`} · {s.risk} risk</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="premium-card space-y-3 p-4">
          <h3 className="font-semibold text-gray-900">Clinician review</h3>
          {data.reviews.length > 0 && (
            <div className="space-y-1.5">
              {data.reviews.map((r, idx) => (
                <p key={idx} className="text-xs text-gray-600"><span className="font-medium text-gray-800">{r.by ?? 'Clinician'}</span> · {day(r.at)}{r.note ? `: ${r.note}` : ''}</p>
              ))}
            </div>
          )}
          {canReview ? (
            <div className="flex gap-2">
              <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="outline" disabled={saving} onClick={() => void review()}><CheckCircle2 className="mr-2 h-4 w-4" />Mark reviewed</Button>
            </div>
          ) : <p className="text-xs text-gray-500">Doctors and nurses can record a review.</p>}
        </div>
      </div>
    </div>
  );
}
