import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { SButton as Button } from '@/components/standalone/SButton';

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl animate-in fade-in zoom-in-95 overflow-y-auto rounded-[28px] sentinel-panel p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">{title}</h2>
          <Button className="h-10 w-10 border-slate-900/10 bg-white/70 p-0 text-slate-600 shadow-none hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.12]" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

