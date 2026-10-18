// Outbreak signals for VitaMind Dx. WHO items arrive automatically each day;
// NCDC publishes situation reports as PDFs, so the team records them here.
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { endOutbreakSignal, listConditionNames, listOutbreakSignals, saveOutbreakSignal, type OutbreakSignal } from '@/lib/supabase/diagnosis';
import { date, errorText } from './consoleFormat';

const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const LEVEL_TONE = { high: 'bg-red-100 text-red-700', active: 'bg-amber-100 text-amber-800', watch: 'bg-blue-100 text-blue-700' } as const;
const FIELD = 'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900';
const blank = () => ({ conditionId: '', state: '', level: 'active' as OutbreakSignal['level'], source: 'ncdc' as 'ncdc' | 'manual', title: '', url: '', note: '', startsOn: new Date().toISOString().slice(0, 10), endsOn: '' });

export function OutbreaksTab() {
  const [signals, setSignals] = useState<Array<OutbreakSignal & { active: boolean }>>([]);
  const [conditions, setConditions] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listOutbreakSignals().then(setSignals).catch((error) => toast.error(errorText(error, 'Could not load signals')));
  }, []);
  useEffect(() => {
    load();
    listConditionNames().then(setConditions).catch(() => undefined);
  }, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try { await saveOutbreakSignal(form); toast.success('Signal saved. VitaMind Dx applies it immediately.'); setForm(null); load(); }
    catch (error) { toast.error(errorText(error, 'Could not save the signal')); }
    finally { setBusy(false); }
  };
  const end = async (id: string) => {
    try { await endOutbreakSignal(id); toast.success('Signal ended'); load(); }
    catch (error) { toast.error(errorText(error, 'Could not end the signal')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Outbreak signals</h2>
          <p className="max-w-2xl text-sm text-slate-500">
            Active signals raise a condition's likelihood in VitaMind Dx: strongly in the named state, mildly nationwide. WHO Disease Outbreak News for Nigeria syncs daily; record NCDC situation reports here.
          </p>
        </div>
        {!form && <Button onClick={() => setForm(blank())}><Plus className="mr-2 h-4 w-4" />Add signal</Button>}
      </div>

      {form && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500">Condition
              <select className={FIELD} value={form.conditionId} onChange={(e) => setForm({ ...form, conditionId: e.target.value })}>
                <option value="">Choose…</option>
                {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">State
              <select className={FIELD} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="">Nationwide</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Level
              <select className={FIELD} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as OutbreakSignal['level'] })}>
                <option value="watch">Watch (rising cases)</option>
                <option value="active">Active outbreak</option>
                <option value="high">High (large or deadly outbreak)</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500 md:col-span-2">Title<Input value={form.title} placeholder="e.g. Lassa fever situation report, week 41" onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="text-xs text-slate-500">Source
              <select className={FIELD} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as 'ncdc' | 'manual' })}>
                <option value="ncdc">NCDC</option><option value="manual">Other confirmed source</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500 md:col-span-3">Link to the report<Input value={form.url} placeholder="https://ncdc.gov.ng/…" onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
            <label className="text-xs text-slate-500">From<Input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label>
            <label className="text-xs text-slate-500">Until (optional)<Input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label>
            <label className="text-xs text-slate-500">Note<Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          <div className="flex gap-2">
            <Button disabled={busy || !form.conditionId || form.title.trim().length < 3} onClick={() => void save()}>Save signal</Button>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {signals.length === 0 ? <p className="p-4 text-sm text-slate-500">No signals recorded yet.</p> : signals.map((s) => (
          <div key={s.id} className={cn('flex flex-wrap items-center gap-3 border-t border-slate-100 p-3 text-sm first:border-0 dark:border-slate-800', !s.active && 'opacity-60')}>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase', LEVEL_TONE[s.level])}>{s.level}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.condition} · {s.state ?? 'Nationwide'}</p>
              <p className="text-xs text-slate-500">
                {s.title} · {s.source.toUpperCase()} · {date(s.since)}{s.until ? ` – ${date(s.until)}` : ''}{s.active ? '' : ' · ended'}
                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-violet-600 hover:underline">source<ExternalLink className="ml-0.5 h-3 w-3" /></a>}
              </p>
            </div>
            {s.active && s.source !== 'who' && <Button size="sm" variant="outline" onClick={() => void end(s.id)}>End</Button>}
          </div>
        ))}
      </section>
    </div>
  );
}
