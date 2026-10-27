import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button className={cn('inline-flex items-center justify-center gap-2 rounded-full border border-transparent bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_20px_-12px_rgba(15,23,42,0.7)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200', className)} {...props}>
      {children}
    </button>
  );
}
