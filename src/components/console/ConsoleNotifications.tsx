// Console notification feed (everything that happens across VitaLink) and the
// settings for email alerts and the support contact details customers see.
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Building2, CheckCheck, CreditCard, LifeBuoy, Mail, Package, RefreshCw, Repeat, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  EVENT_CATEGORIES, getAlertPrefs, getOutboxStatus, listFeed, markFeedRead, saveAlertPrefs, saveSupportContact, subscribeToEvents,
  type AlertPrefs, type EventCategory, type OutboxStatus, type PlatformEvent,
} from '@/lib/supabase/console';
import { getSupportContact, type SupportContact } from '@/lib/supabase/support';
import { timeAgo } from '@/lib/timeAgo';
import { errorText, naira } from './consoleFormat';

const CATEGORY_ICON: Record<EventCategory, React.ElementType> = {
  payments: CreditCard, orders: Package, subscriptions: Repeat, signups: UserPlus, support: LifeBuoy,
};
const CATEGORY_TONE: Record<EventCategory, string> = {
  payments: 'bg-emerald-100 text-emerald-700', orders: 'bg-amber-100 text-amber-700', subscriptions: 'bg-sky-100 text-sky-700',
  signups: 'bg-violet-100 text-violet-700', support: 'bg-rose-100 text-rose-700',
};
const PAGE = 50;

export function NotificationsFeed({ onOpenWorkspace, onOpenTicket, onRead }: {
  onOpenWorkspace: (organizationId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  onRead: () => void;
}) {
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [events, setEvents] = useState<PlatformEvent[] | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    listFeed({ limit: PAGE, category: category === 'all' ? undefined : category })
      .then((result) => { setEvents(result.events); setMore(result.events.length === PAGE); setLastReadAt((current) => current ?? result.lastReadAt); })
      .catch((error) => { toast.error(errorText(error, 'Could not load notifications')); setEvents([]); });
  }, [category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToEvents(load), [load]);
  // Opening the feed marks it read (new ones stay highlighted until the next visit).
  useEffect(() => { markFeedRead().then(onRead).catch(() => undefined); }, [onRead]);

  const loadMore = async () => {
    const last = events?.[events.length - 1];
    if (!last) return;
    try {
      const result = await listFeed({ limit: PAGE, before: last.at, category: category === 'all' ? undefined : category });
      setEvents((list) => {
        const seen = new Set((list ?? []).map((e) => e.id));
        return [...(list ?? []), ...result.events.filter((e) => !seen.has(e.id))];
      });
      setMore(result.events.length === PAGE);
    } catch (error) {
      toast.error(errorText(error, 'Could not load more'));
    }
  };

  const isNew = (event: PlatformEvent) => lastReadAt !== null && new Date(event.at) > new Date(lastReadAt);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', ...EVENT_CATEGORIES.map((c) => c.id)] as Array<EventCategory | 'all'>).map((id) => (
          <button key={id} type="button" onClick={() => setCategory(id)}
            className={cn('rounded-full px-3 py-1 text-xs', category === id ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700')}>
            {id === 'all' ? 'Everything' : EVENT_CATEGORIES.find((c) => c.id === id)?.label}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {events === null && <p className="p-4 text-sm text-slate-500">Loading...</p>}
        {events?.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nothing yet. Payments, sign-ups, plan changes, card orders and support messages will show up here as they happen.</p>}
        {events?.map((event) => {
          const Icon = CATEGORY_ICON[event.category];
          return (
            <div key={event.id} className={cn('flex gap-3 border-t border-slate-100 px-4 py-3 first:border-0 dark:border-slate-800', isNew(event) && 'bg-violet-50/60 dark:bg-violet-500/5')}>
              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', CATEGORY_TONE[event.category])}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{event.title}</p>
                {event.body && <p className="whitespace-pre-line break-words text-xs text-slate-500">{event.body}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span title={new Date(event.at).toLocaleString('en-NG')}>{timeAgo(event.at)}</span>
                  {event.amount !== null && <span className="font-medium text-emerald-700">{naira(event.amount)}</span>}
                  {event.actorEmail && <span>by {event.actorEmail}</span>}
                  {event.organizationId && (
                    <button type="button" onClick={() => onOpenWorkspace(event.organizationId as string)} className="flex items-center gap-1 text-violet-700 hover:underline dark:text-violet-300">
                      <Building2 className="h-3 w-3" />{event.organizationName ?? 'Workspace'}
                    </button>
                  )}
                  {event.ticketId && (
                    <button type="button" onClick={() => onOpenTicket(event.ticketId as string)} className="flex items-center gap-1 text-violet-700 hover:underline dark:text-violet-300">
                      <LifeBuoy className="h-3 w-3" />Open conversation
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {more && <div className="text-center"><Button variant="outline" size="sm" onClick={() => void loadMore()}>Load older</Button></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ConsoleSettings() {
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [status, setStatus] = useState<OutboxStatus | null>(null);
  const [contact, setContact] = useState<SupportContact | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    getAlertPrefs().then(setPrefs).catch((error) => toast.error(errorText(error, 'Could not load your alert settings')));
    getOutboxStatus().then(setStatus).catch(() => undefined);
    getSupportContact().then(setContact).catch(() => undefined);
  }, []);

  const toggleCategory = (id: EventCategory) => setPrefs((p) => p && ({
    ...p, categories: p.categories.includes(id) ? p.categories.filter((c) => c !== id) : [...p.categories, id],
  }));

  const savePrefs = async () => {
    if (!prefs) return;
    setSavingPrefs(true);
    try { await saveAlertPrefs(prefs); toast.success('Email alerts saved'); }
    catch (error) { toast.error(errorText(error, 'Could not save')); }
    finally { setSavingPrefs(false); }
  };
  const saveContact = async () => {
    if (!contact) return;
    setSavingContact(true);
    try { await saveSupportContact(contact); toast.success('Support contact details saved'); }
    catch (error) { toast.error(errorText(error, 'Could not save')); }
    finally { setSavingContact(false); }
  };

  const emailBroken = status && status.pending > 0 && status.lastError;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-violet-600" />Email alerts</h2>
          <p className="text-sm text-slate-500">Sent to {prefs?.email ?? 'your admin email'} as things happen. Each admin chooses their own.</p>
        </div>
        {status && (
          <div className={cn('rounded-lg p-3 text-xs', emailBroken ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
            <p className="flex items-center gap-1 font-medium"><Mail className="h-3.5 w-3.5" />
              {emailBroken ? `${status.pending} email${status.pending === 1 ? '' : 's'} waiting to send` : 'Email delivery'}
            </p>
            {emailBroken ? <p className="mt-1">{status.lastError}</p> : (
              <p className="mt-1">{status.sent24h} sent in the last 24h{status.lastSentAt ? ` · last ${timeAgo(status.lastSentAt)}` : ''}{status.failed24h ? ` · ${status.failed24h} failed` : ''}{status.pending ? ` · ${status.pending} queued` : ''}</p>
            )}
          </div>
        )}
        {prefs ? (
          <>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span><b>Email me</b><br /><span className="text-xs text-slate-500">Turn off to only use the in-console feed.</span></span>
              <Switch checked={prefs.emailEnabled} onCheckedChange={(value) => setPrefs({ ...prefs, emailEnabled: value })} />
            </label>
            <div className={cn('space-y-2', !prefs.emailEnabled && 'pointer-events-none opacity-50')}>
              {EVENT_CATEGORIES.map((c) => (
                <label key={c.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-2.5 text-sm dark:border-slate-800">
                  <input type="checkbox" className="mt-1" checked={prefs.categories.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                  <span><b>{c.label}</b><br /><span className="text-xs text-slate-500">{c.hint}</span></span>
                </label>
              ))}
              <label className="flex items-start gap-3 p-1 text-sm">
                <input type="checkbox" className="mt-1" checked={prefs.includeOwnActions} onChange={(e) => setPrefs({ ...prefs, includeOwnActions: e.target.checked })} />
                <span>Include things I did myself<br /><span className="text-xs text-slate-500">Useful while testing with your own workspace.</span></span>
              </label>
            </div>
            <Button onClick={() => void savePrefs()} disabled={savingPrefs}>{savingPrefs ? 'Saving...' : 'Save alerts'}</Button>
          </>
        ) : <p className="text-sm text-slate-500">Loading...</p>}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><LifeBuoy className="h-4 w-4 text-violet-600" />Support contact details</h2>
          <p className="text-sm text-slate-500">Shown on every workspace's Help & Support page. Leave a field empty to hide it.</p>
        </div>
        {contact ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void saveContact(); }}>
            <label className="block text-sm">Support email<Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="support@yourdomain.com" /></label>
            <label className="block text-sm">Phone<Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="+234..." /></label>
            <label className="block text-sm">WhatsApp number<Input value={contact.whatsapp} onChange={(e) => setContact({ ...contact, whatsapp: e.target.value })} placeholder="+234..." /></label>
            <label className="block text-sm">Hours<Input value={contact.hours} onChange={(e) => setContact({ ...contact, hours: e.target.value })} placeholder="e.g. Mon–Fri, 9am–6pm WAT" /></label>
            <Button type="submit" disabled={savingContact}>{savingContact ? 'Saving...' : 'Save contact details'}</Button>
          </form>
        ) : <p className="text-sm text-slate-500">Loading...</p>}
        <p className="flex items-start gap-1.5 text-xs text-slate-500"><CheckCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Card ordering settings (bank details, pickup, delivery fee) are under Card orders.</p>
      </section>
    </div>
  );
}
