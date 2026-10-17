// VitaLink Console sections (business data, plans, payments, admins, log). All
// data comes from console_* database functions that refuse anyone not on the
// platform-admin list. The shell around them is ConsoleApp.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, Download, LifeBuoy, RefreshCw, Search, StickyNote, Trash2, UserPlus, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  addAdmin, addNote, deleteNote, getOverview, getWorkspace, getWorkspaceCrm, listAdmins, listLog, listPayments, listWorkspaces,
  removeAdmin, setSubscription,
  type ConsoleLogEntry, type ConsoleOverview, type ConsolePayment, type ConsoleWorkspace, type PlatformAdmin,
  type SubscriptionAction, type WorkspaceCrm, type WorkspaceDetail,
} from '@/lib/supabase/console';
import { timeAgo } from '@/lib/timeAgo';
import { date, errorText, naira } from './consoleFormat';

export type ConsoleSection = 'inbox' | 'notifications' | 'overview' | 'workspaces' | 'payments' | 'orders' | 'admins' | 'log' | 'settings';
const PLANS = ['free', 'starter', 'growth', 'enterprise'];

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800', comped: 'bg-violet-100 text-violet-800', trialing: 'bg-sky-100 text-sky-800',
  past_due: 'bg-red-100 text-red-800', pending_payment: 'bg-amber-100 text-amber-800', cancelled: 'bg-slate-100 text-slate-600',
};

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: string | number; sub?: string; tone?: 'warn' | 'bad'; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn('rounded-xl border bg-white p-4 text-left shadow-sm disabled:cursor-default dark:bg-slate-900',
        tone === 'bad' ? 'border-red-200' : tone === 'warn' ? 'border-amber-200' : 'border-slate-200 dark:border-slate-700', onClick && 'hover:border-violet-300')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </button>
  );
}

export function OverviewTab({ onOpenTab }: { onOpenTab: (section: ConsoleSection) => void }) {
  const [data, setData] = useState<ConsoleOverview | null>(null);
  const load = useCallback(() => { getOverview().then(setData).catch((error) => toast.error(errorText(error, 'Could not load the overview'))); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-sm text-slate-500">Loading...</p>;
  const change = data.revenueLastMonth ? Math.round(((data.revenueThisMonth - data.revenueLastMonth) / data.revenueLastMonth) * 100) : null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={load}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue this month" value={naira(data.revenueThisMonth)} sub={change === null ? `${naira(data.revenueLastMonth)} last month` : `${change >= 0 ? '+' : ''}${change}% vs last month`} onClick={() => onOpenTab('payments')} />
        <Stat label="Monthly recurring revenue" value={naira(data.mrr)} sub={`${data.paying} paying workspace${data.paying === 1 ? '' : 's'}`} />
        <Stat label="Workspaces" value={data.workspaces} sub={`+${data.workspacesNewThisMonth} this month`} onClick={() => onOpenTab('workspaces')} />
        <Stat label="Users" value={data.users} sub={`+${data.usersNewThisMonth} this month`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On trial" value={data.trialing} sub={`${data.trialsEnding7d} ending within 7 days`} tone={data.trialsEnding7d ? 'warn' : undefined} onClick={() => onOpenTab('workspaces')} />
        <Stat label="Past due" value={data.pastDue} sub={`${data.pendingPayment} awaiting first payment`} tone={data.pastDue ? 'bad' : undefined} onClick={() => onOpenTab('workspaces')} />
        <Stat label="Comped" value={data.comped} sub={`${data.free} on Free`} />
        <Stat label="Card orders to handle" value={data.cardOrdersToDispatch + data.cardOrdersAwaitingPayment}
          sub={`${data.cardOrdersToDispatch} to dispatch · ${data.cardOrdersAwaitingPayment} unpaid · ${data.cardOrdersInTransit} in transit`}
          tone={data.cardOrdersToDispatch ? 'warn' : undefined} onClick={() => onOpenTab('orders')} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Workspaces by plan in use</h3>
        <div className="mt-3 space-y-2">
          {data.plans.map((item) => (
            <div key={item.plan} className="flex items-center gap-3 text-sm">
              <span className="w-24 capitalize">{item.plan}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-2 rounded-full bg-violet-500" style={{ width: `${(item.count / Math.max(1, data.workspaces)) * 100}%` }} />
              </div>
              <span className="w-8 text-right">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function WorkspacesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ConsoleWorkspace[] | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      listWorkspaces(search.trim()).then(setRows).catch((error) => { toast.error(errorText(error, 'Could not load workspaces')); setRows([]); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const visible = useMemo(() => (rows ?? []).filter((row) => filter === 'all' || row.status === filter || (filter === 'free' && row.effectivePlan === 'free')), [rows, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, owner or contact email, state..." className="pl-9" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          {['all', 'active', 'trialing', 'comped', 'past_due', 'pending_payment', 'cancelled', 'free'].map((value) => <option key={value} value={value}>{value === 'all' ? 'All statuses' : value.replace('_', ' ')}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={!visible.length} onClick={() => downloadCsv('vitalink-workspaces.csv', visible.map((row) => ({
          name: row.name, owner: row.ownerEmail, contact_email: row.contactEmail, contact_phone: row.contactPhone, state: row.state,
          plan: row.planId, plan_in_use: row.effectivePlan, status: row.status, period_end: row.currentPeriodEnd, staff: row.staffCount,
          patients: row.patientCount, revenue_ngn: row.revenue, created: row.createdAt,
        })))}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr><th className="px-3 py-2">Workspace</th><th className="px-3 py-2">Owner / contact</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Renews / ends</th><th className="px-3 py-2">Staff</th><th className="px-3 py-2">Patients</th><th className="px-3 py-2">Revenue</th><th className="px-3 py-2">Joined</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Loading...</td></tr>}
            {rows && visible.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-slate-500">No workspaces match.</td></tr>}
            {visible.map((row) => (
              <tr key={row.id} onClick={() => onOpen(row.id)} className="cursor-pointer border-t border-slate-100 hover:bg-violet-50/50 dark:border-slate-800 dark:hover:bg-slate-800">
                <td className="px-3 py-2"><p className="font-medium text-slate-900 dark:text-slate-50">{row.name}</p><p className="text-xs text-slate-500">{row.organizationType}{row.state ? ` · ${row.state}` : ''}</p></td>
                <td className="px-3 py-2 text-xs"><p>{row.ownerEmail || '—'}</p><p className="text-slate-500">{[row.contactEmail, row.contactPhone].filter(Boolean).join(' · ')}</p></td>
                <td className="px-3 py-2"><span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[row.status] ?? 'bg-slate-100')}>{row.planName || row.planId} · {row.status.replace('_', ' ')}</span>{row.effectivePlan !== row.planId && <p className="mt-0.5 text-[11px] text-red-600">using {row.effectivePlan}</p>}</td>
                <td className="px-3 py-2 text-xs">{date(row.currentPeriodEnd)}</td>
                <td className="px-3 py-2">{row.staffCount}</td>
                <td className="px-3 py-2">{row.patientCount}</td>
                <td className="px-3 py-2">{naira(row.revenue)}</td>
                <td className="px-3 py-2 text-xs">{date(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function WorkspacePanel({ id, onBack, onOpenTicket }: { id: string; onBack: () => void; onOpenTicket: (ticketId: string) => void }) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [action, setAction] = useState<SubscriptionAction>('comp');
  const [planId, setPlanId] = useState('growth');
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getWorkspace(id).then(setDetail).catch((error) => toast.error(errorText(error, 'Could not load the workspace')));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    if (!reason.trim()) { toast.error('Add a short reason; it goes in the activity log.'); return; }
    setSaving(true);
    try {
      await setSubscription(id, action, { planId: action === 'comp' || action === 'trial' ? planId : undefined, days: action === 'trial' || action === 'extend' ? days : undefined, reason });
      toast.success('Subscription updated');
      setReason('');
      load();
    } catch (error) {
      toast.error(errorText(error, 'Could not update the subscription'));
    } finally {
      setSaving(false);
    }
  };

  if (!detail) return <p className="text-sm text-slate-500">Loading...</p>;
  const w = detail.workspace;
  const s = detail.subscription;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-violet-700"><ArrowLeft className="h-4 w-4" />All workspaces</button>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-lg font-bold">{String(w.name)}</h2>
          <p className="text-xs text-slate-500">{String(w.organization_type)} · {String(w.workspace_type)} · /{String(w.slug)} · joined {date(String(w.created_at))}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Owner</dt><dd>{String(w.owner_email ?? '—')}</dd></div>
            <div><dt className="text-xs text-slate-500">Contact</dt><dd>{[w.contact_email, w.contact_phone].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Address</dt><dd>{[w.address, w.state, w.country].filter(Boolean).join(', ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Website</dt><dd>{String(w.website ?? '') || '—'}</dd></div>
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Patients" value={detail.counts.patients} />
            <Stat label="Appointments (30d)" value={detail.counts.appointments30d} />
            <Stat label="Invoices (30d)" value={detail.counts.invoices30d} />
            <Stat label="Video visits (30d)" value={detail.counts.videoVisits30d} />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-sm font-semibold">Subscription</h3>
          {s ? (
            <div className="space-y-1 text-sm">
              <p><span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[s.status] ?? 'bg-slate-100')}>{s.planName} · {s.status.replace('_', ' ')}</span></p>
              <p className="text-xs text-slate-500">Using: <b>{s.effectivePlan}</b> · {s.billingCycle}{s.currentPeriodEnd ? ` · until ${date(s.currentPeriodEnd)}` : ''}</p>
              <p className="text-xs text-slate-500">{s.hasRecurring ? 'Auto-renewing on Paystack' : 'No automatic renewal'}{s.compedBy ? ` · comped by ${s.compedBy}` : ''}</p>
            </div>
          ) : <p className="text-sm text-slate-500">No subscription record.</p>}
          <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <select value={action} onChange={(e) => setAction(e.target.value as SubscriptionAction)} className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="comp">Comp a plan (no charge, until changed)</option>
              <option value="trial">Start a trial</option>
              <option value="extend">Extend trial / current period</option>
              <option value="free">Move to the Free plan</option>
            </select>
            {(action === 'comp' || action === 'trial') && (
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm capitalize dark:border-slate-700 dark:bg-slate-900">
                {PLANS.filter((plan) => plan !== 'free').map((plan) => <option key={plan} value={plan}>{plan}</option>)}
              </select>
            )}
            {(action === 'trial' || action === 'extend') && (
              <label className="flex items-center gap-2 text-sm">Days<Input type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} className="w-24" /></label>
            )}
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the activity log)" />
            {s?.hasRecurring && (action === 'comp' || action === 'free') && (
              <p className="flex gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Their Paystack auto-renewal keeps charging; cancel it in the Paystack dashboard.</p>
            )}
            <Button className="w-full" disabled={saving} onClick={() => void apply()}>{saving ? 'Saving...' : 'Apply'}</Button>
          </div>
        </section>
      </div>

      <CrmPanel organizationId={id} onOpenTicket={onOpenTicket} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold"><Users className="h-4 w-4" />Staff ({detail.members.length})</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Email</th><th className="py-1 pr-3">Role</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Joined</th><th className="py-1">Last sign-in</th></tr></thead>
            <tbody>{detail.members.map((m) => (
              <tr key={m.email} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1 pr-3">{m.name || '—'}</td><td className="py-1 pr-3">{m.email}</td><td className="py-1 pr-3">{m.role}</td><td className="py-1 pr-3">{m.status}</td><td className="py-1 pr-3">{date(m.joined)}</td><td className="py-1">{m.lastSignIn ? timeAgo(m.lastSignIn) : 'never'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-2 text-sm font-semibold">Subscription payments</h3>
          {detail.payments.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          {detail.payments.map((p) => (
            <div key={p.reference} className="flex justify-between border-t border-slate-100 py-1.5 text-sm first:border-0 dark:border-slate-800">
              <span>{date(p.paidAt ?? p.createdAt)} · {p.planId} ({p.billingCycle}){p.kind === 'renewal' ? ' renewal' : ''}{p.setupFee ? ' + setup' : ''}</span>
              <span className={p.status === 'success' ? '' : 'text-slate-400'}>{naira(p.amount)} · {p.status}</span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-2 text-sm font-semibold">VitaCard orders</h3>
          {detail.cardOrders.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          {detail.cardOrders.map((o) => (
            <div key={o.orderNumber} className="border-t border-slate-100 py-1.5 text-sm first:border-0 dark:border-slate-800">
              <div className="flex justify-between"><span>{o.orderNumber} · {o.quantity} cards</span><span>{naira(o.total)} · {o.status}</span></div>
              <p className="text-xs text-slate-500">{o.deliveryOption === 'delivery' ? o.deliveryAddress : 'Pickup'} · {o.contactName} {o.contactPhone}</p>
            </div>
          ))}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 text-sm font-semibold">Console actions on this workspace</h3>
        {detail.log.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        {detail.log.map((l, index) => (
          <p key={`${l.at}-${index}`} className="border-t border-slate-100 py-1.5 text-xs first:border-0 dark:border-slate-800">
            <b>{l.action}</b> by {l.actor} · {new Date(l.at).toLocaleString('en-NG')}{l.details.reason ? ` · “${String(l.details.reason)}”` : ''}
          </p>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TICKET_TONE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800', pending: 'bg-sky-100 text-sky-800', resolved: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-100 text-slate-600',
};

/** CRM: private notes, this customer's support tickets and everything that happened on their account. */
function CrmPanel({ organizationId, onOpenTicket }: { organizationId: string; onOpenTicket: (ticketId: string) => void }) {
  const [crm, setCrm] = useState<WorkspaceCrm | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    getWorkspaceCrm(organizationId).then(setCrm).catch((error) => toast.error(errorText(error, 'Could not load CRM notes')));
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try { await addNote(organizationId, note); setNote(''); load(); }
    catch (error) { toast.error(errorText(error, 'Could not save the note')); }
    finally { setSaving(false); }
  };
  const remove = async (noteId: string) => {
    if (!window.confirm('Delete this note?')) return;
    try { await deleteNote(noteId); load(); }
    catch (error) { toast.error(errorText(error, 'Could not delete the note')); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold"><StickyNote className="h-4 w-4" />Notes (VitaLink only)</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) void save(); }} className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Calls, promises, renewal plans, who to talk to..." />
          <Button size="sm" type="submit" disabled={saving || !note.trim()}>{saving ? 'Saving...' : 'Add note'}</Button>
        </form>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {crm?.notes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
          {crm?.notes.map((n) => (
            <div key={n.id} className="group rounded-lg bg-amber-50 p-2 text-sm dark:bg-amber-500/10">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{n.author} · {timeAgo(n.at)}</span>
                <button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => void remove(n.id)} aria-label="Delete note"><Trash2 className="h-3.5 w-3.5" /></button>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold"><LifeBuoy className="h-4 w-4" />Support tickets</h3>
        {crm?.tickets.length === 0 && <p className="text-sm text-slate-500">No tickets from this workspace.</p>}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {crm?.tickets.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpenTicket(t.id)} className="flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <span className="min-w-0">
                <span className={cn('block truncate', t.staffUnread && 'font-semibold')}>{t.subject}</span>
                <span className="text-[11px] text-slate-500">{t.number} · {timeAgo(t.lastMessageAt)}</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', TICKET_TONE[t.status])}>{t.status}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold"><Activity className="h-4 w-4" />Timeline</h3>
        {crm?.events.length === 0 && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {crm?.events.map((e) => (
            <div key={e.id} className="border-l-2 border-violet-200 pl-2 text-sm">
              <p>{e.title}</p>
              <p className="text-[11px] text-slate-500">{new Date(e.at).toLocaleString('en-NG')}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PaymentsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ConsolePayment[] | null>(null);
  const [kind, setKind] = useState<'all' | ConsolePayment['kind']>('all');
  useEffect(() => { listPayments().then(setRows).catch((error) => { toast.error(errorText(error, 'Could not load payments')); setRows([]); }); }, []);
  const visible = (rows ?? []).filter((row) => kind === 'all' || row.kind === kind);
  const received = visible.filter((row) => row.status === 'success').reduce((sum, row) => sum + row.amount, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <option value="all">All payments</option><option value="subscription">Subscriptions</option><option value="card_order">VitaCard orders</option>
        </select>
        <span className="text-sm text-slate-600">Received in this list: <b>{naira(received)}</b></span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={!visible.length} onClick={() => downloadCsv('vitalink-payments.csv', visible.map((row) => ({
          date: row.at, workspace: row.organizationName, type: row.kind, description: row.description, amount_ngn: row.amount, status: row.status, reference: row.reference,
        })))}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Workspace</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reference</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-3 py-4 text-slate-500">Loading...</td></tr>}
            {rows && visible.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-slate-500">No payments yet.</td></tr>}
            {visible.map((row) => (
              <tr key={`${row.kind}-${row.reference}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs">{row.at ? new Date(row.at).toLocaleString('en-NG') : '—'}</td>
                <td className="px-3 py-2"><button type="button" className="text-violet-700 hover:underline" onClick={() => onOpen(row.organizationId)}>{row.organizationName}</button></td>
                <td className="px-3 py-2">{row.description}</td>
                <td className="px-3 py-2">{naira(row.amount)}</td>
                <td className="px-3 py-2"><span className={cn('rounded-full px-2 py-0.5 text-xs', row.status === 'success' ? 'bg-emerald-100 text-emerald-800' : row.status === 'refund_due' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600')}>{row.status.replace('_', ' ')}</span></td>
                <td className="px-3 py-2 font-mono text-xs">{row.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AdminsTab() {
  const [rows, setRows] = useState<PlatformAdmin[] | null>(null);
  const [email, setEmail] = useState('');
  const load = useCallback(() => { listAdmins().then(setRows).catch((error) => toast.error(errorText(error, 'Could not load admins'))); }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    try { await addAdmin(email); toast.success(`${email} can now open the console`); setEmail(''); load(); }
    catch (error) { toast.error(errorText(error, 'Could not add the admin')); }
  };
  const remove = async (target: string) => {
    if (!window.confirm(`Remove ${target} from VitaLink platform admins?`)) return;
    try { await removeAdmin(target); toast.success(`${target} removed`); load(); }
    catch (error) { toast.error(errorText(error, 'Could not remove the admin')); }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
        Platform admins see every workspace's business data, can change plans and fulfil card orders. Only add VitaLink staff.
        Access needs a <b>verified</b> account with exactly this email; it takes effect the next time they sign in.
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@vitalink.africa" className="max-w-sm" />
        <Button type="submit" disabled={!email.trim()}><UserPlus className="mr-1 h-4 w-4" />Add admin</Button>
      </form>
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {rows === null && <p className="p-4 text-sm text-slate-500">Loading...</p>}
        {rows?.map((row) => (
          <div key={row.email} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 first:border-0 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium">{row.email}</p>
              <p className="text-xs text-slate-500">Added {date(row.addedAt)} · {row.hasAccount ? `last sign-in ${row.lastSignIn ? timeAgo(row.lastSignIn) : 'never'}` : 'no verified account yet'}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void remove(row.email)} aria-label={`Remove ${row.email}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LogTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ConsoleLogEntry[] | null>(null);
  useEffect(() => { listLog().then(setRows).catch((error) => { toast.error(errorText(error, 'Could not load the log')); setRows([]); }); }, []);
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {rows === null && <p className="p-4 text-sm text-slate-500">Loading...</p>}
      {rows?.length === 0 && <p className="p-4 text-sm text-slate-500">No console activity yet.</p>}
      {rows?.map((row) => (
        <div key={row.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 px-4 py-2.5 first:border-0 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-sm"><Activity className="mr-1 inline h-3.5 w-3.5 text-violet-600" /><b>{row.action}</b> · {row.actorEmail || 'system'}</p>
            <p className="break-all text-xs text-slate-500">{Object.entries(row.details).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ')}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {row.organizationId && <button type="button" className="text-violet-700 hover:underline" onClick={() => onOpen(row.organizationId as string)}>workspace</button>}
            {new Date(row.at).toLocaleString('en-NG')}
          </div>
        </div>
      ))}
    </div>
  );
}
