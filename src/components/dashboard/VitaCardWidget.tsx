import { Nfc, QrCode, CheckCircle2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VitaCardWidgetProps {
  isOnline?: boolean;
  onTapCard?: () => void;
  onQrScan?: () => void;
  className?: string;
}

export function VitaCardWidget({
  isOnline = true,
  onTapCard,
  onQrScan,
  className,
}: VitaCardWidgetProps) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 min-w-0', className)}>
      <button
        type="button"
        onClick={onTapCard}
        className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-soft hover:border-vitalink-300 hover:bg-vitalink-50/50 transition-all text-left min-w-0 group dark:border-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-800"
      >
        <div className="relative w-11 h-11 rounded-lg bg-vitalink-50 border border-vitalink-200 flex items-center justify-center flex-shrink-0 group-hover:border-vitalink-400">
          <Nfc className="w-5 h-5 text-vitalink-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">VitaCard</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 truncate">Tap NFC to identify</p>
        </div>
      </button>

      <button
        type="button"
        onClick={onQrScan}
        className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-soft hover:border-vitalink-300 hover:bg-vitalink-50/50 transition-all text-left min-w-0 dark:border-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-800"
      >
        <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
          <QrCode className="w-5 h-5 text-vitalink-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">QR Scan</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 truncate">Quick patient lookup</p>
        </div>
      </button>

      <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200/80 shadow-soft min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
        <div
          className={cn(
            'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0',
            isOnline ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200',
          )}
        >
          {isOnline ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <WifiOff className="w-5 h-5 text-amber-600" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Sync Status</p>
          <p className={cn('text-xs truncate', isOnline ? 'text-green-600' : 'text-amber-600')}>
            {isOnline ? 'Online · All synced' : 'Offline · Queue active'}
          </p>
        </div>
      </div>
    </div>
  );
}
