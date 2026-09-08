import { useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { HeroVideo } from './HeroVideo';
import { applyTheme, getSavedTheme } from '@/lib/theme';

interface AuthLayoutProps {
  children: ReactNode;
  showMobileLogo?: boolean;
  wide?: boolean; // For subscription / URL picker stages that need more width
}

export function AuthLayout({ children, showMobileLogo = true, wide = false }: AuthLayoutProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getSavedTheme() === 'dark' ? 'dark' : 'light');
  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <div
      className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'theme-dark' : 'theme-light'} transition-colors duration-200`}
      style={{ backgroundColor: 'var(--auth-bg)', color: 'var(--auth-text-primary)' }}
    >
      {/* ── LEFT — Hero Video Panel (55%) ─────────────────── */}
      <div className="hidden lg:flex w-[55%] h-screen relative overflow-hidden">
        <HeroVideo
          videoSrc="/auth-hero.mp4"
          poster="/auth-poster.png"
        />
        {theme === 'light' && (
          <div className="absolute inset-0 bg-white/20 z-[2] pointer-events-none transition-opacity duration-200" />
        )}
      </div>

      {/* ── RIGHT — Auth Form Panel (45%) ─────────────────── */}
      <div className="w-full lg:w-[45%] h-screen relative overflow-y-auto px-6 sm:px-8 lg:px-16">
        <button type="button" onClick={toggleTheme} className="absolute right-6 top-6 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--auth-border)] text-[var(--auth-text-secondary)] transition-colors hover:bg-[var(--auth-input-bg)] hover:text-[var(--auth-text-primary)]" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>

        {/* Mobile Logo */}
        {showMobileLogo && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 md:hidden z-20">
            <img src="/vitalink-logo.png" alt="VitaLink" className={`h-5 w-auto ${theme === 'light' ? '' : 'invert'} opacity-90`} />
          </div>
        )}

        {/* Content remains centered while it fits, and becomes naturally scrollable on constrained viewports. */}
        <div className="flex min-h-full w-full flex-col items-center justify-center py-20">
          <div className={`w-full ${wide ? 'max-w-[840px]' : 'max-w-[380px]'} z-10`}>
            {children}
          </div>
          <div className="mt-8 w-full text-center text-xs text-gray-500 font-medium px-2">
            By continuing, you agree to VitaLink's{' '}
            <a href="#" className="text-gray-400 hover:text-[var(--auth-text-primary)] underline transition-colors">Terms of Service</a>
            {' '}and{' '}
            <a href="#" className="text-gray-400 hover:text-[var(--auth-text-primary)] underline transition-colors">Privacy Policy</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
