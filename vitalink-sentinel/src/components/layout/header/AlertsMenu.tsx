import { useCallback, useState } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listAlerts, setAlertStatus, type SentinelAlert } from '@/lib/supabase/sentinel';
import { useSentinelStore } from '@/store/useSentinelStore';
import { useOpenAlerts } from '@/hooks/useOpenAlerts';
import { HeaderPopover } from './HeaderPopover';
import { timeAgo } from './timeAgo';

const severityDot: Record<string, string> = { critical: 'bg-rose-500', high: 'bg-orange-500', moderate: 'bg-amber-400', low: 'bg-emerald-500' };

/** Bell: open alerts for the organisation, kept live, with acknowledge in place. */
export function AlertsMenu({ live }: { live: boolean }) {
  const { activeOrganization, me, navigate } = useSentinelStore();
  const orgId = live ? activeOrganization?.id : undefined;
  const goToAlerts = useCallback(() => navigate('alerts'), [navigate]);
  const openCount = useOpenAlerts(orgId, goToAlerts);
  const [data, setData] = useState<{ alerts: SentinelAlert[]; now: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canAct = me?.role === 'admin' || me?.role === 'officer' || me?.role === 'field_worker';

  const load = useCallback(() => {
    if (!orgId) return;
    listAlerts(orgId, { status: 'open' }, 6).then((alerts) => setData({ alerts, now: Date.now() })).catch(() => setData({ alerts: [], now: Date.now() }));
  }, [orgId]);

  const acknowledge = async (alert: SentinelAlert) => {
    setBusy(alert.id);
    try {
      await setAlertStatus(alert.id, 'acknowledged');
      setData((current) => current && { ...current, alerts: current.alerts.filter((a) => a.id !== alert.id) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not acknowledge the alert.');
    } finally { setBusy(null); }
  };

  return <HeaderPopover label="Alerts" trigger={<Bell className="h-[18px] w-[18px]" />} badge={live ? openCount : false} onOpenChange={(open) => { if (open) load(); }}>
    {(close) => <>
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <div><p className="text-sm font-semibold text-slate-950 dark:text-white">Alerts</p><p className="text-xs text-slate-500 dark:text-slate-400">{live ? `${openCount} open` : 'Available with the live backend'}</p></div>
        <button type="button" onClick={() => { close(); navigate('alerts'); }} className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10">View all</button>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-2 pb-2">
        {live && !data && <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {data && data.alerts.length === 0 && <div className="px-4 py-10 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">No open alerts</p><p className="text-xs text-slate-500 dark:text-slate-400">You're all caught up.</p></div>}
        {data?.alerts.map((alert) => <div key={alert.id} className="group flex gap-3 rounded-2xl px-3 py-2.5 hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.06]">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot[alert.severity] ?? 'bg-slate-400'}`} />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { close(); navigate('alerts'); }}>
            <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{alert.title}</p>
            <p className="mt-0.5 text-xs capitalize text-slate-500 dark:text-slate-400">{alert.severity} · {[alert.lga, alert.state].filter(Boolean).join(', ') || 'National'} · {timeAgo(alert.createdAt, data.now)}</p>
          </button>
          {canAct && <button type="button" disabled={busy === alert.id} onClick={() => void acknowledge(alert)} title="Acknowledge" className="h-8 shrink-0 self-center rounded-full border border-slate-900/10 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-950 hover:text-white disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white dark:hover:text-slate-950">{busy === alert.id ? '…' : 'Ack'}</button>}
        </div>)}
      </div>
    </>}
  </HeaderPopover>;
}
