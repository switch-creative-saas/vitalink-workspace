import { formatDistanceToNow } from 'date-fns';
import { mockAlerts } from '@/data/mockSentinelData';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';

export function AlertFeed() {
  return (
    <div className="space-y-3">
      {mockAlerts.map((alert) => (
        <div key={alert.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-start justify-between gap-3">
            <Badge tone={alert.severity}>{alert.severity}</Badge>
            <span className="text-xs text-slate-500 dark:text-slate-400">{formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}</span>
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-50">{alert.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{alert.message}</p>
          {!alert.acknowledged && <Button className="mt-3 px-3 py-1.5 text-xs">Review Alert</Button>}
        </div>
      ))}
    </div>
  );
}

