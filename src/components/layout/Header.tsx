import { ChevronDown, Laptop, Moon, Search, Sun, Wifi, WifiOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResponsive } from '@/contexts/ResponsiveContext';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ProfileDropdown } from '@/components/profile/ProfileDropdown';
import { useState, useEffect } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { applyTheme, getSavedTheme, type ThemeMode } from '@/lib/theme';
import { useAuth } from '@/contexts/AuthContext';
import { workspaceDescriptor } from '@/lib/workspace/workspace';
import { usePlan } from '@/hooks/usePlan';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { getMyProfile, updateMyProfile } from '@/lib/supabase/profile';
import { OfflineStatusChip } from '@/components/offline/OfflineStatus';
import { TourMenu } from '@/components/tours/TourMenu';

interface HeaderProps {
  title: string;
  onAIClick: () => void;
  onPageChange: (page: string) => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
}

export function Header({ title, onAIClick, onPageChange, onLogout, onDeleteAccount }: HeaderProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const { isMobile } = useResponsive();
  const [searchOpen, setSearchOpen] = useState(false); // phones: search drops down under the header
  const { organization } = useAuth();
  const { plan, isTrialActive } = usePlan();
  const trialDaysLeft = isTrialActive && plan?.trialEndDate
    ? Math.max(0, Math.ceil((new Date(plan.trialEndDate).getTime() - Date.now()) / 86_400_000))
    : null;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
    };
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
    // Saved to the account so the theme follows the user to other devices.
    if (isSupabaseConfigured) {
      void getMyProfile().then((p) => p && updateMyProfile(p.id, { preferences: { ...p.preferences, theme: mode } })).catch(() => undefined);
    }
  };

  return (
    <header className="h-20 px-[var(--page-padding)] flex items-center justify-between gap-2 sm:gap-4 bg-[color:var(--bg-card)]/80 backdrop-blur-xl border-b border-[color:var(--border-color)] sticky top-0 z-40 min-w-0 w-full overflow-visible">
      {/* Left: Title & Mobile Spacer */}
      <div className={cn("flex items-center gap-4 min-w-0 flex-1 sm:flex-none sm:flex-shrink", isMobile && "ml-12")}>
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-semibold text-slate-900 dark:text-slate-50 truncate max-w-[min(100%,28ch)]">{title}</h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 hidden sm:block">
            {currentTime.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>
      </div>

      {/* Center: Search (responsive) */}
      <div data-tour-id="global-search" className="hidden sm:block flex-1 min-w-0 sm:max-w-xs md:max-w-md mx-1 sm:mx-2">
        {!searchOpen && <GlobalSearch />}
      </div>
      {searchOpen && (
        <div className="absolute inset-x-0 top-full flex items-center gap-2 border-b border-[color:var(--border-color)] bg-[color:var(--bg-card)] p-3 shadow-lg sm:hidden">
          <div className="min-w-0 flex-1"><GlobalSearch /></div>
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 min-w-0">
        <button type="button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search" className="rounded-xl p-2.5 text-slate-600 hover:bg-slate-100 sm:hidden dark:text-slate-300 dark:hover:bg-slate-800">
          <Search className="h-5 w-5" />
        </button>
        {trialDaysLeft !== null && (
          <button type="button" onClick={() => onPageChange('subscription')} className="hidden md:flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            Trial: {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left
            <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">Upgrade</span>
          </button>
        )}
        {/* Connection Status - hidden on mobile */}
        <div className="hidden xl:flex max-w-[14rem] flex-col items-end leading-tight">
          <span className="max-w-full truncate text-xs font-semibold text-slate-900 dark:text-slate-50">{organization.name}</span>
          <span className="max-w-full truncate text-[10px] text-slate-600 dark:text-slate-400">{workspaceDescriptor(organization)}</span>
        </div>

        {isSupabaseConfigured ? <div className="hidden sm:block"><OfflineStatusChip /></div> : <div className={cn(
          "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
          isOnline 
            ? "bg-green-100 text-green-700" 
            : "bg-amber-100 text-amber-700"
        )}>
          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          <span className="hidden lg:inline">{isOnline ? 'Online' : 'Offline'}</span>
        </div>}

        {/* AI Button */}
        <button
          data-tour-id="vitamind-button"
          onClick={onAIClick}
          className="relative p-2 sm:p-2.5 rounded-xl bg-vitalink-50 hover:bg-vitalink-100 border border-vitalink-200 transition-all duration-200"
          title="Open VitaMind AI"
        >
          <svg className="w-5 h-5 text-vitalink-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-vitamind text-[10px] font-bold text-white flex items-center justify-center">
            AI
          </span>
        </button>

        {/* Guided tours */}
        <div className="hidden sm:block"><TourMenu onOpenHelp={() => onPageChange('help')} /></div>

        {/* Notifications */}
        <NotificationBell />

        {/* Theme Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Theme" className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2 rounded-xl bg-[color:var(--bg-card)]/70 border border-[color:var(--border)] text-[color:var(--text-primary)] transition-all duration-200 hover:shadow-md">
              {theme === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
              {theme === 'dark' && <Moon className="w-4 h-4 text-indigo-300" />}
              {theme === 'system' && <Laptop className="w-4 h-4 text-sky-400" />}
              <span className="hidden sm:inline text-xs font-medium capitalize">{theme}</span>
              <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-[color:var(--text-secondary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-50 glass-panel border-[color:var(--border)]">
            <DropdownMenuItem onClick={() => setThemeMode('light')}>
              <Sun className="w-4 h-4 mr-2 text-amber-500" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setThemeMode('dark')}>
              <Moon className="w-4 h-4 mr-2 text-indigo-300" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setThemeMode('system')}>
              <Laptop className="w-4 h-4 mr-2 text-sky-400" />
              System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Profile */}
        <ProfileDropdown onNavigate={onPageChange} onLogout={onLogout} onDeleteAccount={onDeleteAccount} />
      </div>
    </header>
  );
}
