import type { ReactNode } from 'react';
import { HeroVideo } from './HeroVideo';
import { useSystemTheme } from '@/hooks/useSystemTheme';

interface AuthLayoutProps {
  children: ReactNode;
  showMobileLogo?: boolean;
  wide?: boolean; // For subscription / URL picker stages that need more width
}

export function AuthLayout({ children, showMobileLogo = true, wide = false }: AuthLayoutProps) {
  const theme = useSystemTheme();

  return (
    <div
      className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'theme-dark' : 'theme-light'} transition-colors duration-200`}
      style={{ backgroundColor: 'var(--auth-bg)', color: 'var(--auth-text-primary)' }}
    >
      {/* ── LEFT — Hero Video Panel (55%) ─────────────────── */}
      <div className="hidden md:flex md:w-[50%] lg:w-[55%] h-screen relative">
        <HeroVideo
          videoSrc="/auth-hero.mp4"
          poster="/auth-poster.png"
        />
        {theme === 'light' && (
          <div className="absolute inset-0 bg-white/20 z-[2] pointer-events-none transition-opacity duration-200" />
        )}
      </div>

      {/* ── RIGHT — Auth Form Panel (45%) ─────────────────── */}
      <div className="w-full md:w-[50%] lg:w-[45%] h-screen flex flex-col justify-between relative auth-glass-panel overflow-hidden">

        {/* Mobile Logo */}
        {showMobileLogo && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 md:hidden z-20">
            <img src="/vitalink-logo.png" alt="VitaLink" className={`h-5 w-auto ${theme === 'light' ? '' : 'invert'} opacity-90`} />
          </div>
        )}

        {/* Center Auth Card — flex-1 centers vertically */}
        <div className="flex-1 flex items-center justify-center px-6 md:px-10 w-full">
          <div className={`w-full ${wide ? 'max-w-[780px]' : 'max-w-[560px]'} z-10`}>
            <div className="auth-glass-container relative z-10">
              {children}
            </div>
          </div>
        </div>

        {/* Pinned Legal Footer — flex flow aligned to bottom, never overlaps */}
        <div className="w-full text-center z-10 text-[12px] text-gray-500 font-medium pb-6 px-6">
          By continuing, you agree to VitaLink's{' '}
          <a href="#" className="text-gray-400 hover:text-[var(--auth-text-primary)] underline transition-colors">Terms of Service</a>
          {' '}and{' '}
          <a href="#" className="text-gray-400 hover:text-[var(--auth-text-primary)] underline transition-colors">Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}
