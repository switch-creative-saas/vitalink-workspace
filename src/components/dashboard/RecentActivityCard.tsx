// Live workspace activity feed for the dashboard (Supabase mode).
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertCircle, BadgeDollarSign, CalendarPlus, CheckCircle2, CreditCard, FileText,
  FlaskConical, HeartPulse, NotebookPen, Pill, ShieldCheck, Stethoscope, UserCheck, UserPlus, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listRecentActivity, type ActivityKind, type DashboardActivity } from '@/lib/supabase/dashboard';
import { timeAgo } from '@/lib/timeAgo';

const STYLE: Record<ActivityKind, { icon: React.ElementType; color: string }> = {
  patient: { icon: UserPlus, color: 'bg-blue-500' },
  booking: { icon: CalendarPlus, color: 'bg-sky-500' },
  checkin: { icon: UserCheck, color: 'bg-indigo-500' },
  appointment: { icon: CheckCircle2, color: 'bg-green-500' },
  'lab-order': { icon: FlaskConical, color: 'bg-violet-400' },
  lab: { icon: FlaskConical, color: 'bg-purple-600' },
  alert: { icon: AlertCircle, color: 'bg-red-500' },
  prescription: { icon: Stethoscope, color: 'bg-teal-400' },
  pharmacy: { icon: Pill, color: 'bg-teal-600' },
  note: { icon: NotebookPen, color: 'bg-slate-600' },
  vitals: { icon: HeartPulse, color: 'bg-rose-500' },
  document: { icon: FileText, color: 'bg-cyan-600' },
  invoice: { icon: BadgeDollarSign, color: 'bg-amber-400' },
  billing: { icon: CreditCard, color: 'bg-amber-600' },
  claim: { icon: ShieldCheck, color: 'bg-orange-500' },
  staff: { icon: Users, color: 'bg-fuchsia-500' },
};

const FILTERS: Array<{ id: string; label: string; kinds: ActivityKind[] | null }> = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'visits', label: 'Patients & visits', kinds: ['patient', 'booking', 'checkin', 'appointment'] },
  { id: 'clinical', label: 'Clinical', kinds: ['lab-order', 'lab', 'alert', 'note', 'vitals', 'document'] },
  { id: 'pharmacy', label: 'Pharmacy', kinds: ['prescription', 'pharmacy'] },
  { id: 'billing', label: 'Billing', kinds: ['invoice', 'billing', 'claim'] },
  { id: 'staff', label: 'Staff', kinds: ['staff'] },
];

const PAGE = 20;
const activityKey = (item: DashboardActivity) => `${item.kind}|${item.at}|${item.message}`;

function openTarget(item: DashboardActivity) {
  if (item.switchId) {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { switchId: item.switchId } }));
  } else if (item.kind === 'staff') {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'human-resources' } }));
  }
}

function ActivityRow({ item, compact }: { item: DashboardActivity; compact?: boolean }) {
  const style = STYLE[item.kind] ?? { icon: Activity, color: 'bg-slate-500' };
  const Icon = style.icon;
  const clickable = Boolean(item.switchId) || item.kind === 'staff';
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => openTarget(item)}
      title={clickable ? (item.switchId ? 'Open patient record' : 'Open staff') : undefined}
      className={cn(
        'w-full flex items-start gap-3 rounded-lg text-left',
        compact ? 'p-0' : 'p-2',
        clickable ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer' : 'cursor-default',
      )}
    >
      <div className={cn('w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0', style.color)}>
        <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm text-slate-900 dark:text-slate-50 line-clamp-2 break-words">{item.message}</p>
        <p className="text-[10px] sm:text-xs text-gray-400" title={new Date(item.at).toLocaleString()}>
          {timeAgo(item.at)}{item.actor ? ` · ${item.actor}` : ''}
        </p>
      </div>
    </button>
  );
}

/** Dashboard card: latest events, refreshed whenever `refreshKey` changes; "View all" pages through history. */
export function RecentActivityCard({ organizationId, refreshKey }: { organizationId: string; refreshKey?: string }) {
  const [items, setItems] = useState<DashboardActivity[] | null>(null);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listRecentActivity(organizationId, 8)
      .then((rows) => { if (!cancelled) { setItems(rows); setError(''); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load activity'); });
    return () => { cancelled = true; };
  }, [organizationId, refreshKey]);

  // Keep "x min ago" honest between refreshes.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-50">Recent Activity</h2>
        {items && items.length > 0 && (
          <button type="button" onClick={() => setOpen(true)} className="text-xs sm:text-sm text-[#1E4ED8] hover:text-[#1E4ED8]/80 font-medium shrink-0">
            View all
          </button>
        )}
      </div>
      <div className="space-y-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!error && items === null && <p className="text-xs text-slate-600 dark:text-slate-400">Loading...</p>}
        {items?.length === 0 && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            No activity yet. Registrations, bookings, lab orders and results, prescriptions, dispensing, invoices and payments appear here.
          </p>
        )}
        {items?.map((item, index) => <ActivityRow key={`${item.at}-${index}`} item={item} compact />)}
      </div>
      <ActivityHistoryDialog open={open} onOpenChange={setOpen} organizationId={organizationId} />
    </div>
  );
}

function ActivityHistoryDialog({ open, onOpenChange, organizationId }: { open: boolean; onOpenChange: (open: boolean) => void; organizationId: string }) {
  const [items, setItems] = useState<DashboardActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState('all');

  // The cursor is inclusive (events can share a timestamp), so drop rows already shown.
  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listRecentActivity(organizationId, PAGE, items[items.length - 1]?.at);
      const seen = new Set(items.map(activityKey));
      const fresh = page.filter((item) => !seen.has(activityKey(item)));
      setItems((prev) => [...prev, ...fresh]);
      setDone(page.length < PAGE || fresh.length === 0);
    } finally {
      setLoading(false);
    }
  }, [items, organizationId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listRecentActivity(organizationId, PAGE)
      .then((page) => { if (!cancelled) { setItems(page); setDone(page.length < PAGE); } })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [open, organizationId]);

  const kinds = FILTERS.find((item) => item.id === filter)?.kinds ?? null;
  const visible = kinds ? items.filter((item) => kinds.includes(item.kind)) : items;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle>Workspace activity</DialogTitle>
          <DialogDescription>Everything your role can see, newest first. Click an entry to open the patient.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn('rounded-full border px-3 py-1 text-xs', filter === item.id ? 'border-[#1E4ED8] bg-[#1E4ED8]/10 text-[#1E4ED8]' : 'border-gray-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {visible.map((item, index) => <ActivityRow key={`${item.at}-${index}`} item={item} />)}
          {!loading && visible.length === 0 && <p className="p-2 text-sm text-slate-500">Nothing here yet{done ? '' : ' in the loaded range; load more to look further back'}.</p>}
        </div>
        <div className="flex justify-center pt-2">
          {done ? (
            <span className="text-xs text-slate-400">That's everything.</span>
          ) : (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading...' : 'Load more'}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
