import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** When true, content spans full main area width (padding only, no max-width cap on inner) */
  fullWidth?: boolean;
}

export function PageContainer({ children, className, fullWidth }: PageContainerProps) {
  return (
    <div
      className={cn(
        'page-container no-page-scroll-x',
        fullWidth && 'max-w-none',
        className,
      )}
    >
      <div className="page-container-inner contain-layout">{children}</div>
    </div>
  );
}
