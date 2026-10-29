// Shown while a page's file downloads (pages load on first use). A light skeleton rather than a
// spinner, so slow connections see the layout straight away.
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
