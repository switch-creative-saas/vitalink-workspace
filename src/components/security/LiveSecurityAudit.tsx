// Security & Audit for live workspaces: the real audit trail (who did what,
// from which IP and browser), real sign-in sessions that can be ended, and the
// two policies VitaLink enforces: idle sign-out and sign-in renewal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Download, Flag, History, LogIn, LogOut, Monitor, RefreshCw, Search, Shield, ShieldCheck, Smartphone, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { timeAgo } from '@/lib/timeAgo';
import {
  describeUserAgent, flagAuditEvent, getAuditFeed, getSecurityPolicy, listSessions, logSecurityEvent, revokeAllSessions, revokeSession, saveSecurityPolicy,
  type AuditEvent, type AuditFeed, type AuditFilters, type SecurityPolicy, type SignInSession,
} from '@/lib/supabase/security';

type Tab = 'logs' | 'sessions' | 'policy';
const PAGE = 50;
const SECURITY_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin', 'it-officer'];
const SELECT = 'h-10 rounded-md border border-input bg-background px-3 text-sm';
const ACTION_TONE: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700', UPDATE: 'bg-amber-100 text-amber-800', DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-slate-100 text-slate-700', LOGOUT: 'bg-slate-100 text-slate-700', EXPORT: 'bg-purple-100 text-purple-700', REVOKE: 'bg-red-100 text-red-700',
};
const RISK_TONE = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-800', low: 'bg-emerald-100 text-emerald-700' } as const;
const roleLabel = (role: string | null) => (role ? role.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '—');
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function LiveSecurityAudit() {
  const { organization, currentRole } = useAuth();
  const isSecurityStaff = SECURITY_ROLES.includes(currentRole);
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <div className="space-y-6 page-transition">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[#1E4ED8]">Security & Audit</h1>
        <p className="text-sm text-gray-500">
          {isSecurityStaff ? `Everything that changes in ${organization.name}, who did it and from where, plus sign-in sessions and security policy.` : 'Your own activity and sign-in sessions in this workspace.'}
        </p>
      </div>

      <div data-tour-id="audit-tabs" className="flex w-fit flex-wrap gap-1 rounded-xl border border-gray-100 bg-gray-100 p-1">
        {([
          { id: 'logs', label: 'Audit Log', icon: History },
          { id: 'sessions', label: 'Sessions', icon: Monitor },
          { id: 'policy', label: 'Security Policy', icon: Shield },
        ] as const).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium', tab === t.id ? 'bg-[#1E4ED8] text-white' : 'text-gray-600 hover:text-gray-900')}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'logs' && <AuditLogTab organizationId={organization.id} canFlag={isSecurityStaff} />}
      {tab === 'sessions' && <SessionsTab organizationId={organization.id} isSecurityStaff={isSecurityStaff} />}
      {tab === 'policy' && <PolicyTab organizationId={organization.id} canEdit={isSecurityStaff} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuditLogTab({ organizationId, canFlag }: { organizationId: string; canFlag: boolean }) {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [feed, setFeed] = useState<AuditFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [exporting, setExporting] = useState(false);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => { setOffset(0); setFilters((f) => ({ ...f, search })); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    getAuditFeed(organizationId, filters, PAGE, offset)
      .then((f) => { setFeed(f); setLoading(false); })
      .catch((error) => { toast.error(error instanceof Error ? error.message : 'Could not load the audit log'); setLoading(false); });
  }, [organizationId, filters, offset]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (patch: AuditFilters) => { setLoading(true); setOffset(0); setFilters((f) => ({ ...f, ...patch })); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await getAuditFeed(organizationId, filters, 500, 0);
      let rows = all.rows;
      for (let next = 500; next < Math.min(all.total, 5000); next += 500) rows = rows.concat((await getAuditFeed(organizationId, filters, 500, next)).rows);
      const header = ['Time (WAT)', 'User', 'Email', 'Role', 'Action', 'Module', 'Record', 'Record ID', 'Details', 'Risk', 'IP address', 'Device', 'Flagged'];
      const lines = rows.map((r) => [stamp(r.at), r.actorName, r.actorEmail, roleLabel(r.actorRole), r.action, r.module, r.entity, r.entityId, r.summary, r.risk, r.ip, describeUserAgent(r.userAgent).label, r.flagged ? 'yes' : ''].map(csvCell).join(','));
      const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `vitalink-audit-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(a.href);
      await logSecurityEvent('export', organizationId, { count: rows.length }).catch(() => undefined);
      toast.success(`Exported ${rows.length.toLocaleString()} events${all.total > 5000 ? ' (first 5,000)' : ''}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const stats = feed?.stats;
  const page = Math.floor(offset / PAGE) + 1;
  const pages = feed ? Math.max(1, Math.ceil(feed.total / PAGE)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Events" value={stats?.events} onClick={() => setFilter({ risk: undefined, action: undefined, flagged: undefined })} />
        <StatCard label="High risk" value={stats?.high} tone="bad" onClick={() => setFilter({ risk: 'high' })} />
        <StatCard label="Deletions" value={stats?.deletes} tone="warn" onClick={() => setFilter({ action: 'DELETE' })} />
        <StatCard label="Sign-ins" value={stats?.signIns} onClick={() => setFilter({ action: 'LOGIN' })} />
        <StatCard label="Flagged for review" value={stats?.flagged} tone="warn" onClick={() => setFilter({ flagged: true })} />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-10" placeholder="Search user, record, details or IP…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From" className="w-40" value={filters.from ?? ''} onChange={(e) => setFilter({ from: e.target.value || undefined })} />
          <span className="text-gray-400">–</span>
          <Input type="date" aria-label="To" className="w-40" value={filters.to ?? ''} onChange={(e) => setFilter({ to: e.target.value || undefined })} />
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void exportCsv()} disabled={exporting || !feed?.total}>
          <Download className="h-4 w-4" />{exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {feed?.canSeeAll && (
          <select aria-label="User" className={SELECT} value={filters.actor ?? 'all'} onChange={(e) => setFilter({ actor: e.target.value })}>
            <option value="all">All users</option>
            {feed.facets.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select aria-label="Module" className={SELECT} value={filters.module ?? 'all'} onChange={(e) => setFilter({ module: e.target.value })}>
          <option value="all">All modules</option>
          {feed?.facets.modules.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select aria-label="Action" className={SELECT} value={filters.action ?? 'all'} onChange={(e) => setFilter({ action: e.target.value })}>
          <option value="all">All actions</option>
          {feed?.facets.actions.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select aria-label="Risk" className={SELECT} value={filters.risk ?? 'all'} onChange={(e) => setFilter({ risk: e.target.value })}>
          <option value="all">All risk levels</option>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select aria-label="Flagged" className={SELECT} value={filters.flagged ? 'yes' : 'all'} onChange={(e) => setFilter({ flagged: e.target.value === 'yes' ? true : undefined })}>
          <option value="all">Flagged and unflagged</option>
          <option value="yes">Flagged only</option>
        </select>
      </div>
      {feed && !feed.canSeeAll && <p className="text-xs text-gray-500">You see your own activity. Admins and IT officers see the whole workspace.</p>}

      <div className="premium-card overflow-hidden">
        <div className="responsive-table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">What happened</th>
                <th className="px-4 py-3 font-medium">Device / IP</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading && !feed ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">Loading audit log…</td></tr>
              ) : feed?.rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No events match these filters.</td></tr>
              ) : feed?.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-gray-50 hover:bg-gray-50" onClick={() => setSelected(r)}>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="text-gray-900">{timeAgo(r.at)}</p>
                    <p className="text-xs text-gray-500">{stamp(r.at)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.actorName}</p>
                    <p className="text-xs text-gray-500">{roleLabel(r.actorRole)}</p>
                  </td>
                  <td className="px-4 py-3"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ACTION_TONE[r.action] ?? 'bg-blue-100 text-blue-700')}>{r.action}</span></td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{r.summary ?? `${r.action === 'CREATE' ? 'Created' : r.action === 'DELETE' ? 'Deleted' : 'Updated'} ${r.entity.replace(/_/g, ' ')}`}</p>
                    <p className="text-xs text-gray-500">{r.module}{r.entityId && r.entity !== 'security' ? ` · ${r.entityId.slice(0, 8)}` : ''}{r.flagged ? ' · ' : ''}{r.flagged && <span className="font-medium text-amber-700">Flagged</span>}</p>
                  </td>
                  <td className="px-4 py-3">
                    {r.userAgent || r.ip ? (
                      <>
                        <p className="text-gray-900">{describeUserAgent(r.userAgent).label}</p>
                        <p className="text-xs text-gray-500">{r.ip ?? '—'}</p>
                      </>
                    ) : <p className="text-xs text-gray-400">{r.actorId ? 'Not recorded' : 'System'}</p>}
                  </td>
                  <td className="px-4 py-3"><span className={cn('rounded-full px-2 py-0.5 text-xs capitalize', RISK_TONE[r.risk])}>{r.risk}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {feed && feed.total > PAGE && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
            <span>{feed.total.toLocaleString()} events · page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => { setLoading(true); setOffset(offset - PAGE); }}><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => { setLoading(true); setOffset(offset + PAGE); }}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">IP address and device are recorded for events from 26 Oct 2026 onwards.</p>

      <EventDialog key={selected?.id ?? 'none'} event={selected} canFlag={canFlag} onClose={() => setSelected(null)} onChanged={(e) => { setSelected(e); load(); }} />
    </div>
  );
}

function EventDialog({ event, canFlag, onClose, onChanged }: { event: AuditEvent | null; canFlag: boolean; onClose: () => void; onChanged: (e: AuditEvent) => void }) {
  const [note, setNote] = useState(event?.flagNote ?? '');
  const [busy, setBusy] = useState(false);
  if (!event) return null;
  const details = Object.entries(event.metadata ?? {}).filter(([k]) => k !== 'summary');

  const toggleFlag = async () => {
    setBusy(true);
    try {
      await flagAuditEvent(event.id, !event.flagged, note);
      toast.success(event.flagged ? 'Flag removed' : 'Event flagged for review');
      onChanged({ ...event, flagged: !event.flagged, flagNote: event.flagged ? null : note || null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the flag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{event.summary ?? `${event.action} ${event.entity.replace(/_/g, ' ')}`}</DialogTitle>
          <DialogDescription>{stamp(event.at)} WAT</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {([['User', event.actorName], ['Email', event.actorEmail], ['Role', roleLabel(event.actorRole)], ['Action', event.action], ['Module', event.module],
            ['Record', event.entity.replace(/_/g, ' ')], ['Record ID', event.entityId], ['Risk', event.risk], ['IP address', event.ip],
            ['Device', event.userAgent ? describeUserAgent(event.userAgent).label : null]] as Array<[string, string | null]>).map(([k, v]) => (
            <div key={k} className="min-w-0"><p className="text-xs text-gray-500">{k}</p><p className="truncate text-gray-900">{v || '—'}</p></div>
          ))}
        </div>
        {details.length > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
            {details.map(([k, v]) => <p key={k}><span className="text-gray-500">{k.replace(/_/g, ' ')}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</p>)}
          </div>
        )}
        {event.flagged && event.flagNote && <p className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-sm text-amber-800">Flag note: {event.flagNote}</p>}
        {canFlag && !event.flagged && <Input placeholder="Why is this suspicious? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
        <DialogFooter>
          {canFlag && (
            <Button variant="outline" disabled={busy} onClick={() => void toggleFlag()}>
              <Flag className="mr-2 h-4 w-4" />{event.flagged ? 'Remove flag' : 'Flag for review'}
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function SessionsTab({ organizationId, isSecurityStaff }: { organizationId: string; isSecurityStaff: boolean }) {
  const [sessions, setSessions] = useState<SignInSession[] | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'one'; session: SignInSession } | { kind: 'mine' | 'workspace' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listSessions(organizationId).then(setSessions).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load sessions'));
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => new Set((sessions ?? []).map((s) => s.userId)).size, [sessions]);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'one') {
        await revokeSession(organizationId, confirm.session.id);
        toast.success('Session ended');
      } else {
        const n = await revokeAllSessions(organizationId, confirm.kind);
        toast.success(`Ended ${n} session${n === 1 ? '' : 's'}`);
      }
      setConfirm(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not end the session');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {sessions ? `${sessions.length} signed-in session${sessions.length === 1 ? '' : 's'}${isSecurityStaff ? ` across ${people} ${people === 1 ? 'person' : 'people'}` : ''}` : 'Loading sessions…'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: 'mine' })}><LogOut className="mr-2 h-4 w-4" />Sign out my other devices</Button>
          {isSecurityStaff && (
            <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setConfirm({ kind: 'workspace' })}>
              <Trash2 className="mr-2 h-4 w-4" />End all sessions in workspace
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sessions?.map((s) => {
          const device = describeUserAgent(s.userAgent);
          const DeviceIcon = device.mobile ? Smartphone : Monitor;
          return (
            <div key={s.id} className="premium-card flex items-start justify-between gap-3 p-4">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1E4ED8]"><DeviceIcon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium text-gray-900">{device.label}</p>
                    {s.isCurrent && <span className="rounded-full bg-[#1E4ED8] px-2 py-0.5 text-[11px] text-white">This device</span>}
                    {s.mfa && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">2-step</span>}
                    {s.expiresByPolicy && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Past sign-in limit</span>}
                  </div>
                  {isSecurityStaff && <p className="truncate text-sm text-gray-600">{s.name} · {roleLabel(s.role)}</p>}
                  <p className="text-xs text-gray-500">IP {s.ip ?? 'unknown'} · signed in {timeAgo(s.createdAt)} · last active {timeAgo(s.lastActiveAt)}</p>
                </div>
              </div>
              {!s.isCurrent && (
                <Button size="sm" variant="outline" className="shrink-0 border-red-200 text-red-600 hover:bg-red-50" onClick={() => setConfirm({ kind: 'one', session: s })}>
                  End
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400">An ended session can't refresh its sign-in. A browser that is open at that moment loses access within the hour, when its current access token expires.</p>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'one' ? 'End this session?' : confirm?.kind === 'mine' ? 'Sign out your other devices?' : 'End every session in the workspace?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'one' ? `${describeUserAgent(confirm.session.userAgent).label}${isSecurityStaff ? ` for ${confirm.session.name}` : ''} will need to sign in again.`
                : confirm?.kind === 'mine' ? 'Every device you are signed in on, except this one, will need to sign in again.'
                : 'Everyone in this workspace, except you on this device, will need to sign in again. Use this after a suspected breach.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}>
              {confirm?.kind === 'one' ? 'End session' : 'End sessions'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

const IDLE_OPTIONS = [0, 15, 30, 60, 120, 240];
const DAY_OPTIONS = [1, 7, 14, 30, 60, 90];

function PolicyTab({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [saved, setSaved] = useState<SecurityPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSecurityPolicy(organizationId).then((p) => { setPolicy(p); setSaved(p); }).catch(() => undefined);
  }, [organizationId]);

  if (!policy) return <div className="premium-card p-8 text-center text-sm text-gray-500">Loading policy…</div>;
  const dirty = saved && (saved.idleTimeoutMinutes !== policy.idleTimeoutMinutes || saved.maxSessionDays !== policy.maxSessionDays);

  const save = async () => {
    setBusy(true);
    try { await saveSecurityPolicy(organizationId, policy); setSaved(policy); toast.success('Security policy saved. It applies from each person\'s next page load.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the policy'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="premium-card space-y-3 p-5">
          <div className="flex items-center gap-2"><LogOut className="h-4 w-4 text-gray-400" /><h3 className="font-semibold text-gray-900">Idle sign-out</h3></div>
          <p className="text-sm text-gray-500">Sign people out after this long without using VitaLink, so an unattended screen doesn't stay open on patient records. They get a one-minute warning.</p>
          <Label htmlFor="idle">Sign out after</Label>
          <select id="idle" className={cn(SELECT, 'w-full')} disabled={!canEdit} value={policy.idleTimeoutMinutes} onChange={(e) => setPolicy({ ...policy, idleTimeoutMinutes: Number(e.target.value) })}>
            {IDLE_OPTIONS.map((m) => <option key={m} value={m}>{m === 0 ? 'Never (off)' : m < 60 ? `${m} minutes idle` : `${m / 60} hour${m === 60 ? '' : 's'} idle`}</option>)}
          </select>
        </div>
        <div className="premium-card space-y-3 p-5">
          <div className="flex items-center gap-2"><LogIn className="h-4 w-4 text-gray-400" /><h3 className="font-semibold text-gray-900">Sign-in renewal</h3></div>
          <p className="text-sm text-gray-500">Even on a trusted device, everyone signs in again after this many days. Older sessions are ended automatically every night.</p>
          <Label htmlFor="days">Sign in again every</Label>
          <select id="days" className={cn(SELECT, 'w-full')} disabled={!canEdit} value={policy.maxSessionDays} onChange={(e) => setPolicy({ ...policy, maxSessionDays: Number(e.target.value) })}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? 'Every day' : `${d} days`}</option>)}
          </select>
        </div>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button className="bg-[#1E4ED8] text-white hover:bg-[#1a43bd]" disabled={busy || !dirty} onClick={() => void save()}><ShieldCheck className="mr-2 h-4 w-4" />Save policy</Button>
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </div>
      ) : <p className="text-xs text-gray-500">Only admins and IT officers can change the security policy.</p>}
      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Every change to records, staff access and these settings is written to the audit log automatically, with the person, time, IP address and device.</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, onClick }: { label: string; value: number | undefined; tone?: 'warn' | 'bad'; onClick: () => void }) {
  return (
    <button onClick={onClick} className="premium-card p-4 text-left hover:ring-1 hover:ring-blue-200">
      <p className={cn('text-2xl font-semibold', tone === 'bad' && value ? 'text-red-600' : tone === 'warn' && value ? 'text-amber-600' : 'text-[#1E4ED8]')}>{value ?? '—'}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </button>
  );
}
