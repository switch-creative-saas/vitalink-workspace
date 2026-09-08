import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function SSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('sentinel-input h-10 rounded-xl px-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-500/20', className)} {...props} />;
}
