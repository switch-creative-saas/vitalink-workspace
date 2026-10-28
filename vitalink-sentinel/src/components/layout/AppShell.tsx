import type { ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { useSentinelStore } from '@/store/useSentinelStore';
import { PAGE_TITLES } from './navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SentinelToursProvider } from '@/components/tours/SentinelTours';

// The VitaLink workspace app, where a hospital's plan and the Sentinel add-on are paid for.
const workspaceUrl = ((import.meta.env.VITE_VITALINK_APP_URL as string | undefined) || 'http://localhost:5175').replace(/\/$/, '');

export function AppShell({ children }: { children: ReactNode }) {
  const { route, activeOrganization, me } = useSentinelStore();
  // Hospitals on VitaLink Growth get Sentinel read-only; full access is the add-on.
  const hospitalReadOnly = me?.role === 'viewer' && me.organization.type === 'Hospital';
  return (
    <SentinelToursProvider>
    <div className="sentinel-app min-h-screen overflow-x-clip text-slate-950 dark:text-slate-100">
      <TopBar />
      <div className="flex gap-5 px-4 lg:gap-6 lg:px-6">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-10 pt-3">
          {hospitalReadOnly && <div className="mb-5 flex flex-col gap-3 rounded-[22px] border border-violet-200 bg-violet-50/80 px-4 py-3 text-sm text-violet-900 sm:flex-row sm:items-center sm:justify-between dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100">
            <p className="flex items-start gap-2"><Eye className="mt-0.5 h-4 w-4 shrink-0" />Read-only surveillance for {me.organization.name}, included in VitaLink Growth. Reporting cases, declaring outbreaks and issuing alerts need full access.</p>
            <a href={`${workspaceUrl}/subscription?addon=sentinel`} className="shrink-0 rounded-full bg-violet-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-violet-500">Get full access</a>
          </div>}
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
