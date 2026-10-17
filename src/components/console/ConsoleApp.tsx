// The VitaLink Console as its own app at /console, separate from any workspace.
// It has its own sign-in; only accounts on the platform-admin list get past it
// (and every console_* database function re-checks that on each call).
// Sections live at /console/<section>[/<id>] so they can be bookmarked and
// linked from alert emails.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Bell, Building2, CreditCard, ExternalLink, FileClock, Inbox, LayoutDashboard, LogOut, Menu, Package, Settings, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/sonner';
import { requireSupabase } from '@/lib/supabase/client';
import { amIPlatformAdmin, signIn, signOut } from '@/lib/supabase/auth';
import { listAdmins, listFeed, subscribeToEvents } from '@/lib/supabase/console';
import { listInbox, subscribeToAllSupport } from '@/lib/supabase/support';
import { resetPlatformAdminCheck } from '@/hooks/usePlatformAdmin';
import type { ConsoleSection } from './ConsoleSections';
import { ConsoleBody, type ConsoleRoute } from './ConsoleBody';

type Route = ConsoleRoute;

const SECTIONS: ConsoleSection[] = ['inbox', 'notifications', 'overview', 'workspaces', 'payments', 'orders', 'admins', 'log', 'settings'];

function parseRoute(): Route {
  const [, , section, id] = window.location.pathname.split('/');
  return {
    section: SECTIONS.includes(section as ConsoleSection) ? (section as ConsoleSection) : 'overview',
    id: id ? decodeURIComponent(id) : null,
  };
}

function routePath(route: Route) {
  return `/console/${route.section}${route.id ? `/${encodeURIComponent(route.id)}` : ''}`;
}

const NAV: Array<{ id: ConsoleSection; label: string; icon: React.ElementType; group: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Business' },
  { id: 'inbox', label: 'Support inbox', icon: Inbox, group: 'Business' },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'Business' },
  { id: 'workspaces', label: 'Customers', icon: Building2, group: 'Business' },
  { id: 'payments', label: 'Payments', icon: CreditCard, group: 'Business' },
  { id: 'orders', label: 'VitaCard orders', icon: Package, group: 'Business' },
  { id: 'admins', label: 'Admins', icon: ShieldCheck, group: 'Team' },
  { id: 'log', label: 'Audit log', icon: FileClock, group: 'Team' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Team' },
];

export default function ConsoleApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Which signed-in user the admin check answered for (a different user means "still checking").
  const [adminCheck, setAdminCheck] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    document.title = 'VitaLink Console';
    // Keep the console out of search engines.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);

    const db = requireSupabase();
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { data.subscription.unsubscribe(); meta.remove(); };
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    resetPlatformAdminCheck();
    amIPlatformAdmin()
      .catch(() => false)
      .then((value) => { if (!cancelled) setAdminCheck({ userId, isAdmin: value }); });
    return () => { cancelled = true; };
  }, [userId]);
  const isAdmin = userId && adminCheck?.userId === userId ? adminCheck.isAdmin : null;

  let content: React.ReactNode;
  if (session === undefined || (session && isAdmin === null)) {
    content = <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading...</div>;
  } else if (!session) {
    content = <ConsoleSignIn />;
  } else if (!isAdmin) {
    content = <NotATeamAccount email={session.user.email ?? ''} />;
  } else {
    content = <ConsoleShell email={(session.user.email ?? '').toLowerCase()} />;
  }

  return (
    <>
      {content}
      <Toaster position="top-right" />
    </>
  );
}

// ---------------------------------------------------------------------------

function ConsoleSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error && /invalid login/i.test(err.message) ? 'Wrong email or password.' : err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-7 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <img src="/vitalink-icon.png" alt="" className="h-8 w-8" />
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">VitaLink Console</p>
            <p className="text-xs text-slate-500">VitaLink team sign-in</p>
          </div>
        </div>
        <label className="block text-sm">Email<Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm">Password<Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
        <p className="text-center text-xs text-slate-500">Forgot your password? Reset it from the <a href="/" className="text-violet-700 hover:underline">VitaLink sign-in page</a>.</p>
      </form>
    </div>
  );
}

function NotATeamAccount({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-7 text-center dark:bg-slate-900">
        <p className="font-semibold">This isn't a VitaLink team account</p>
        <p className="text-sm text-slate-500">{email} can't open this page. Sign in with a VitaLink team account, or go back to your workspace.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => location.assign('/')}>My workspace</Button>
          <Button onClick={() => void signOut()}>Use another account</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConsoleShell({ email }: { email: string }) {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadFeed, setUnreadFeed] = useState(0);
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [admins, setAdmins] = useState<string[]>([]);

  useEffect(() => {
    if (window.location.pathname === '/console' || window.location.pathname === '/console/') {
      window.history.replaceState({}, '', routePath(parseRoute()));
    }
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    listAdmins().then((rows) => setAdmins(rows.map((row) => row.email))).catch(() => undefined);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: Route) => {
    setRoute(next);
    setMenuOpen(false);
    if (routePath(next) !== window.location.pathname) window.history.pushState({}, '', routePath(next));
  }, []);

  const refreshCounts = useCallback(() => {
    listFeed({ limit: 1 }).then((result) => setUnreadFeed(result.unread)).catch(() => undefined);
    listInbox('unread').then((rows) => setUnreadInbox(rows.length)).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCounts();
    const stopEvents = subscribeToEvents(() => { refreshCounts(); });
    const stopSupport = subscribeToAllSupport(refreshCounts);
    return () => { stopEvents(); stopSupport(); };
  }, [refreshCounts]);

  // A toast for anything new while the console is open.
  useEffect(() => subscribeToEvents(() => {
    listFeed({ limit: 1 }).then((result) => {
      const latest = result.events[0];
      if (latest && Date.now() - new Date(latest.at).getTime() < 60_000) toast(latest.title, { description: latest.organizationName ?? undefined });
    }).catch(() => undefined);
  }), []);

  const badge = (id: ConsoleSection) => (id === 'notifications' ? unreadFeed : id === 'inbox' ? unreadInbox : 0);
  const current = NAV.find((item) => item.id === route.section);

  const nav = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 pt-1">
        <img src="/vitalink-icon.png" alt="" className="h-7 w-7" />
        <div>
          <p className="text-sm font-semibold text-white">VitaLink Console</p>
          <p className="text-[11px] text-slate-400">Team only</p>
        </div>
      </div>
      {['Business', 'Team'].map((group) => (
        <div key={group} className="mb-2">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group}</p>
          {NAV.filter((item) => item.group === group).map((item) => (
            <button key={item.id} type="button" onClick={() => go({ section: item.id, id: null })}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                route.section === item.id ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
              <item.icon className="h-4 w-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {badge(item.id) > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{badge(item.id) > 99 ? '99+' : badge(item.id)}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="mt-auto space-y-1 border-t border-white/10 pt-3">
        <a href="/" target="_blank" rel="noopener" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
          <ExternalLink className="h-4 w-4" />Open my workspace
        </a>
        <p className="truncate px-3 text-[11px] text-slate-500" title={email}>{email}</p>
        <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
          <LogOut className="h-4 w-4" />Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-60 bg-slate-950 lg:block">{nav}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-950">{nav}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button type="button" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{current?.label}</h1>
          <button type="button" onClick={() => go({ section: 'notifications', id: null })} className="relative ml-auto rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Notifications (${unreadFeed} new)`}>
            <Bell className="h-5 w-5" />
            {unreadFeed > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{unreadFeed > 99 ? '99+' : unreadFeed}</span>}
          </button>
        </header>
        <main className="p-4 lg:p-6">
          <ConsoleBody route={route} go={go} email={email} admins={admins} onFeedRead={refreshCounts} />
        </main>
      </div>
    </div>
  );
}
