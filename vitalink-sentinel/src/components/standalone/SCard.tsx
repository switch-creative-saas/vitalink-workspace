import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SCard({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={cn('sentinel-card rounded-[28px] p-6', className)} {...props}>{children}</div>;
}
