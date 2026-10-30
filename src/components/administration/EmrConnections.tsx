// Administration → Connected EMRs: bring patients and records from the EMR a hospital
// already runs (NMRS, OpenMRS, Bahmni, LAMISPlus, OpenEMR, Helium Health, ...) into VitaLink.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, ChevronDown, ChevronRight, Copy, Database, FileUp, KeyRound, Loader2, Pause, Pencil, Play, PlugZap, Plus, RefreshCw, Search, Trash2, TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AUTH_LABEL, EMR_SYSTEMS, METHOD_LABEL, systemByKey, type EmrAuthType, type EmrMethod, type EmrSystem } from '@/lib/emr/catalog';
import { FIELD_LABEL, guessMapping, rowsToPatients, type CsvField } from '@/lib/emr/csvImport';
import { detect, readImportFile } from '@/lib/import/patientImport';
import {
  EMR_PUSH_URL, createEmrPushKey, deleteEmrConnection, importEmrPatients, listEmrConnections, listEmrRuns, saveEmrConnection, setEmrConnectionPaused,
  startEmrSync, testEmrConnection, type EmrConnection, type EmrSyncRun, type SaveEmrConnection,
} from '@/lib/supabase/emr';

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'never');
const PULL: EmrMethod[] = ['fhir', 'openmrs', 'lamisplus'];
const STATUS_TONE: Record<EmrConnection['status'], string> = {
  active: 'bg-green-100 text-green-700', paused: 'bg-gray-100 text-gray-600', error: 'bg-red-100 text-red-700',
};
const RUN_TONE: Record<EmrSyncRun['status'], string> = {
  running: 'text-blue-700', success: 'text-green-700', partial: 'text-amber-700', failed: 'text-red-700',
};

function runSummary(run: EmrSyncRun): string {
  if (run.trigger === 'test') return run.error ?? `Connected to ${run.counts.software ?? 'the EMR'}`;
  const c = run.counts;
  const parts = [
    c.patients ? `${c.patients} patient${c.patients === 1 ? '' : 's'}${c.created ? ` (${c.created} new)` : ''}` : null,
    c.vitals ? `${c.vitals} vitals` : null,
    c.labs ? `${c.labs} lab results` : null,
    c.records ? `${c.records} other records` : null,
  ].filter(Boolean);
  if (run.error) return run.error;
  return parts.length ? parts.join(' · ') : run.status === 'running' ? 'Working…' : 'Nothing new';
}

// ---------------------------------------------------------------------------
// Connect / edit dialog

interface Draft extends SaveEmrConnection { secretSaved?: boolean }

function ConnectDialog({ organizationId, editing, onClose, onSaved }: {
  organizationId: string; editing: EmrConnection | null; onClose: () => void; onSaved: (id: string, isNew: boolean) => void;
}) {
  const [system, setSystem] = useState<EmrSystem | null>(editing ? systemByKey(editing.system) : null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft>(() => editing ? {
    id: editing.id, system: editing.system, method: editing.method, name: editing.name, baseUrl: editing.baseUrl ?? '', authType: editing.authType,
    username: editing.username ?? '', clientId: editing.clientId ?? '', tokenUrl: editing.tokenUrl ?? '', scope: editing.scope ?? '',
    autoSync: editing.autoSync, syncEveryMinutes: editing.syncEveryMinutes, secretSaved: true,
  } : { system: '', method: 'file', name: '' });
  const [busy, setBusy] = useState(false);

  const pick = (s: EmrSystem) => {
    setSystem(s);
    const method = s.methods[0];
    setDraft({ system: s.key, method, name: s.name.replace(/\s*\(.*\)$/, ''), authType: s.defaultAuth ?? 'none', autoSync: true, syncEveryMinutes: 60, baseUrl: '' });
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const isPull = PULL.includes(draft.method);
  const auth = draft.authType ?? 'none';
  const filtered = EMR_SYSTEMS.filter((s) => `${s.name} ${s.vendor} ${s.usedFor}`.toLowerCase().includes(query.toLowerCase()));

  const save = async () => {
    if (!draft.name.trim()) { toast.error('Give the connection a name'); return; }
    if (isPull && !/^https:\/\//.test(draft.baseUrl ?? '')) { toast.error('Enter the EMR\'s https:// address'); return; }
    setBusy(true);
    try {
      const id = await saveEmrConnection(organizationId, { ...draft, secret: draft.secret || undefined });
      onSaved(id, !editing);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : system ? `Connect ${system.name}` : 'Connect an existing EMR'}</DialogTitle>
          <DialogDescription>
            {system ? system.setupNote : 'Choose the EMR your hospital uses today. Its patients and records will appear in VitaLink; nothing is changed in the other system.'}
          </DialogDescription>
        </DialogHeader>

        {!system ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input className="pl-9" placeholder="Search EMRs" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((s) => (
                <button key={s.key} type="button" onClick={() => pick(s)} className="rounded-xl border border-gray-200 p-3 text-left hover:border-royal-400 hover:bg-royal-50/40">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{s.kind}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{s.usedFor}</p>
                  <p className="mt-1.5 text-[11px] text-royal-700">{s.methods.map((m) => METHOD_LABEL[m]).join(' · ')}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!editing && system.methods.length > 1 && (
              <div>
                <Label>How records reach VitaLink</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {system.methods.map((m) => (
                    <button key={m} type="button" onClick={() => set({ method: m, authType: PULL.includes(m) ? (m === 'lamisplus' ? 'lamisplus' : system.defaultAuth ?? 'basic') : 'none' })}
                      className={cn('rounded-xl border px-3 py-2 text-left text-xs', draft.method === m ? 'border-royal-500 bg-royal-50 text-royal-800' : 'border-gray-200 text-gray-600')}>
                      <span className="block font-semibold">{METHOD_LABEL[m]}</span>
                      {m === 'push' ? 'The EMR or its vendor sends records with a key' : m === 'file' ? 'Upload a CSV export whenever you like' : 'VitaLink fetches new records on a schedule'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="emr-name">Connection name</Label>
              <Input id="emr-name" className="mt-1.5" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. NMRS – ART clinic" />
            </div>

            {isPull && (
              <>
                <div>
                  <Label htmlFor="emr-url">{draft.method === 'openmrs' ? 'OpenMRS address' : draft.method === 'lamisplus' ? 'LAMISPlus address' : 'FHIR base address'}</Label>
                  <Input id="emr-url" className="mt-1.5" value={draft.baseUrl ?? ''} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={system.urlHint ?? 'https://'} />
                  <p className="mt-1 text-xs text-gray-500">Must be reachable over the internet with HTTPS. EMRs on a hospital LAN need a secure public address or gateway from your IT team.</p>
                </div>
                {draft.method === 'fhir' && (
                  <div>
                    <Label>Sign-in</Label>
                    <select className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={auth} onChange={(e) => set({ authType: e.target.value as EmrAuthType })}>
                      {(['none', 'basic', 'bearer', 'oauth2_client', 'oauth2_password'] as EmrAuthType[]).map((a) => <option key={a} value={a}>{AUTH_LABEL[a]}</option>)}
                    </select>
                  </div>
                )}
                {(auth === 'basic' || auth === 'oauth2_password' || auth === 'lamisplus') && (
                  <div>
                    <Label htmlFor="emr-user">{auth === 'lamisplus' ? 'LAMISPlus email' : 'Username'}</Label>
                    <Input id="emr-user" className="mt-1.5" autoComplete="off" value={draft.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
                  </div>
                )}
                {(auth === 'oauth2_client' || auth === 'oauth2_password') && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label htmlFor="emr-client">Client ID</Label><Input id="emr-client" className="mt-1.5" value={draft.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value })} /></div>
                    <div><Label htmlFor="emr-token">Token URL</Label><Input id="emr-token" className="mt-1.5" value={draft.tokenUrl ?? ''} onChange={(e) => set({ tokenUrl: e.target.value })} placeholder="https://…/oauth2/default/token" /></div>
                    <div className="sm:col-span-2"><Label htmlFor="emr-scope">Scopes</Label><Input id="emr-scope" className="mt-1.5" value={draft.scope ?? ''} onChange={(e) => set({ scope: e.target.value })} /></div>
                  </div>
                )}
                {auth !== 'none' && (
                  <div>
                    <Label htmlFor="emr-secret">{auth === 'bearer' ? 'API token' : auth === 'oauth2_client' ? 'Client secret' : 'Password'}</Label>
                    <Input id="emr-secret" type="password" autoComplete="new-password" className="mt-1.5" value={draft.secret ?? ''} onChange={(e) => set({ secret: e.target.value })}
                      placeholder={draft.secretSaved ? 'Saved — leave blank to keep it' : ''} />
                    <p className="mt-1 text-xs text-gray-500">Stored encrypted in VitaLink's vault. It's never shown again, even to admins. Use an account with read-only access.</p>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Sync automatically</p>
                    <p className="text-xs text-gray-500">Fetch new and changed records in the background.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {draft.autoSync && (
                      <select aria-label="How often" className="rounded-lg border border-input bg-background px-2 py-1 text-xs" value={draft.syncEveryMinutes ?? 60} onChange={(e) => set({ syncEveryMinutes: Number(e.target.value) })}>
                        {[15, 30, 60, 180, 360, 1440].map((m) => <option key={m} value={m}>every {m < 60 ? `${m} min` : m === 1440 ? 'day' : `${m / 60} h`}</option>)}
                      </select>
                    )}
                    <Switch checked={draft.autoSync ?? true} onCheckedChange={(checked) => set({ autoSync: checked })} />
                  </div>
                </div>
              </>
            )}
            {draft.method === 'push' && <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">After saving, create a push key and send it with the endpoint address to the EMR vendor or your IT team. They can send FHIR R4 Bundles or VitaLink's simple JSON.</p>}
            {draft.method === 'file' && <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">After saving, upload a CSV export of patients from the EMR or spreadsheet. You can upload again later; patients already imported are updated, not duplicated.</p>}
          </div>
        )}

        <DialogFooter>
          {system && !editing && <Button variant="outline" onClick={() => setSystem(null)}>Back</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {system && <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Connect'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Push key and file import dialogs

function PushKeyDialog({ connection, onClose, onCreated }: { connection: EmrConnection; onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = (text: string) => { void navigator.clipboard.writeText(text); toast.success('Copied'); };
  const create = async () => {
    if (connection.pushKeyPrefix && !window.confirm('Create a new key? The current key stops working immediately.')) return;
    setBusy(true);
    try { setKey(await createEmrPushKey(connection.id)); onCreated(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const sample = `curl -X POST ${EMR_PUSH_URL} \\\n  -H "Authorization: Bearer ${key ?? 'vlek_…'}" \\\n  -H "Content-Type: application/fhir+json" \\\n  -d @bundle.json`;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Push records to VitaLink</DialogTitle>
          <DialogDescription>Give this endpoint and key to {connection.name}'s vendor or your integration engine. Each request can carry up to 500 patients.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Endpoint</Label>
            <div className="mt-1.5 flex gap-2"><Input readOnly value={EMR_PUSH_URL} /><Button variant="outline" size="icon" onClick={() => copy(EMR_PUSH_URL)}><Copy className="h-4 w-4" /></Button></div>
          </div>
          {key ? (
            <div>
              <Label>Push key (shown once)</Label>
              <div className="mt-1.5 flex gap-2"><Input readOnly value={key} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => copy(key)}><Copy className="h-4 w-4" /></Button></div>
              <p className="mt-1 text-xs text-amber-700">Copy it now and share it securely. VitaLink keeps only a fingerprint and can't show it again.</p>
            </div>
          ) : (
            <p className="text-gray-600">{connection.pushKeyPrefix ? `Current key starts ${connection.pushKeyPrefix}…` : 'No key yet.'}</p>
          )}
          <pre className="overflow-x-auto rounded-xl bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{sample}</pre>
          <p className="text-xs text-gray-500">Accepted: a FHIR R4 Bundle or resources (Patient, Observation, Condition, AllergyIntolerance, MedicationRequest/Statement, Encounter, Immunization, Procedure, DocumentReference, DiagnosticReport), or {'{ "patients": [ … ] }'} in VitaLink's simple JSON.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2" disabled={busy} onClick={() => void create()}>
            <KeyRound className="h-4 w-4" />{connection.pushKeyPrefix ? 'Replace key' : 'Create key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileImportDialog({ connection, onClose, onDone }: { connection: EmrConnection; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Array<CsvField | ''>>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ status: string; counts: EmrSyncRun['counts']; errors: EmrSyncRun['errors'] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    // Excel, CSV, FHIR or HL7 exports: the heading row is found wherever it is.
    let parsed: string[][];
    try {
      const found = detect(await readImportFile(file));
      parsed = found ? [found.columns.map((c) => c.header), ...found.body] : [];
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read that file');
      return;
    }
    if (parsed.length < 2) { toast.error('That file has no patient rows'); return; }
    setRows(parsed);
    setMapping(guessMapping(parsed[0]));
    setResult(null);
  };
  const headers = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const has = (f: CsvField) => mapping.includes(f);
  const ready = (has('first_name') && has('last_name')) || has('full_name');

  const start = async () => {
    setProgress(0);
    try {
      setResult(await importEmrPatients(connection.id, rowsToPatients(body, mapping), setProgress));
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && progress === null) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import patients into VitaLink</DialogTitle>
          <DialogDescription>Upload the patient export from {connection.name}. Dates written day-first (12/03/1985) are understood. Patients already in VitaLink are matched by NIN, phone and date of birth, or name and date of birth.</DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,.ndjson,.hl7" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
        {!rows ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center hover:border-royal-400">
            <FileUp className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-800">Choose the export file</p>
            <p className="text-xs text-gray-500">Excel, CSV, FHIR JSON or HL7, exactly as the system exported it</p>
          </button>
        ) : result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-5 w-5" />{runSummary({ trigger: 'file', counts: result.counts, status: 'success', error: null } as EmrSyncRun)}</div>
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">{result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped</p>
                <ul className="mt-1 list-disc pl-4">{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e.error}</li>)}</ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{body.length} patient row{body.length === 1 ? '' : 's'} found. Check how the columns are read:</p>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>{headers.map((h, i) => (
                    <th key={i} className="p-2 text-left align-top">
                      <p className="font-semibold text-gray-800">{h}</p>
                      <select aria-label={`Column ${h}`} className="mt-1 w-full rounded border border-gray-200 bg-white px-1 py-0.5 font-normal" value={mapping[i] ?? ''}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value as CsvField | '' : v === e.target.value ? '' : v)))}>
                        <option value="">Ignore</option>
                        {(Object.keys(FIELD_LABEL) as CsvField[]).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                      </select>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>{body.slice(0, 4).map((r, i) => <tr key={i} className="border-t border-gray-100">{headers.map((_, j) => <td key={j} className="p-2 text-gray-600">{r[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {!ready && <p className="text-xs text-red-600">Pick the name columns (first and last name, or full name) to continue.</p>}
            {!has('date_of_birth') && <p className="text-xs text-amber-700">Without a date of birth column, only patients already in VitaLink can be matched; new ones will be skipped.</p>}
            {!has('external_id') && <p className="text-xs text-amber-700">No patient ID column: re-importing this file later may not recognise rows whose names changed.</p>}
            {progress !== null && <p className="text-xs text-gray-600">Imported {progress} of {body.length}…</p>}
          </div>
        )}
        <DialogFooter>
          {rows && !result && <Button variant="outline" disabled={progress !== null} onClick={() => setRows(null)}>Choose another file</Button>}
          <Button variant="outline" disabled={progress !== null} onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
          {rows && !result && <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={!ready || progress !== null} onClick={() => void start()}>{progress !== null ? 'Importing…' : `Import ${body.length} patients`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function ConnectionCard({ connection, onChanged, onEdit, onPush, onFile }: {
  connection: EmrConnection; onChanged: () => void; onEdit: () => void; onPush: () => void; onFile: () => void;
}) {
  const system = systemByKey(connection.system);
  const [runs, setRuns] = useState<EmrSyncRun[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isPull = PULL.includes(connection.method);
  const running = runs?.some((r) => r.status === 'running') ?? false;

  const loadRuns = useCallback(() => { listEmrRuns(connection.id, 8).then(setRuns).catch(() => setRuns([])); }, [connection.id]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  // While a sync runs, follow it (first syncs continue across several runs).
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { loadRuns(); onChanged(); }, 4000);
    return () => window.clearInterval(timer);
  }, [running, loadRuns, onChanged]);

  const act = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try { await action(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); loadRuns(); onChanged(); }
  };
  const test = () => act('test', async () => {
    const result = await testEmrConnection(connection.id);
    if (result.ok) toast.success(`Connected to ${result.software ?? 'the EMR'}${result.patients != null ? ` · ${result.patients.toLocaleString()} patients` : ''}`);
    else toast.error(result.error ?? 'Connection failed');
  });
  const sync = () => act('sync', async () => { await startEmrSync(connection.id); toast.success(connection.initialSyncDone ? 'Fetching new records…' : 'First sync started. Large EMRs can take a while; it carries on in the background.'); });
  const remove = () => {
    if (!window.confirm(`Disconnect ${connection.name}? Patients and records already imported stay in VitaLink.`)) return;
    void act('delete', () => deleteEmrConnection(connection.id));
  };
  const last = runs?.find((r) => r.trigger !== 'test');

  return (
    <div className="premium-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-gray-900">{connection.name}</p>
            <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[connection.status])}>{connection.status === 'error' ? 'Needs attention' : connection.status === 'paused' ? 'Paused' : 'Active'}</span>
            {running && <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700"><Loader2 className="h-3 w-3 animate-spin" />Syncing</span>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{system.name} · {METHOD_LABEL[connection.method]}{connection.baseUrl ? ` · ${new URL(connection.baseUrl).host}` : ''}</p>
          <p className="mt-1 text-xs text-gray-600">
            {connection.patientsLinked.toLocaleString()} patient{connection.patientsLinked === 1 ? '' : 's'} linked · last {isPull ? 'sync' : 'import'} {ago(last?.startedAt ?? connection.lastSyncAt)}
            {isPull && !connection.initialSyncDone && connection.lastSyncAt && ' · first sync in progress'}
            {isPull && connection.autoSync && connection.initialSyncDone && ` · syncs every ${connection.syncEveryMinutes < 60 ? `${connection.syncEveryMinutes} min` : `${connection.syncEveryMinutes / 60} h`}`}
          </p>
          {connection.lastError && <p className="mt-1 flex items-start gap-1 text-xs text-red-600"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{connection.lastError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {isPull && <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void test()}><PlugZap className="h-4 w-4" />Test</Button>}
          {isPull && <Button size="sm" className="gap-1.5 bg-royal-600 text-white hover:bg-royal-700" disabled={busy !== null || running || connection.status === 'paused'} onClick={() => void sync()}><RefreshCw className={cn('h-4 w-4', busy === 'sync' && 'animate-spin')} />Sync now</Button>}
          {connection.method === 'push' && <Button size="sm" className="gap-1.5 bg-royal-600 text-white hover:bg-royal-700" onClick={onPush}><KeyRound className="h-4 w-4" />Push key</Button>}
          {(connection.method === 'file' || system.methods.includes('file')) && <Button size="sm" variant={connection.method === 'file' ? 'default' : 'outline'} className={cn('gap-1.5', connection.method === 'file' && 'bg-royal-600 text-white hover:bg-royal-700')} onClick={onFile}><FileUp className="h-4 w-4" />Import file</Button>}
          {connection.method !== 'file' && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void act('pause', () => setEmrConnectionPaused(connection.id, connection.status !== 'paused'))}>
              {connection.status === 'paused' ? <><Play className="h-4 w-4" />Resume</> : <><Pause className="h-4 w-4" />Pause</>}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" className="text-red-600" disabled={busy !== null} onClick={remove} aria-label="Disconnect"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {runs && runs.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <button type="button" className="flex items-center gap-1 text-xs font-medium text-gray-600" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Recent activity
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {runs.map((run) => (
                <li key={run.id} className="text-xs">
                  <span className={cn('font-medium', RUN_TONE[run.status])}>{run.trigger === 'test' ? 'Test' : run.trigger === 'schedule' ? 'Scheduled sync' : run.trigger === 'push' ? 'Received' : run.trigger === 'file' ? 'File import' : 'Sync'}</span>
                  <span className="text-gray-500"> · {ago(run.startedAt)} · </span>
                  <span className="text-gray-700">{runSummary(run)}</span>
                  {run.errors.filter((e) => e.error).length > 0 && <span className="text-amber-700"> · {run.errors.filter((e) => e.error).length} skipped ({run.errors.find((e) => e.error)?.error})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EmrConnections({ organizationId }: { organizationId: string }) {
  const [connections, setConnections] = useState<EmrConnection[] | null>(null);
  const [dialog, setDialog] = useState<{ type: 'connect'; editing: EmrConnection | null } | { type: 'push' | 'file'; connection: EmrConnection } | null>(null);

  const load = useCallback(() => { listEmrConnections(organizationId).then(setConnections).catch((e) => { toast.error((e as Error).message); setConnections([]); }); }, [organizationId]);
  useEffect(() => { load(); }, [load]);
  const byId = useMemo(() => new Map((connections ?? []).map((c) => [c.id, c])), [connections]);

  const saved = async (id: string, isNew: boolean) => {
    setDialog(null);
    const list = await listEmrConnections(organizationId).catch(() => null);
    if (list) setConnections(list);
    const conn = list?.find((c) => c.id === id);
    if (!isNew || !conn) { toast.success('Connection saved'); return; }
    if (conn.method === 'push') setDialog({ type: 'push', connection: conn });
    else if (conn.method === 'file') setDialog({ type: 'file', connection: conn });
    else {
      const result = await testEmrConnection(id);
      if (!result.ok) { toast.error(`Saved, but VitaLink couldn't connect: ${result.error}`); load(); return; }
      toast.success(`Connected to ${result.software ?? 'the EMR'}. Starting the first sync…`);
      await startEmrSync(id).catch((e) => toast.error((e as Error).message));
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="premium-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" />
            <div>
              <h3 className="font-semibold text-gray-900">Connected EMRs</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                Already using another EMR? Connect it and its patients, vitals, lab results, diagnoses, allergies, medicines, visits and immunisations appear in VitaLink.
                Records from the other system are read-only here; VitaLink never changes them at the source.
              </p>
            </div>
          </div>
          <Button className="shrink-0 gap-2 rounded-xl bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={() => setDialog({ type: 'connect', editing: null })}>
            <Plus className="h-4 w-4" />Connect an EMR
          </Button>
        </div>
      </div>

      {connections === null ? <div className="premium-card p-6 text-sm text-gray-500">Loading connections…</div>
        : connections.length === 0 ? (
          <div className="premium-card p-8 text-center text-sm text-gray-500">
            No EMR connected yet. Supported: NMRS, OpenMRS, Bahmni, LAMISPlus, OpenEMR and any FHIR R4 system directly; Helium Health, LafiaLink, ClinikEHR and other commercial EMRs by push or file export.
          </div>
        ) : connections.map((c) => (
          <ConnectionCard key={c.id} connection={c} onChanged={load} onEdit={() => setDialog({ type: 'connect', editing: c })}
            onPush={() => setDialog({ type: 'push', connection: c })} onFile={() => setDialog({ type: 'file', connection: c })} />
        ))}

      {dialog?.type === 'connect' && <ConnectDialog organizationId={organizationId} editing={dialog.editing} onClose={() => setDialog(null)} onSaved={(id, isNew) => void saved(id, isNew)} />}
      {dialog?.type === 'push' && <PushKeyDialog connection={byId.get(dialog.connection.id) ?? dialog.connection} onClose={() => setDialog(null)} onCreated={load} />}
      {dialog?.type === 'file' && <FileImportDialog connection={dialog.connection} onClose={() => setDialog(null)} onDone={load} />}
    </div>
  );
}
