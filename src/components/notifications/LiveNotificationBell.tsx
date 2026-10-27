// The header bell for live workspaces: real notifications raised by the
// database (appointments, lab, network, billing, support, security), arriving
// instantly over Supabase Realtime.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Bell, Building2, CalendarClock, CheckCircle, CreditCard, FlaskConical, LifeBuoy, Settings, Shield, Trash2, UserPlus, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useMyProfile } from '@/hooks/useMyProfile';
import { timeAgo } from '@/lib/timeAgo';
import {
  clearReadNotifications, listNotifications, markNotificationsRead, subscribeToNotifications, type AppNotification, type NotificationKind,
} from '@/lib/supabase/profile';

const KIND: Record<NotificationKind, { icon: React.ElementType; tone: string }> = {
  appointments: { icon: CalendarClock, tone: 'bg-blue-100 text-blue-600' },
  lab: { icon: FlaskConical, tone: 'bg-purple-100 text-purple-600' },
  network: { icon: Building2, tone: 'bg-indigo-100 text-indigo-600' },
  staff: { icon: UserPlus, tone: 'bg-green-100 text-green-600' },
  billing: { icon: CreditCard, tone: 'bg-amber-100 text-amber-700' },
  support: { icon: LifeBuoy, tone: 'bg-sky-100 text-sky-600' },
  security: { icon: Shield, tone: 'bg-red-100 text-red-600' },
  system: { icon: CheckCircle, tone: 'bg-gray-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
};
const PAGE = 30;

export function LiveNotificationBell() {
  const { organization } = useAuth();
  const profile = useMyProfile();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.readAt).length;

  const load = useCallback(() => {
    listNotifications(organization.id, PAGE).then((rows) => { setItems(rows); setHasMore(rows.length === PAGE); }).catch(() => undefined);
  }, [organization.id]);
  useEffect(() => { load(); }, [load]);

  // New notifications arrive live; high-priority ones also pop a toast.
  useEffect(() => {
    if (!profile?.id) return;
    return subscribeToNotifications(profile.id, (n) => {
      setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
      if (n.priority === 'high') toast.warning(n.title, { description: n.body });
    });
  }, [profile?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markRead = (ids: number[]) => {
    if (!ids.length) return;
    const at = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? at } : n)));
    markNotificationsRead(ids).catch(() => load());
  };
  const openItem = (n: AppNotification) => {
    markRead(n.readAt ? [] : [n.id]);
    setOpen(false);
    if (n.link) window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: n.link } }));
  };
  const loadOlder = () => {
    const last = items[items.length - 1];
    if (!last) return;
    listNotifications(organization.id, PAGE, last.createdAt).then((rows) => { setItems((prev) => [...prev, ...rows]); setHasMore(rows.length === PAGE); }).catch(() => undefined);
  };
  const clearRead = () => {
    setItems((prev) => prev.filter((n) => !n.readAt));
    clearReadNotifications(organization.id).catch(() => load());
  };

  return (
    <div ref={panelRef} className="relative">
      <button onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className={cn('relative rounded-xl p-2.5 transition-colors', open ? 'bg-[#1E4ED8]/10 text-[#1E4ED8]' : 'text-slate-600 hover:bg-gray-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50')}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-3 w-[min(100vw-2rem,24rem)] overflow-hidden rounded-2xl border border-gray-100/50 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-slate-700">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">Notifications</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">{unread ? `${unread} unread` : 'All caught up'}</p>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={() => markRead(items.filter((n) => !n.readAt).map((n) => n.id))} className="rounded-lg px-2 py-1 text-xs font-medium text-[#1E4ED8] hover:bg-[#1E4ED8]/5">Mark all read</button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No notifications yet</p>
                <p className="mt-1 text-xs text-slate-400">Appointments, lab results, referrals and replies show up here.</p>
              </div>
            ) : (
              <>
                {items.map((n) => {
                  const k = KIND[n.kind] ?? KIND.system;
                  const Icon = n.priority === 'high' && !n.readAt ? AlertTriangle : k.icon;
                  return (
                    <button key={n.id} onClick={() => openItem(n)}
                      className={cn('flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left',
                        !n.readAt ? (n.priority === 'high' ? 'border-l-red-500 bg-red-50/40 dark:bg-red-950/20' : 'border-l-[#1E4ED8] bg-[#1E4ED8]/[0.03]') : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-slate-800')}>
                      <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', n.priority === 'high' && !n.readAt ? 'bg-red-100 text-red-600' : k.tone)}><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <p className={cn('min-w-0 truncate text-sm font-medium', !n.readAt ? 'text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-400')}>{n.title}</p>
                          {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-[#1E4ED8]" />}
                        </div>
                        {n.body && <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-gray-400">{timeAgo(n.createdAt)}</p>
                      </div>
                    </button>
                  );
                })}
                {hasMore && <button onClick={loadOlder} className="w-full py-2 text-xs text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-800">Load older</button>}
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900/50">
            <button onClick={clearRead} disabled={!items.some((n) => n.readAt)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-slate-800">
              <Trash2 className="h-3 w-3" />Clear read
            </button>
            <button onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: '/settings?tab=notifications' } })); }}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[#1E4ED8] hover:bg-[#1E4ED8]/5">
              <Settings className="h-3 w-3" />Notification settings<ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
