// Connection and sync status: the header chip (with the list of changes waiting
// to sync or refused by the server, and the low-data switch) and the banner shown while offline.
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, CloudOff, Gauge, Loader2, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { discardEntry, flushOutbox, retryEntry } from '@/lib/offline/sync';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { Switch } from '@/components/ui/switch';
import { getDataSaverPreference, setDataSaverPreference, useLowData } from '@/lib/network/dataSaver';
import { OFFLINE_READY_EVENT, offlineReadiness, prepareOffline, type OfflineReadiness } from '@/lib/offline/prepare';
import { useAuth } from '@/contexts/AuthContext';

function useOfflineReadiness() {
  const [ready, setReady] = useState<OfflineReadiness>(offlineReadiness);
  useEffect(() => {
    const update = (event: Event) => setReady({ ...(event as CustomEvent<OfflineReadiness>).detail });
    window.addEventListener(OFFLINE_READY_EVENT, update);
    return () => window.removeEventListener(OFFLINE_READY_EVENT, update);
  }, []);
  return ready;
}

/** Whether this device can work offline: every page downloaded, records saved, and how fresh. */
function OfflineReadinessPanel() {
  const ready = useOfflineReadiness();
  const { organization } = useAuth();
  const filesDone = ready.appFiles ? ready.appFiles.cached >= ready.appFiles.total : null;
  const complete = Boolean(ready.preparedAt) && filesDone !== false;
  return (
    <div className="mt-3 rounded-lg border border-slate-100 px-3 py-2.5 text-xs dark:border-slate-800">
      <p className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-50">
        {ready.running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> : complete ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <CloudOff className="h-3.5 w-3.5 text-amber-600" />}
        {ready.running ? 'Getting ready to work offline…' : complete ? 'Ready to work offline' : 'Not fully ready for offline yet'}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-slate-600 dark:text-slate-400">
        <li>App: {ready.appFiles ? (filesDone ? 'every page downloaded' : `${ready.appFiles.cached} of ${ready.appFiles.total} files downloaded`) : 'pages download after sign-in'}</li>
        <li>Records: {ready.preparedAt ? `${ready.records.toLocaleString()} saved, updated ${formatDistanceToNow(new Date(ready.preparedAt), { addSuffix: true })}` : 'not saved yet'}</li>
        {ready.persistent && <li>Protected: this browser won’t clear them to free space</li>}
      </ul>
      <button type="button" disabled={ready.running || !navigator.onLine} onClick={() => void prepareOffline(organization.id)}
        className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-700 disabled:opacity-50 dark:text-blue-300">
        <RefreshCw className="h-3 w-3" />Update now
      </button>
    </div>
  );
}

export function OfflineStatusChip() {
  const status = useOfflineStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = status.pending + status.failed.length;
  const lowData = useLowData();

  useEffect(() => {
    const onSynced = (event: Event) => {
      const sent = (event as CustomEvent<{ sent: number }>).detail.sent;
      toast.success(`${sent} change${sent === 1 ? '' : 's'} made offline ${sent === 1 ? 'is' : 'are'} now saved to VitaLink.`, {
        action: { label: 'Refresh', onClick: () => window.location.reload() },
      });
    };
    window.addEventListener('vitalink:offline-synced', onSynced);
    return () => window.removeEventListener('vitalink:offline-synced', onSynced);
  }, []);

  const tone = status.failed.length ? 'bg-red-100 text-red-700' : !status.online ? 'bg-amber-100 text-amber-700' : waiting ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';
  const label = status.failed.length ? `${status.failed.length} need attention`
    : !status.online ? (status.pending ? `Offline · ${status.pending} to sync` : 'Offline')
    : status.syncing ? 'Syncing…' : status.pending ? `${status.pending} to sync` : lowData ? 'Low data' : 'Online';
  const Icon = status.failed.length ? AlertTriangle : !status.online ? WifiOff : status.syncing ? Loader2 : lowData ? Gauge : Wifi;

  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try { await action(); } finally { setBusy(null); }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-tour-id="offline-status" type="button" className={cn('hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium', tone)} title="Connection and offline sync">
          <Icon className={cn('w-3.5 h-3.5', status.syncing && 'animate-spin')} />
          <span className="hidden lg:inline">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{status.online ? 'Connected' : 'Working offline'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {status.online
              ? status.lastSyncedAt ? `Last synced ${formatDistanceToNow(status.lastSyncedAt, { addSuffix: true })}.` : 'Changes save straight to VitaLink.'
              : 'Pages show what’s saved on this device. Patient registration, notes, vitals, appointments, lab and pharmacy changes are kept here and sent when you reconnect.'}
          </p>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <span><span className="block font-semibold text-slate-900 dark:text-slate-50">Low-data mode</span>{getDataSaverPreference() === 'auto' ? 'Automatic: follows your connection' : 'Set by you on this device'}</span>
            <Switch checked={lowData} onCheckedChange={(on) => setDataSaverPreference(on ? 'on' : 'off')} />
          </label>
          <OfflineReadinessPanel />
        </div>
        <div className="max-h-72 space-y-2 overflow-y-auto p-3">
          {waiting === 0 && <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">Nothing waiting to sync.</p>}
          {status.pending > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              <span>{status.pending} change{status.pending === 1 ? '' : 's'} waiting to send</span>
              {status.online && !status.syncing && <button type="button" className="font-semibold" onClick={() => void flushOutbox()}>Send now</button>}
            </div>
          )}
          {status.failed.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/60 dark:bg-red-950/30">
              <p className="font-semibold text-red-800 dark:text-red-200">{entry.label}</p>
              <p className="mt-0.5 text-red-700 dark:text-red-300">{entry.error}</p>
              <p className="mt-0.5 text-red-600/80 dark:text-red-300/70">Made {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</p>
              <div className="mt-2 flex gap-3">
                <button type="button" disabled={busy === entry.id} className="inline-flex items-center gap-1 font-semibold text-red-800 dark:text-red-200" onClick={() => void act(entry.id, () => retryEntry(entry.id))}><RefreshCw className="h-3 w-3" />Try again</button>
                <button type="button" disabled={busy === entry.id} className="inline-flex items-center gap-1 text-red-700 dark:text-red-300"
                  onClick={() => { if (window.confirm(`Discard "${entry.label}"? It was never saved to VitaLink and can't be recovered.`)) void act(entry.id, () => discardEntry(entry.id)); }}>
                  <Trash2 className="h-3 w-3" />Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function OfflineBanner() {
  const status = useOfflineStatus();
  if (status.online && !status.showingSaved) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <CloudOff className="h-4 w-4 shrink-0" />
      <span>
        {status.online ? 'Some information on this page was loaded from this device and may be out of date.' : "You're offline. You're seeing information saved on this device; changes you make will sync when you reconnect."}
        {status.pending > 0 && ` ${status.pending} change${status.pending === 1 ? '' : 's'} waiting to sync.`}
      </span>
    </div>
  );
}
