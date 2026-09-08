import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SCard({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={cn('sentinel-card rounded-2xl p-5', className)} {...props}>{children}</div>;
}
