import { useEffect, useState } from 'react';
import { AlertTriangle, Building2, ClipboardList, Inbox, Loader2, Mail } from 'lucide-react';
import { getInbox, markInboxSeen, type InboxItem } from '@/lib/supabase/sentinel';
import { useSentinelStore } from '@/store/useSentinelStore';
import { HeaderPopover } from './HeaderPopover';
import { timeAgo } from './timeAgo';

const kindIcon = { case: ClipboardList, outbreak: AlertTriangle, facility: Building2 };

/** Mail: activity from colleagues, hospitals and partner feeds since you last looked. */
export function InboxMenu({ live }: { live: boolean }) {
  const { activeOrganization, navigate } = useSentinelStore();
  const orgId = live ? activeOrganization?.id : undefined;
  const [data, setData] = useState<{ items: InboxItem[]; unread: number; now: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const load = () => getInbox(orgId).then((inbox) => { if (alive) { setData({ ...inbox, now: Date.now() }); setError(''); } }).catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load activity.'); });
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [orgId]);

  // Opening shows what's new (still highlighted), then marks it seen.
  const onOpenChange = (open: boolean) => {
    if (!orgId) return;
    if (open) {
      getInbox(orgId).then((inbox) => {
        setData({ ...inbox, now: Date.now() });
        if (inbox.unread > 0) void markInboxSeen(orgId).catch(() => undefined);
      }).catch(() => undefined);
    } else {
      setData((current) => current && { ...current, unread: 0, items: current.items.map((item) => ({ ...item, unread: false })) });
    }
  };

  const open = (item: InboxItem) => {
    if (item.kind === 'case') navigate('cases', item.targetId);
    else if (item.kind === 'outbreak') navigate('outbreaks', item.targetId);
    else navigate('facilities');
  };

  return <HeaderPopover label="Activity inbox" tourId="inbox" trigger={<Mail className="h-[18px] w-[18px]" />} badge={(data?.unread ?? 0) > 0} onOpenChange={onOpenChange} panelClassName="w-[min(92vw,400px)]">
    {(close) => <>
      <div className="px-5 pb-3 pt-4"><p className="text-sm font-semibold text-slate-950 dark:text-white">Activity</p><p className="text-xs text-slate-500 dark:text-slate-400">{live ? (data?.unread ? `${data.unread} new since you last checked` : 'Case reports, outbreak updates and facility responses') : 'Available with the live backend'}</p></div>
      <div className="max-h-[400px] overflow-y-auto px-2 pb-2">
        {live && !data && !error && <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {error && <p className="px-4 py-6 text-center text-sm text-rose-500">{error}</p>}
        {data && data.items.length === 0 && <div className="px-4 py-10 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-900/5 text-slate-500 dark:bg-white/10 dark:text-slate-300"><Inbox className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Nothing new</p><p className="text-xs text-slate-500 dark:text-slate-400">Reports from your team and partner hospitals show up here.</p></div>}
        {data?.items.map((item) => {
          const Icon = kindIcon[item.kind];
          return <button key={`${item.kind}-${item.id}`} type="button" onClick={() => { close(); open(item); }} className="flex w-full gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.06]">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.unread ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-slate-900/5 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}><Icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${item.unread ? 'font-semibold text-slate-950 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200'}`}>{item.title}</span>
              {item.detail && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.detail}</span>}
              <span className="mt-0.5 block text-[11px] text-slate-400">{item.actor ?? 'Sentinel'} · {timeAgo(item.at, data.now)}</span>
            </span>
            {item.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
          </button>;
        })}
      </div>
    </>}
  </HeaderPopover>;
}
