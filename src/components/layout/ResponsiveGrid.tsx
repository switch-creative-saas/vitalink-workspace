import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { layout } from '@/lib/layout';

type GridVariant = 'stats' | 'cards';

interface ResponsiveGridProps {
  children: ReactNode;
  variant?: GridVariant;
  className?: string;
}

/** Dashboard stat / KPI grids: 1 → 2 → 3 → 4 columns by breakpoint */
export function ResponsiveGrid({ children, variant = 'stats', className }: ResponsiveGridProps) {
  return (
    <div
      className={cn(variant === 'stats' ? layout.statGrid : layout.cardGrid, className)}
    >
      {children}
    </div>
  );
}
