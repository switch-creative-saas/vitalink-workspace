// Symptom diagnosis engine: tick findings (or describe them), get a ranked
// differential with the reasons behind each condition, answer the follow-up
// questions, then confirm the final diagnosis so the model learns from it.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, BrainCircuit, Check, ChevronDown, FlaskConical, RotateCcw, Save, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  analyze, confirmDiagnosis, listConditionNames, listFindings, type DxCondition, type DxFinding, type DxPatientMatch, type DxResult,
} from '@/lib/supabase/diagnosis';
import { LiteraturePanel } from './LiteraturePanel';

type Mark = 'present' | 'absent';
const GROUPS: Array<{ id: DxFinding['category']; label: string }> = [
  { id: 'symptom', label: 'Symptoms' }, { id: 'sign', label: 'Signs' }, { id: 'history', label: 'History & exposures' },
];
const URGENCY = {
  emergency: 'bg-red-100 text-red-700', urgent: 'bg-amber-100 text-amber-800', routine: 'bg-gray-100 text-gray-600',
} as const;
const RISK = {
  high: 'border-red-200 bg-red-50 text-red-800', moderate: 'border-amber-200 bg-amber-50 text-amber-800', low: 'border-green-200 bg-green-50 text-green-800',
} as const;
const SOURCE = { text: 'from your description', vitals: 'from latest vitals', record: 'from patient record' } as const;

export function SymptomEngine({ organizationId, patient, canConfirm, onSaved, initialText }: {
  organizationId: string; patient: DxPatientMatch | null; canConfirm: boolean; onSaved: () => void; initialText?: string;
}) {
  const [findings, setFindings] = useState<DxFinding[]>([]);
  const [conditionsList, setConditionsList] = useState<Array<{ id: string; name: string; icd10: string }>>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [text, setText] = useState(initialText ?? '');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<DxResult | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [research, setResearch] = useState<string | null>(null);
  const [final, setFinal] = useState('');
  const [otherDx, setOtherDx] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([listFindings(), listConditionNames()])
      .then(([f, c]) => { setFindings(f); setConditionsList(c); })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load the knowledge base'));
  }, []);

  const labels = useMemo(() => new Map(findings.map((f) => [f.id, f.label])), [findings]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return findings.filter((f) => f.category !== 'vital' && (!needle || f.label.toLowerCase().includes(needle)));
  }, [findings, filter]);

  const present = Object.keys(marks).filter((k) => marks[k] === 'present');
  const absent = Object.keys(marks).filter((k) => marks[k] === 'absent');

  const toggle = (id: string) => setMarks((m) => {
    const next = { ...m };
    if (!next[id]) next[id] = 'present';
    else if (next[id] === 'present') next[id] = 'absent';
    else delete next[id];
    return next;
  });

  const run = async (nextMarks = marks) => {
    const p = Object.keys(nextMarks).filter((k) => nextMarks[k] === 'present');
    const a = Object.keys(nextMarks).filter((k) => nextMarks[k] === 'absent');
    if (!p.length && text.trim().length < 3) { toast.error('Tick at least one finding or describe the presentation'); return; }
    setRunning(true);
    try {
      const r = await analyze({
        organizationId, patientId: patient?.id ?? null, age: age ? Number(age) : null, sex: sex || null,
        present: p, absent: a, text, save: false,
      });
      setResult(r);
      setFinal((current) => current || r.conditions[0]?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Analysis failed');
    } finally {
      setRunning(false);
    }
  };

  const answer = (finding: string, yes: boolean) => {
    const next = { ...marks, [finding]: yes ? 'present' as const : 'absent' as const };
    setMarks(next);
    void run(next);
  };

  const reset = () => { setMarks({}); setText(''); setResult(null); setFinal(''); setOtherDx(''); setExpanded(null); setResearch(null); };

  // Saving stores the analysis on the patient's record; confirming also teaches the model.
  const save = async (confirm: boolean) => {
    if (!result) return;
    if (confirm && !final) { toast.error('Choose the final diagnosis'); return; }
    if (confirm && final === 'other' && otherDx.trim().length < 2) { toast.error('Name the final diagnosis'); return; }
    setSaving(true);
    try {
      const saved = await analyze({ organizationId, patientId: patient?.id ?? null, age: age ? Number(age) : null, sex: sex || null, present, absent, text, save: true });
      if (confirm && saved.sessionId) {
        await confirmDiagnosis(saved.sessionId, final === 'other' ? null : final, final === 'other' ? otherDx.trim() : undefined);
        toast.success(final === 'other' ? 'Final diagnosis recorded' : 'Diagnosis confirmed. VitaMind Dx has learned from this case.');
      } else {
        toast.success('Analysis saved. Signing an EMR note with the diagnosis will confirm it.');
      }
      onSaved();
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-5">
        <div className="premium-card space-y-3 p-4">
          <h3 className="font-semibold text-gray-900">Presentation</h3>
          <Textarea
            className="min-h-24"
            placeholder="Describe it in plain words, e.g. “Fever and chills for 3 days, headache, no cough”"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {!patient && (
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={0} max={120} placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} />
              <select aria-label="Sex" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Sex</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>
          )}
          {patient && <p className="text-xs text-gray-500">Age, sex, latest vitals (last 48 h), genotype and known conditions are read from {patient.name}'s record.</p>}
        </div>

        <div className="premium-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Findings</h3>
            <span className="text-xs text-gray-500">Click once = present, twice = absent</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input className="pl-9" placeholder="Filter findings…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {GROUPS.map((group) => {
              const items = visible.filter((f) => f.category === group.id);
              if (!items.length) return null;
              return (
                <div key={group.id}>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => toggle(f.id)}
                        className={cn('rounded-full border px-2.5 py-1 text-xs',
                          marks[f.id] === 'present' ? 'border-royal-500 bg-royal-600 text-white'
                            : marks[f.id] === 'absent' ? 'border-gray-300 bg-gray-100 text-gray-400 line-through'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-royal-300')}
                      >
                        {marks[f.id] === 'present' && <Check className="mr-1 inline h-3 w-3" />}
                        {marks[f.id] === 'absent' && <X className="mr-1 inline h-3 w-3" />}
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="bg-royal-700 text-white hover:bg-royal-800" onClick={() => void run()} disabled={running}>
              <BrainCircuit className="mr-2 h-4 w-4" />{running ? 'Analysing…' : 'Run differential'}
            </Button>
            <Button variant="outline" onClick={reset} disabled={running}><RotateCcw className="mr-2 h-4 w-4" />Clear</Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-7">
        {!result ? (
          <div className="premium-card p-8 text-center">
            <BrainCircuit className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-900">No analysis yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">Add the patient's findings and run the differential. Every condition shows the findings behind it, the tests to order and current research.</p>
          </div>
        ) : (
          <>
            <div className={cn('flex items-start gap-3 rounded-xl border p-3 text-sm', RISK[result.risk])}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">{result.risk === 'high' ? 'High risk: assess urgently' : result.risk === 'moderate' ? 'Moderate risk' : 'Low risk'}</p>
                {result.redFlags.length > 0 && <p className="mt-0.5">Red flags: {result.redFlags.map((f) => f.label).join(', ')}.</p>}
                {result.autoFindings.length > 0 && (
                  <p className="mt-0.5 text-xs opacity-80">
                    Also used: {result.autoFindings.map((f) => `${labels.get(f.id) ?? f.id} ${f.present ? '' : '(no) '}${SOURCE[f.source]}`).join('; ')}.
                  </p>
                )}
              </div>
            </div>

            <div className="premium-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Ranked differential</h3>
                <span className="text-xs text-gray-400">{result.model}</span>
              </div>
              {result.conditions.length === 0 ? <p className="text-sm text-gray-500">No condition in the knowledge base fits these findings. Add more findings.</p> : (
                <div className="space-y-2">
                  {result.conditions.map((c) => (
                    <ConditionRow
                      key={c.id} condition={c} expanded={expanded === c.id} researching={research === c.id}
                      onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                      onResearch={() => setResearch(research === c.id ? null : c.id)}
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Probabilities are estimates for each condition on its own, so they don't add up to 100%. Decision support only: the clinician makes the diagnosis.
              </p>
            </div>

            {result.questions.length > 0 && (
              <div className="premium-card p-4">
                <h3 className="mb-1 font-semibold text-gray-900">Ask next</h3>
                <p className="mb-3 text-xs text-gray-500">The answers that would best separate the leading conditions.</p>
                <div className="space-y-2">
                  {result.questions.map((q) => (
                    <div key={q.finding} className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-gray-800">{q.question}</span>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="outline" disabled={running} onClick={() => answer(q.finding, true)}>Yes</Button>
                        <Button size="sm" variant="outline" disabled={running} onClick={() => answer(q.finding, false)}>No</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.tests.length > 0 && (
              <div className="premium-card p-4">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-gray-900"><FlaskConical className="h-4 w-4 text-gray-400" />Suggested investigations</h3>
                <div className="flex flex-wrap gap-2">
                  {result.tests.map((t) => <span key={t} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{t}</span>)}
                </div>
              </div>
            )}

            <div className="premium-card space-y-3 p-4">
              <h3 className="font-semibold text-gray-900">Outcome</h3>
              {canConfirm ? (
                <>
                  <p className="text-xs text-gray-500">Confirming the final diagnosis teaches the model: these findings update its statistics for that condition.</p>
                  <select aria-label="Final diagnosis" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={final} onChange={(e) => setFinal(e.target.value)}>
                    <option value="">Choose final diagnosis</option>
                    <optgroup label="From this differential">
                      {result.conditions.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.icd10})</option>)}
                    </optgroup>
                    <optgroup label="All conditions">
                      {conditionsList.filter((c) => !result.conditions.some((r) => r.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.icd10})</option>)}
                    </optgroup>
                    <option value="other">Something else…</option>
                  </select>
                  {final === 'other' && <Input placeholder="Final diagnosis" value={otherDx} onChange={(e) => setOtherDx(e.target.value)} />}
                  <div className="flex flex-wrap gap-2">
                    <Button className="bg-royal-700 text-white hover:bg-royal-800" disabled={saving || !final} onClick={() => void save(true)}>
                      <Check className="mr-2 h-4 w-4" />Confirm diagnosis
                    </Button>
                    {patient && <Button variant="outline" disabled={saving} onClick={() => void save(false)}><Save className="mr-2 h-4 w-4" />Save without confirming</Button>}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500">Only doctors can confirm a diagnosis. Save the analysis to the patient's record for the doctor to review.</p>
                  {patient && <Button variant="outline" disabled={saving} onClick={() => void save(false)}><Save className="mr-2 h-4 w-4" />Save to patient record</Button>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConditionRow({ condition: c, expanded, researching, onToggle, onResearch }: {
  condition: DxCondition; expanded: boolean; researching: boolean; onToggle: () => void; onResearch: () => void;
}) {
  const pct = Math.round(c.probability * 100);
  const supports = c.why.filter((w) => w.weight > 1);
  const against = c.why.filter((w) => w.weight < 1);
  return (
    <div className="rounded-xl border border-gray-100 bg-white">
      <button className="w-full p-3 text-left" onClick={onToggle}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">{c.name}</p>
            <p className="text-xs text-gray-500">{c.icd10} · {c.category}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(c.outbreakFactor ?? 1) > 1 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700" title="Raised by an active outbreak signal">Outbreak ×{c.outbreakFactor}</span>}
            {c.urgency !== 'routine' && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', URGENCY[c.urgency])}>{c.urgency}</span>}
            <span className="w-12 text-right text-sm font-semibold text-gray-900">{pct < 1 ? '<1' : pct}%</span>
            <ChevronDown className={cn('h-4 w-4 text-gray-400', expanded && 'rotate-180')} />
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className={cn('h-full rounded-full', c.urgency === 'emergency' ? 'bg-red-500' : c.urgency === 'urgent' ? 'bg-amber-500' : 'bg-royal-500')} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-gray-100 p-3 text-sm">
          <p className="text-gray-600">{c.description}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Supports</p>
              {supports.length ? supports.map((w) => (
                <p key={w.finding} className="text-xs text-gray-700">{w.present ? '' : 'No '}{w.label} <span className="text-green-700">×{w.weight}</span></p>
              )) : <p className="text-xs text-gray-400">—</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Argues against</p>
              {against.length ? against.map((w) => (
                <p key={w.finding} className="text-xs text-gray-700">{w.present ? '' : 'No '}{w.label} <span className="text-red-600">×{w.weight}</span></p>
              )) : <p className="text-xs text-gray-400">—</p>}
            </div>
          </div>
          {c.tests.length > 0 && <p className="text-xs text-gray-700"><span className="font-medium">Tests:</span> {c.tests.join(', ')}</p>}
          {c.advice && <p className="text-xs text-gray-700"><span className="font-medium">Next step:</span> {c.advice}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-400">{c.learnedCases > 0 ? `Refined by ${c.learnedCases} confirmed case${c.learnedCases === 1 ? '' : 's'}` : 'Seed estimates; no confirmed cases yet'}</p>
            <button className="flex items-center gap-1 text-xs font-medium text-royal-600 hover:underline" onClick={onResearch}>
              <BookOpen className="h-3.5 w-3.5" />{researching ? 'Hide research' : 'Research'}
            </button>
          </div>
          {researching && <LiteraturePanel conditionId={c.id} conditionName={c.name} />}
        </div>
      )}
    </div>
  );
}
