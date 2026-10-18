// VitaMind AI (paid tier): retrieval-augmented differential from Claude, grounded
// in guideline and literature excerpts, with clinician confirm/override feedback.
import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Check, ExternalLink, Lock, PencilLine, Sparkles, Split } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  VitaMindError, vitamindDiagnose, vitamindFeedback, vitamindStatus, type DxPatientMatch, type VitaMindResult,
} from '@/lib/supabase/diagnosis';

const LIKELIHOOD = {
  high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-800', low: 'bg-gray-100 text-gray-600',
} as const;

export function VitaMindAI({ organizationId, patient, canFeedback, onUpgrade }: {
  organizationId: string; patient: DxPatientMatch | null; canFeedback: boolean; onUpgrade: () => void;
}) {
  const [status, setStatus] = useState<{ access: boolean; configured: boolean } | null>(null);
  const [complaint, setComplaint] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VitaMindResult | null>(null);
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null);
  const [override, setOverride] = useState<{ action: 'override' | 'partial'; diagnosis: string; notes: string } | null>(null);

  useEffect(() => {
    vitamindStatus(organizationId).then(setStatus).catch(() => setStatus({ access: false, configured: false }));
  }, [organizationId]);

  if (!status) return <div className="premium-card p-8 text-center text-sm text-gray-500">Checking your plan…</div>;

  if (!status.access) {
    return (
      <div className="premium-card mx-auto max-w-2xl p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-royal-500 to-purple-600 text-white"><Sparkles className="h-6 w-6" /></div>
        <h3 className="mt-4 text-xl font-bold text-gray-900">VitaMind AI</h3>
        <p className="mt-2 text-sm text-gray-600">The advanced tier of VitaMind. It reads the patient's full record, retrieves the most relevant guideline and research excerpts, and writes a reasoned differential with citations.</p>
        <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left text-sm text-gray-700">
          {['Free-text reasoning across the whole record: notes, labs, vitals, medicines', 'Answers grounded in retrieved PubMed, Europe PMC and FMOH guideline text', 'Only cites sources it was actually given', 'Clinician confirm / override feedback that also trains VitaMind Dx'].map((t) => (
            <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />{t}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">Included on the Enterprise & NGO Corridor plan. VitaMind Dx stays available on your current plan.</p>
        <Button className="mt-4 bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={onUpgrade}><Lock className="mr-2 h-4 w-4" />See plans</Button>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="premium-card mx-auto max-w-2xl p-8 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-gray-300" />
        <h3 className="mt-3 font-semibold text-gray-900">VitaMind AI is included in your plan but not connected yet</h3>
        <p className="mt-1 text-sm text-gray-500">The VitaMind AI service hasn't been deployed for this VitaLink installation. VitaMind Dx works in the meantime.</p>
      </div>
    );
  }

  const run = async () => {
    setRunning(true);
    setFeedbackDone(null);
    setOverride(null);
    try {
      setResult(await vitamindDiagnose(organizationId, {
        patientId: patient?.id ?? null, chiefComplaint: complaint, age: age ? Number(age) : null, sex: sex || null,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'VitaMind AI failed');
    } finally {
      setRunning(false);
    }
  };

  const sendFeedback = async (action: 'confirm' | 'override' | 'partial', diagnosis?: string, notes?: string) => {
    if (!result) return;
    try {
      await vitamindFeedback(organizationId, result.result_id, action, diagnosis, notes);
      setFeedbackDone(action === 'confirm' ? 'Confirmed' : action === 'override' ? `Overridden: ${diagnosis}` : `Partly right: ${diagnosis || 'noted'}`);
      setOverride(null);
      toast.success('Feedback saved. VitaMind learns from it.');
    } catch (error) {
      toast.error(error instanceof VitaMindError || error instanceof Error ? error.message : 'Could not save feedback');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-5">
        <div className="premium-card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            <h3 className="font-semibold text-gray-900">Presenting complaint</h3>
          </div>
          <Textarea className="min-h-32" placeholder="e.g. 3 days of fever with rigors, frontal headache, vomiting twice today; travelled to Ondo last week" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
          {patient ? (
            <p className="text-xs text-gray-500">VitaMind AI also reads {patient.name}'s vitals, notes, labs, medicines, allergies and history. Name, phone and IDs are never sent.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={0} max={120} placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} />
              <select aria-label="Sex" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Sex</option><option value="female">Female</option><option value="male">Male</option>
              </select>
            </div>
          )}
          <Button className="w-full bg-gradient-to-r from-royal-600 to-purple-600 text-white" disabled={running || complaint.trim().length < 3} onClick={() => void run()}>
            <Sparkles className="mr-2 h-4 w-4" />{running ? 'VitaMind is reasoning…' : 'Ask VitaMind AI'}
          </Button>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-7">
        {!result ? (
          <div className="premium-card p-8 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-900">{running ? 'Retrieving guidelines and reasoning…' : 'No analysis yet'}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">Describe the complaint. VitaMind AI combines it with the patient's record and the most relevant clinical guidance.</p>
          </div>
        ) : (
          <>
            {(result.requires_urgent_review || result.red_flags.length > 0) && (
              <div className={cn('flex items-start gap-3 rounded-xl border p-3 text-sm', result.requires_urgent_review ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  {result.requires_urgent_review && <p className="font-semibold">Urgent clinical review recommended</p>}
                  {result.red_flags.length > 0 && <p>Red flags: {result.red_flags.join('; ')}</p>}
                </div>
              </div>
            )}

            <div className="premium-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">Differential</h3>
                <span className="text-xs text-gray-500">Confidence {Math.round(result.confidence_score * 100)}%</span>
              </div>
              <div className="space-y-2">
                {result.differential.map((d, i) => (
                  <div key={`${d.condition}-${i}`} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">{d.condition}</p>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', LIKELIHOOD[d.probability])}>{d.probability}</span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <div>{d.supporting_evidence.map((e) => <p key={e} className="text-gray-700">+ {e}</p>)}</div>
                      <div>{d.against_evidence.map((e) => <p key={e} className="text-gray-500">− {e}</p>)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {result.recommended_actions.length > 0 && (
              <div className="premium-card p-4">
                <h3 className="mb-2 font-semibold text-gray-900">Recommended actions</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{result.recommended_actions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}

            <div className="premium-card p-4">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-gray-900"><BookOpen className="h-4 w-4 text-gray-400" />Sources</h3>
              {result.citations.length === 0 ? <p className="text-sm text-gray-500">No retrieved source supported this answer, so none is cited.</p> : (
                <ul className="space-y-1.5">
                  {result.citations.map((c) => (
                    <li key={c.source} className="text-sm">
                      <a href={c.source} target="_blank" rel="noreferrer" className="text-gray-900 hover:text-royal-700 hover:underline">{c.title}<ExternalLink className="ml-1 inline h-3 w-3 text-gray-400" /></a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-gray-400">{result.disclaimer} · {result.model_used} · {(result.latency_ms / 1000).toFixed(1)}s</p>
            </div>

            <div className="premium-card space-y-3 p-4">
              <h3 className="font-semibold text-gray-900">Was this right?</h3>
              {feedbackDone ? <p className="flex items-center gap-2 text-sm text-green-700"><Check className="h-4 w-4" />{feedbackDone}</p>
                : !canFeedback ? <p className="text-xs text-gray-500">Only doctors can confirm or override a result.</p>
                : override ? (
                  <div className="space-y-2">
                    <Input placeholder={override.action === 'override' ? 'Actual diagnosis (required)' : 'What was right / missing'} value={override.diagnosis} onChange={(e) => setOverride({ ...override, diagnosis: e.target.value })} />
                    <Input placeholder="Notes (optional)" value={override.notes} onChange={(e) => setOverride({ ...override, notes: e.target.value })} />
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-royal-700 text-white" disabled={override.action === 'override' && override.diagnosis.trim().length < 2}
                        onClick={() => void sendFeedback(override.action, override.diagnosis.trim(), override.notes.trim())}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setOverride(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void sendFeedback('confirm')}><Check className="mr-2 h-4 w-4" />Confirm top diagnosis</Button>
                    <Button size="sm" variant="outline" onClick={() => setOverride({ action: 'partial', diagnosis: '', notes: '' })}><Split className="mr-2 h-4 w-4" />Partly right</Button>
                    <Button size="sm" variant="outline" onClick={() => setOverride({ action: 'override', diagnosis: '', notes: '' })}><PencilLine className="mr-2 h-4 w-4" />Override</Button>
                  </div>
                )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
