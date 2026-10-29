// The VitaLink Console as its own app at /console, separate from any workspace.
// It has its own sign-in; only accounts on the platform-admin list get past it
// (and every console_* database function re-checks that on each call).
// Sections live at /console/<section>[/<id>] so they can be bookmarked and
// linked from alert emails.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowUpRight, Bell, Building2, CreditCard, FileClock, History, Inbox, LayoutDashboard, LogOut, Menu, Package, Radio, Settings, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/sonner';
import { requireSupabase } from '@/lib/supabase/client';
import { waitForMfa } from '@/lib/supabase/mfa';
import { MfaGate } from '@/components/auth/MfaGate';
import { amIPlatformAdmin, signIn, signOut } from '@/lib/supabase/auth';
import { listAdmins, listFeed, subscribeToEvents } from '@/lib/supabase/console';
import { listInbox, subscribeToAllSupport } from '@/lib/supabase/support';
import { resetPlatformAdminCheck } from '@/hooks/usePlatformAdmin';
import type { ConsoleSection } from './ConsoleSections';
import { ConsoleBody, type ConsoleRoute } from './ConsoleBody';
import './console.css';

type Route = ConsoleRoute;

const SECTIONS: ConsoleSection[] = ['inbox', 'notifications', 'overview', 'workspaces', 'payments', 'orders', 'outbreaks', 'admins', 'log', 'settings'];

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
  { id: 'outbreaks', label: 'Outbreak signals', icon: Radio, group: 'Clinical' },
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
    // Platform admins must pass two-step verification before the admin check (the database requires it).
    waitForMfa()
      .then(() => amIPlatformAdmin())
      .catch(() => false)
      .then((value) => { if (!cancelled) setAdminCheck({ userId, isAdmin: value }); });
    return () => { cancelled = true; };
  }, [userId]);
  const isAdmin = userId && adminCheck?.userId === userId ? adminCheck.isAdmin : null;

  let content: React.ReactNode;
  if (session === undefined || (session && isAdmin === null)) {
    content = <div className="console-app flex min-h-screen items-center justify-center text-sm text-slate-400">Loading...</div>;
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
      <MfaGate />
      <Toaster position="top-right" />
    </>
  );
}

// ---------------------------------------------------------------------------

function ConsoleMark({ className }: { className?: string }) {
  return <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--console-navy)] shadow-[0_8px_20px_-10px_rgba(10,26,143,0.8)] dark:bg-[#0a1a8f]', className)}>
    <img src="/vitalink-icon.png" alt="" className="h-7 w-7 brightness-0 invert" />
  </span>;
}

// Signed-out and not-a-team-account screens share the console frame.
function ConsoleGate({ children }: { children: React.ReactNode }) {
  return (
    <div className="console-app flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-[420px] rounded-[32px] bg-[var(--console-panel)] p-8 sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <ConsoleMark />
          <div><p className="text-lg font-semibold text-slate-900 dark:text-white">VitaLink Console</p><p className="text-sm text-slate-500">VitaLink team only</p></div>
        </div>
        {children}
      </div>
    </div>
  );
}

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
    <ConsoleGate>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Email<Input className="h-12 bg-white dark:bg-white/5" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block space-y-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Password<Input className="h-12 bg-white dark:bg-white/5" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="h-12 w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
        <p className="text-center text-xs text-slate-500">Forgot your password? Reset it from the <a href="/" className="font-medium text-[var(--console-navy)] hover:underline">VitaLink sign-in page</a>.</p>
      </form>
    </ConsoleGate>
  );
}

function NotATeamAccount({ email }: { email: string }) {
  return (
    <ConsoleGate>
      <div className="space-y-3">
        <p className="font-semibold text-slate-900 dark:text-white">This isn't a VitaLink team account</p>
        <p className="text-sm text-slate-500">{email} can't open this page. Sign in with a VitaLink team account, or go back to your workspace.</p>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => location.assign('/')}>My workspace</Button>
          <Button className="flex-1" onClick={() => void signOut()}>Use another account</Button>
        </div>
      </div>
    </ConsoleGate>
  );
}

// ---------------------------------------------------------------------------

const roundButton = 'relative grid h-12 w-12 shrink-0 place-items-center rounded-full transition';

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

  const panel = (
    <nav className="flex h-full flex-col rounded-[32px] bg-[var(--console-panel)] p-5">
      <div className="mb-8 flex items-center justify-between">
        <button type="button" onClick={() => go({ section: 'overview', id: null })} aria-label="Overview"><ConsoleMark /></button>
        <button type="button" onClick={() => go({ section: 'log', id: null })} title="Audit log" aria-label="Audit log"
          className={cn(roundButton, 'bg-[var(--console-orange)] text-white shadow-[0_10px_22px_-10px_rgba(255,91,31,0.9)] hover:brightness-110')}><History className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto">
        {['Business', 'Clinical', 'Team'].map((group) => (
          <div key={group}>
            <p className="px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">{group}</p>
            <div className="space-y-1">
              {NAV.filter((item) => item.group === group).map((item) => {
                const active = route.section === item.id;
                return <button key={item.id} type="button" onClick={() => go({ section: item.id, id: null })}
                  className={cn('flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm transition',
                    active ? 'bg-[var(--console-navy)] font-medium text-white shadow-[0_10px_22px_-12px_rgba(10,26,143,0.9)] dark:bg-[#0a1a8f]' : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white')}>
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {badge(item.id) > 0 && <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-semibold', active ? 'bg-white text-[var(--console-navy)]' : 'bg-[var(--console-orange)] text-white')}>{badge(item.id) > 99 ? '99+' : badge(item.id)}</span>}
                </button>;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[22px] bg-white p-3 dark:bg-white/5">
        <div className="flex items-center gap-3 px-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--console-navy)] text-xs font-semibold uppercase text-white dark:bg-[#0a1a8f]">{email.slice(0, 2)}</span>
          <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900 dark:text-white" title={email}>{email}</p><p className="text-[11px] text-slate-500">Platform admin</p></div>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="console-app min-h-screen lg:flex lg:gap-8 lg:p-6">
      <aside className="sticky top-6 hidden h-[calc(100vh-48px)] w-[300px] shrink-0 lg:block">{panel}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-3 left-3 w-[min(86vw,300px)]">{panel}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1 px-4 pb-10 lg:px-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-white/90 py-4 backdrop-blur dark:bg-[#0b0d14]/90 lg:py-3">
          <button type="button" className={cn(roundButton, 'h-11 w-11 bg-[var(--console-panel)] text-slate-700 lg:hidden dark:text-slate-200')} onClick={() => setMenuOpen(true)} aria-label="Open menu">{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-[26px] dark:text-white">{current?.label}</h1>
          <div className="ml-auto flex items-center gap-2.5">
            <a href="/" target="_blank" rel="noopener" className="hidden h-11 items-center gap-1.5 rounded-full border border-[#e2e6ee] px-5 text-sm text-[var(--console-navy)] transition hover:bg-[#f4f6fb] sm:inline-flex dark:border-white/10 dark:hover:bg-white/5">
              Open my workspace<ArrowUpRight className="h-4 w-4" />
            </a>
            <button type="button" onClick={() => go({ section: 'notifications', id: null })} title="Notifications" aria-label={`Notifications (${unreadFeed} new)`}
              className={cn(roundButton, 'bg-[var(--console-orange)] text-white shadow-[0_10px_22px_-10px_rgba(255,91,31,0.9)] hover:brightness-110')}>
              <Bell className="h-5 w-5" />
              {unreadFeed > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--console-navy)] px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:bg-[#0a1a8f] dark:ring-[#0b0d14]">{unreadFeed > 99 ? '99+' : unreadFeed}</span>}
            </button>
            <button type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out" className={cn(roundButton, 'bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950')}>
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>
        <main className="pt-4">
          <ConsoleBody route={route} go={go} email={email} admins={admins} onFeedRead={refreshCounts} />
        </main>
      </div>
    </div>
  );
}
