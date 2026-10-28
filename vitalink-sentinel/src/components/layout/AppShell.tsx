import type { ReactNode } from 'react';
import { useSentinelStore } from '@/store/useSentinelStore';
import { PAGE_TITLES } from './navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SentinelToursProvider } from '@/components/tours/SentinelTours';

export function AppShell({ children }: { children: ReactNode }) {
  const { route, activeOrganization } = useSentinelStore();
  return (
    <SentinelToursProvider>
    <div className="sentinel-app min-h-screen overflow-x-clip text-slate-950 dark:text-slate-100">
      <TopBar />
      <div className="flex gap-5 px-4 lg:gap-6 lg:px-6">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-10 pt-3">
          {/* Most pages carry their own heading (styled large in globals.css); these two don't. */}
          {(route === 'dashboard' || route === 'settings') && <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
            <h1 className="text-[28px] font-semibold tracking-tight text-slate-950 dark:text-white sm:text-[34px]">{PAGE_TITLES[route]}</h1>
            {activeOrganization && <p className="pb-1.5 text-sm text-slate-500 dark:text-slate-400">{activeOrganization.fullName}</p>}
          </div>}
          <div className="sentinel-content">{children}</div>
        </main>
      </div>
    </div>
    </SentinelToursProvider>
  );
}
