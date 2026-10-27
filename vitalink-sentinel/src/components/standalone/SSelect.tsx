import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function SSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('sentinel-input h-10 rounded-full px-4 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/10', className)} {...props} />;
}
