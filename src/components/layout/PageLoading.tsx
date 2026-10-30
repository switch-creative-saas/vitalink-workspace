// Shown while a page's file downloads (pages load on first use). A light skeleton rather than a
// spinner, so slow connections see the layout straight away. If the file can't be fetched (offline
// before the app finished downloading, or after an update), PageLoadBoundary explains and retries.
import { Component, type ReactNode } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-4', fullScreen && 'min-h-screen bg-slate-950 p-6')}>
      <div className="h-7 w-56 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/60" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-200/70 dark:bg-slate-700/50" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/60" />)}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-slate-200/50 dark:bg-slate-800/50" />
    </div>
  );
}

export class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidMount() {
    window.addEventListener('online', this.retry);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.retry);
  }

  retry = () => {
    if (this.state.failed) window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const offline = !navigator.onLine;
    return (
      <div className="premium-card mx-auto mt-10 max-w-md p-8 text-center">
        <CloudOff className="mx-auto h-8 w-8 text-slate-400" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-50">{offline ? 'This page isn’t on this device yet' : 'This page couldn’t load'}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {offline
            ? 'VitaLink downloads every page the first time you sign in with a connection. Reconnect once and this page will open, online or offline.'
            : 'A newer version of VitaLink may have been released. Reload to get it.'}
        </p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#1E4ED8] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1A43BD]">
          <RefreshCw className="h-4 w-4" />{offline ? 'Try again' : 'Reload'}
        </button>
        {offline && <p className="mt-3 text-xs text-slate-400">It will reload by itself when the connection returns.</p>}
      </div>
    );
  }
}
