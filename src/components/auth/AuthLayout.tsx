import { useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { AuthShowcase } from './AuthShowcase';
import { LegalLink } from './LegalLink';
import { applyTheme, getSavedTheme } from '@/lib/theme';

interface AuthLayoutProps {
  children: ReactNode;
  showMobileLogo?: boolean;
  wide?: boolean; // For subscription / URL picker stages that need more width
}

export function AuthLayout({ children, wide = false }: AuthLayoutProps) {
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
      {/* ── LEFT — artwork and product preview (hidden while choosing a plan, which needs the room) ── */}
      {!wide && (
        <div className="hidden h-screen w-[50%] max-w-[820px] shrink-0 p-4 lg:block">
          <AuthShowcase />
        </div>
      )}

      {/* ── RIGHT — logo, then the form card ─────────────── */}
      <div className="relative h-screen min-w-0 flex-1 overflow-y-auto px-5 sm:px-8 lg:px-12">
        <div className="flex min-h-full w-full flex-col py-6">
          <div className={`mx-auto flex w-full ${wide ? 'max-w-[880px]' : 'max-w-[520px]'} items-center justify-between`}>
            <img src="/vitalink-logo.png" alt="VitaLink" className={`h-7 w-auto ${theme === 'dark' ? 'brightness-0 invert' : ''}`} />
            <button type="button" onClick={toggleTheme} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--auth-border)] text-[var(--auth-text-secondary)] transition-colors hover:bg-[var(--auth-card-bg)] hover:text-[var(--auth-text-primary)]" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>

          {/* Content stays centred while it fits, and scrolls on short screens. */}
          <div className="flex flex-1 flex-col items-center justify-center py-8">
            <div className={`auth-card w-full ${wide ? 'max-w-[880px]' : 'max-w-[520px]'}`}>
              {children}
            </div>
            <p className="mt-6 w-full max-w-[520px] px-2 text-center text-xs text-[var(--auth-text-secondary)]">
              By continuing, you agree to VitaLink's{' '}
              <LegalLink doc="terms" className="font-medium text-[var(--auth-text-primary)] underline-offset-2 hover:underline">Terms of Use</LegalLink>
              {' '}and{' '}
              <LegalLink doc="privacy" className="font-medium text-[var(--auth-text-primary)] underline-offset-2 hover:underline">Privacy Policy</LegalLink>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
