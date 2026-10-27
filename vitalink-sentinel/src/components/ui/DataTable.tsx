import type { ReactNode } from 'react';

export function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="sentinel-card overflow-x-auto rounded-[28px] px-3 pb-2">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs text-slate-400 dark:text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-slate-900/[0.08] px-4 pb-3 pt-5 font-medium dark:border-white/10">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.06]">{children}</tbody>
      </table>
    </div>
  );
}
