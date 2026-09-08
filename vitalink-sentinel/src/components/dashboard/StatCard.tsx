import type { ElementType } from 'react';
import { SCard as Card } from '@/components/standalone/SCard';
import { cn } from '@/lib/utils';

export function StatCard({ label, value, trend, icon: Icon, tone }: { label: string; value: string; trend: string; icon: ElementType; tone: 'critical' | 'high' | 'moderate' | 'low' }) {
  const accents = {
    critical: 'text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-950/40',
    high: 'text-orange-600 bg-orange-50 dark:text-orange-300 dark:bg-orange-950/40',
    moderate: 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
    low: 'text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{trend}</p>
        </div>
        <div className={cn('rounded-xl p-3', accents[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

