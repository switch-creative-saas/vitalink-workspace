import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AppLayout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full min-w-0 max-w-[100vw] overflow-x-hidden no-page-scroll-x', className)}>
      {children}
    </div>
  );
}
