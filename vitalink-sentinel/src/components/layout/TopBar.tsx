import { useEffect, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { useSentinelStore } from '@/store/useSentinelStore';
import { NAV_ITEMS, iconButtonClass } from './navigation';
import { AlertsMenu } from './header/AlertsMenu';
import { InboxMenu } from './header/InboxMenu';
import { ProfileMenu } from './header/ProfileMenu';
import { SearchDialog } from './header/SearchDialog';
import { TourMenu } from '@/components/tours/SentinelTours';

const groups = ['Overview', 'Surveillance', 'Intelligence', 'Operations', 'Administration'] as const;

export function TopBar() {
  const { route, navigate } = useSentinelStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const live = isSupabaseConfigured;

  // Ctrl/⌘ + K or "/" opens search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
      if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <>
    <header className="sticky top-0 z-40 bg-[#e8ebf1]/75 px-4 backdrop-blur-xl dark:bg-[#0d0e14]/75 lg:px-6">
      <div className="flex h-[76px] items-center gap-2 sm:gap-4">
        <button type="button" onClick={() => setMenuOpen(true)} className={cn(iconButtonClass, 'lg:hidden')} aria-label="Open menu"><Menu className="h-[18px] w-[18px]" /></button>
        <button type="button" onClick={() => navigate('dashboard')} aria-label="Sentinel dashboard" className="flex shrink-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-slate-900/30 dark:focus-visible:ring-white/40">
          <img src="/sentinel-logo.svg" alt="" className="h-9 w-9 rounded-xl bg-white p-0.5 shadow-sm" />
          <span className="hidden text-[22px] font-semibold tracking-tight text-slate-950 dark:text-white sm:inline">sentinel</span>
        </button>

        <nav data-tour-id="top-nav" className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
          {NAV_ITEMS.filter((item) => item.placement === 'top').map((item) => <button key={item.route} type="button" data-tour-id={`nav-${item.route}`} onClick={() => navigate(item.route)}
            className={cn('h-11 rounded-full px-4 text-sm font-medium transition xl:px-5', route === item.route ? 'bg-slate-950 text-white shadow-[0_10px_24px_-12px_rgba(15,23,42,0.8)] dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white')}>
            {item.label}
          </button>)}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:ml-0">
          <button type="button" data-tour-id="search" onClick={() => setSearchOpen(true)} className={iconButtonClass} aria-label="Search" title="Search (Ctrl K)"><Search className="h-[18px] w-[18px]" /></button>
          <div className="hidden sm:block"><TourMenu /></div>
          <InboxMenu live={live} />
          <AlertsMenu live={live} />
          <ProfileMenu />
        </div>
      </div>
    </header>

    {searchOpen && <SearchDialog live={live} onClose={() => setSearchOpen(false)} />}

    {menuOpen && <div className="fixed inset-0 z-[60] bg-slate-950/30 backdrop-blur-sm lg:hidden" onPointerDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <div className="sentinel-panel absolute inset-y-3 left-3 flex w-[min(86vw,320px)] flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between px-5 py-4"><span className="text-lg font-semibold text-slate-950 dark:text-white">Menu</span><button type="button" onClick={() => setMenuOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10" aria-label="Close menu"><X className="h-4 w-4" /></button></div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-5">
          {groups.map((group) => <div key={group}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group}</p>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return <button key={item.route} type="button" onClick={() => { navigate(item.route); setMenuOpen(false); }} className={cn('flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium', route === item.route ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10')}><Icon className="h-4 w-4" />{item.label}</button>;
            })}
          </div>)}
        </nav>
      </div>
    </div>}
  </>;
}
