import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F7F8FA] text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <div className="min-h-screen min-w-0 lg:pl-[272px]">
        <TopBar />
        <main className="mx-auto max-w-[1560px] overflow-x-hidden p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
