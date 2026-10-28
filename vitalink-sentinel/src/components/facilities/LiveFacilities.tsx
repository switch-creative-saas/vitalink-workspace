// Reporting network on live Supabase data: VitaLink hospitals sharing with this
// organisation (and requests waiting for their approval), direct reporting sites, and
// partner systems sending cases through the sentinel-ingest API.
import { useCallback, useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Building2, Copy, KeyRound, Network, Plus, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { useSentinelStore } from '@/store/useSentinelStore';
import {
  INGEST_URL, addFacility, canManageOutbreaks, createApiKey, getFacilityOverview, listApiSources, removeFacility, requestFacilityLink, revokeApiKey,
  searchVitalinkFacilities, updateFacility,
  type ApiSource, type DirectSite, type FacilityType, type NetworkFacility, type ReportingFrequency, type VitalinkFacility,
} from '@/lib/supabase/sentinel';

type Tab = 'network' | 'request' | 'api';
const TYPES: FacilityType[] = ['Hospital', 'Clinic', 'PHC', 'Community', 'Laboratory', 'Isolation Center'];
const FREQUENCIES: Record<ReportingFrequency, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', on_event: 'When cases occur' };
const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const inputClass = 'sentinel-input rounded-xl px-3 py-2 text-sm';
const copy = (text: string) => { void navigator.clipboard.writeText(text); toast.success('Copied'); };

function connection(f: NetworkFacility): { label: string; tone: 'low' | 'moderate' | 'high' | 'critical' } {
  if (!f.isActive && f.consentStatus === 'approved') return { label: 'Inactive', tone: 'moderate' };
  if (!f.vitalink) return { label: 'Direct reporting', tone: 'low' };
  switch (f.consentStatus) {
    case 'approved': return { label: 'Sharing', tone: 'low' };
    case 'pending': return { label: 'Awaiting hospital approval', tone: 'moderate' };
    case 'declined': return { label: 'Declined by hospital', tone: 'high' };
    default: return { label: 'Stopped', tone: 'high' };
  }
}

const reportedWithin = (f: NetworkFacility, days: number) => Boolean(f.lastSeen && Date.now() - new Date(f.lastSeen).getTime() < days * 86_400_000);

function reporting(f: NetworkFacility): string {
  if (f.vitalink && f.consentStatus !== 'approved') return '—';
  if (!f.lastSeen) return 'Nothing yet';
  const days = Math.floor((Date.now() - new Date(f.lastSeen).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

// ---------------------------------------------------------------------------

function SiteForm({ initial, onSave, onCancel }: { initial?: NetworkFacility; onSave: (site: DirectSite) => Promise<void>; onCancel: () => void }) {
  const [site, setSite] = useState<DirectSite>({
    name: initial?.name ?? '', type: initial?.type ?? 'PHC', state: initial?.state && STATES.includes(initial.state) ? initial.state : 'Lagos',
    lga: initial?.lga ?? '', ward: initial?.ward ?? '', frequency: initial?.frequency ?? 'weekly',
  });
  const [busy, setBusy] = useState(false);
  const fixed = Boolean(initial?.vitalink);
  const set = (patch: Partial<DirectSite>) => setSite((s) => ({ ...s, ...patch }));
  return (
    <div className="space-y-3">
      {fixed && <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">This hospital's name, type and state come from its VitaLink workspace. You can set its LGA, ward and expected reporting frequency.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <input className={`${inputClass} md:col-span-2`} placeholder="Facility name" disabled={fixed} value={site.name} onChange={(e) => set({ name: e.target.value })} />
        <Select value={site.type} disabled={fixed} onChange={(e) => set({ type: e.target.value as FacilityType })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        <Select value={site.frequency} onChange={(e) => set({ frequency: e.target.value as ReportingFrequency })}>{(Object.keys(FREQUENCIES) as ReportingFrequency[]).map((f) => <option key={f} value={f}>Reports {FREQUENCIES[f].toLowerCase()}</option>)}</Select>
        <Select value={site.state} disabled={fixed} onChange={(e) => set({ state: e.target.value })}>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <input className={inputClass} placeholder="LGA" value={site.lga} onChange={(e) => set({ lga: e.target.value })} />
        <input className={`${inputClass} md:col-span-2`} placeholder="Ward / community (optional)" value={site.ward} onChange={(e) => set({ ward: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button className={muted} onClick={onCancel}>Cancel</Button>
        <Button disabled={busy || !site.name.trim()} onClick={() => { setBusy(true); void onSave(site).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Register site'}</Button>
      </div>
    </div>
  );
}

function NetworkTab({ orgId, canEdit, isAdmin, onRequest }: { orgId: string; canEdit: boolean; isAdmin: boolean; onRequest: () => void }) {
  const [facilities, setFacilities] = useState<NetworkFacility[] | null>(null);
  const [editing, setEditing] = useState<NetworkFacility | 'new' | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh((n) => n + 1);

  useEffect(() => {
    let alive = true;
    getFacilityOverview(orgId).then((f) => { if (alive) setFacilities(f); }).catch((e) => { toast.error((e as Error).message); if (alive) setFacilities([]); });
    return () => { alive = false; };
  }, [orgId, refresh]);

  const sharing = (facilities ?? []).filter((f) => f.isActive && f.consentStatus === 'approved');
  const pending = (facilities ?? []).filter((f) => f.consentStatus === 'pending');
  const reportingWeek = sharing.filter((f) => reportedWithin(f, 7)).length;
  const casesWeek = sharing.reduce((n, f) => n + f.cases7d, 0);

  const save = async (site: DirectSite) => {
    try {
      if (editing === 'new') { await addFacility(orgId, site); toast.success(`${site.name} registered`); }
      else if (editing) { await updateFacility(editing.id, site); toast.success('Facility updated'); }
      setEditing(null); reload();
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (f: NetworkFacility) => {
    const question = f.vitalink
      ? f.consentStatus === 'approved' ? `Stop receiving data from ${f.name}? The hospital will see sharing as stopped; you can request it again later.` : `Withdraw the request to ${f.name}?`
      : `Remove ${f.name}? If it has sent reports it will be deactivated so its cases keep their facility.`;
    if (!window.confirm(question)) return;
    try {
      const result = await removeFacility(f.id);
      toast.success({ withdrawn: 'Request withdrawn', stopped: 'Sharing stopped', deactivated: 'Site deactivated', deleted: 'Site removed' }[result]);
      reload();
    } catch (e) { toast.error((e as Error).message); }
  };
  const reactivate = async (f: NetworkFacility) => {
    try { await updateFacility(f.id, { isActive: true }); toast.success('Site reactivated'); reload(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Facilities sharing</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{facilities ? sharing.length : '…'}</p></Card>
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Reported in the last 7 days</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{facilities ? `${reportingWeek} / ${sharing.length}` : '…'}</p></Card>
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Cases received (7 days)</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{facilities ? casesWeek : '…'}</p></Card>
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Requests awaiting approval</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{facilities ? pending.length : '…'}</p></Card>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {isAdmin && <Button className={muted} onClick={onRequest}><Network className="h-4 w-4" />Request a VitaLink hospital</Button>}
        {canEdit && <Button data-tour-id="facilities-add" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Add direct reporting site</Button>}
      </div>
      {facilities === null ? <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        : facilities.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No facilities yet. Ask VitaLink hospitals to share de-identified disease reports automatically, or register clinics and community sites that report through your officers.
          </div>
        ) : (
          <DataTable data-tour-id="facilities-table" headers={['Facility', 'State / LGA', 'Type', 'Connection', 'Last report', 'Cases (7d / total)', 'Symptom reports (7d)', '']}>
            {facilities.map((f) => {
              const c = connection(f);
              return (
                <tr key={f.id} className={f.isActive || f.consentStatus === 'pending' ? '' : 'opacity-60'}>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-slate-50">{f.name}</p><p className="text-xs text-slate-500">{f.vitalink ? 'VitaLink hospital · automatic' : `Direct site · ${FREQUENCIES[f.frequency].toLowerCase()}`}</p></td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{f.state}{f.lga ? ` / ${f.lga}` : ''}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{f.type}</td>
                  <td className="px-4 py-3"><Badge tone={c.tone}>{c.label}</Badge></td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{reporting(f)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{f.cases7d} / {f.casesTotal}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{f.vitalink ? f.encounters7d : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && f.isActive && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={() => setEditing(f)}>Edit</Button>}
                      {canEdit && !f.vitalink && !f.isActive && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={() => void reactivate(f)}>Reactivate</Button>}
                      {isAdmin && f.vitalink && (f.consentStatus === 'declined' || f.consentStatus === 'revoked') && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={onRequest}>Ask again</Button>}
                      {isAdmin && (f.isActive || f.consentStatus === 'pending') && <Button className={`${muted} px-3 py-1.5 text-xs text-red-600`} onClick={() => void remove(f)}>{f.vitalink ? (f.consentStatus === 'pending' ? 'Withdraw' : 'Stop') : 'Remove'}</Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      {editing && (
        <Modal title={editing === 'new' ? 'Register a direct reporting site' : `Edit ${editing.name}`} open onClose={() => setEditing(null)}>
          <SiteForm initial={editing === 'new' ? undefined : editing} onSave={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RequestTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VitalinkFacility[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      searchVitalinkFacilities(orgId, query).then((r) => { if (alive) setResults(r); }).catch(() => { if (alive) setResults([]); });
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [orgId, query, refresh]);

  const request = async (f: VitalinkFacility) => {
    setBusy(f.id);
    try { await requestFacilityLink(orgId, f.id); toast.success(`Request sent to ${f.name}. Its admins are notified in VitaLink.`); setRefresh((n) => n + 1); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const status: Record<NonNullable<VitalinkFacility['linkStatus']>, string> = { pending: 'Request sent', approved: 'Sharing', declined: 'Declined', revoked: 'Stopped' };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-bold text-slate-950 dark:text-slate-50">Request data from VitaLink hospitals</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Hospitals using VitaLink can share notifiable disease reports and daily symptom counts with you automatically. They only share de-identified data
          (disease, status, age group, sex, location, symptoms), and their admins must approve each request in VitaLink.
        </p>
        <div className="relative mt-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} w-full pl-9`} placeholder="Search hospitals by name or state" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </Card>
      {results === null ? <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        : results.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">No VitaLink hospitals match.</p>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {results.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><Building2 className="h-5 w-5" /></div>
                  <div className="min-w-0"><p className="truncate font-semibold text-slate-950 dark:text-slate-50">{f.name}</p><p className="text-xs text-slate-500">{f.state ?? 'Nigeria'} · {f.type}</p></div>
                </div>
                {f.linkStatus === 'approved' || f.linkStatus === 'pending'
                  ? <Badge tone={f.linkStatus === 'approved' ? 'low' : 'moderate'}>{status[f.linkStatus]}</Badge>
                  : isAdmin
                    ? <Button className="px-3 py-1.5 text-xs" disabled={busy === f.id} onClick={() => void request(f)}><Send className="h-3.5 w-3.5" />{f.linkStatus ? 'Ask again' : 'Request data'}</Button>
                    : <span className="text-xs text-slate-500">{f.linkStatus ? status[f.linkStatus] : 'Admins can request'}</span>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ApiTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [sources, setSources] = useState<ApiSource[] | null>(null);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { listApiSources(orgId).then(setSources).catch(() => setSources([])); }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) { toast.error('Name the system the key is for'); return; }
    setBusy(true);
    try { const { key } = await createApiKey(orgId, name.trim()); setNewKey(key); setName(''); load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const revoke = async (s: ApiSource) => {
    if (!window.confirm(`Revoke the key for ${s.name}? It stops working immediately.`)) return;
    try { await revokeApiKey(s.id); toast.success('Key revoked'); load(); } catch (e) { toast.error((e as Error).message); }
  };
  const sample = `curl -X POST ${INGEST_URL} \\
  -H "Authorization: Bearer ${newKey ?? 'vlsk_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{ "cases": [ { "external_id": "LAB-2026-0042", "disease": "cholera",
        "status": "confirmed", "lab_confirmed": true, "age": 34, "sex": "female",
        "state": "Borno", "lga": "Maiduguri", "report_date": "2026-10-27",
        "symptoms": ["watery diarrhoea"] } ] }'`;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-bold text-slate-950 dark:text-slate-50">Partner systems</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Laboratory systems, DHIS2 bridges and other EMRs can send case reports straight into your registry. Each system gets its own key.
          Accepted: VitaLink's simple JSON (below) or a FHIR R4 Bundle with Condition and Patient resources. Names, phone numbers and addresses are dropped on arrival.
        </p>
        <div className="mt-3 flex gap-2"><input className={`${inputClass} flex-1 font-mono text-xs`} readOnly value={INGEST_URL} /><Button className={muted} onClick={() => copy(INGEST_URL)}><Copy className="h-4 w-4" /></Button></div>
        {isAdmin && (
          <div className="mt-3 flex gap-2">
            <input className={`${inputClass} flex-1`} placeholder="System name, e.g. State public health laboratory" value={name} onChange={(e) => setName(e.target.value)} />
            <Button disabled={busy} onClick={() => void create()}><KeyRound className="h-4 w-4" />Create key</Button>
          </div>
        )}
        {newKey && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Copy this key now. It won't be shown again.</p>
            <div className="mt-2 flex gap-2"><input className={`${inputClass} flex-1 font-mono text-xs`} readOnly value={newKey} /><Button onClick={() => copy(newKey)}><Copy className="h-4 w-4" />Copy</Button></div>
          </div>
        )}
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{sample}</pre>
      </Card>
      {sources === null ? null : sources.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">No partner systems connected yet.</p>
      ) : (
        <DataTable headers={['System', 'Key', 'Records received', 'Last received', 'Created', 'Status', '']}>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{s.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.keyPrefix}…</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.recordsReceived.toLocaleString()}</td>
              <td className="px-4 py-3 text-slate-500">{s.lastReceivedAt ? formatDistanceToNow(new Date(s.lastReceivedAt), { addSuffix: true }) : 'Nothing yet'}</td>
              <td className="px-4 py-3 text-slate-500">{format(new Date(s.createdAt), 'd MMM yyyy')}</td>
              <td className="px-4 py-3"><Badge tone={s.isActive ? 'low' : 'high'}>{s.isActive ? 'Active' : 'Revoked'}</Badge></td>
              <td className="px-4 py-3">{isAdmin && s.isActive && <Button className={`${muted} px-3 py-1.5 text-xs text-red-600`} onClick={() => void revoke(s)}>Revoke</Button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LiveFacilities() {
  const { activeOrganization, me } = useSentinelStore();
  const [tab, setTab] = useState<Tab>('network');
  const orgId = activeOrganization?.id;
  const isAdmin = me?.role === 'admin';
  const canEdit = canManageOutbreaks(me?.role);
  if (!orgId) return null;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'network', label: 'Reporting network' }, { id: 'request', label: 'Request VitaLink hospitals' }, { id: 'api', label: 'Partner systems (API)' },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Reporting Network</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Where your surveillance data comes from: VitaLink hospitals, direct reporting sites and partner systems.</p>
      </div>
      <div data-tour-id="facilities-tabs" className="flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.id ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'network' && <NetworkTab orgId={orgId} canEdit={canEdit} isAdmin={isAdmin} onRequest={() => setTab('request')} />}
      {tab === 'request' && <RequestTab orgId={orgId} isAdmin={isAdmin} />}
      {tab === 'api' && <ApiTab orgId={orgId} isAdmin={isAdmin} />}
    </div>
  );
}
