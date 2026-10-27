import { useState } from 'react';
import { ArrowUpRight, Building2, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { BRAND } from '@/config/brand';
import { useSentinelStore } from '@/store/useSentinelStore';
import { cn } from '@/lib/utils';
import { HeaderPopover } from './HeaderPopover';

const websiteUrl = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || BRAND.website;
const roleLabels: Record<string, string> = { admin: 'Administrator', officer: 'Surveillance officer', field_worker: 'Field worker', analyst: 'Analyst', viewer: 'Viewer' };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((word) => word[0]).join('').toUpperCase().slice(0, 2) || 'S';

/** Avatar: who is signed in, for which organisation, plus settings, theme and sign out. */
export function ProfileMenu() {
  const { me, activeOrganization, theme, toggleTheme, navigate, logout } = useSentinelStore();
  const [signingOut, setSigningOut] = useState(false);
  const name = me?.fullName || activeOrganization?.fullName || 'Sentinel user';
  const item = 'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-900/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.07]';

  return <HeaderPopover label="Account" className="overflow-hidden border-2 border-white p-0 dark:border-white/20" panelClassName="w-[min(92vw,300px)]"
    trigger={<span className="grid h-full w-full place-items-center bg-gradient-to-br from-indigo-500 via-violet-500 to-rose-400 text-sm font-semibold text-white">{initials(name)}</span>}>
    {(close) => <>
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-rose-400 text-sm font-semibold text-white">{initials(name)}</span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{name}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400">{me?.email ?? activeOrganization?.contactEmail ?? 'Offline demo'}</p></div>
      </div>
      <div className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-slate-900/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
        <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{me?.organization.name ?? activeOrganization?.fullName ?? 'No organisation'}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{me ? roleLabels[me.role] ?? me.role : 'Demo workspace'}</p></div>
      </div>
      <div className="px-2 pb-2">
        <button type="button" className={item} onClick={() => { close(); navigate('settings'); }}><Settings className="h-4 w-4 text-slate-400" />Organisation settings</button>
        <button type="button" className={item} onClick={toggleTheme}>{theme === 'dark' ? <Sun className="h-4 w-4 text-slate-400" /> : <Moon className="h-4 w-4 text-slate-400" />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
        <a className={item} href={websiteUrl}><ArrowUpRight className="h-4 w-4 text-slate-400" />Back to VitaLink</a>
        <div className="my-1 h-px bg-slate-900/[0.06] dark:bg-white/10" />
        <button type="button" disabled={signingOut} className={cn(item, 'text-rose-600 dark:text-rose-400')} onClick={() => { setSigningOut(true); logout(); }}><LogOut className="h-4 w-4" />{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </>}
  </HeaderPopover>;
}
