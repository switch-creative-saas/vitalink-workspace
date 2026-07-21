import { Button } from '@/components/ui/button';
import { Loader2, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

// Common minimal button wrapper for Grok-style
interface SocialButtonProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
}

function BaseSocialButton({ onClick, icon, label, disabled }: SocialButtonProps) {
  return (
    <Button
      variant="outline"
      className="w-full h-[50px] rounded-full bg-transparent border-[var(--auth-border)] text-[var(--auth-text-primary)] hover:bg-[var(--auth-border)] hover:text-[var(--auth-text-primary)] transition-colors relative justify-center text-[15px] font-medium"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="absolute left-6 flex items-center justify-center">
        {icon}
      </span>
      {label}
    </Button>
  );
}

export function GoogleButton({ onClick, disabled }: Omit<SocialButtonProps, 'icon' | 'label'>) {
  return (
    <BaseSocialButton
      onClick={onClick}
      disabled={disabled}
      label="Continue with Google"
      icon={
        disabled ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.6 14.7 2.7 12 2.7 6.9 2.7 2.7 6.9 2.7 12S6.9 21.3 12 21.3c6.9 0 9.1-4.8 9.1-7.3 0-.5 0-.9-.1-1.3H12z"/>
          </svg>
        )
      }
    />
  );
}

export function AppleButton({ onClick, disabled }: Omit<SocialButtonProps, 'icon' | 'label'>) {
  return (
    <BaseSocialButton
      onClick={onClick}
      disabled={disabled}
      label="Continue with Apple"
      icon={
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-[var(--auth-text-primary)]">
          <path d="M16.365 21.41c-1.393.991-2.915 1.056-4.321.037-1.464-1.042-2.951-1.042-4.402.019-1.503 1.096-3.125 1.036-4.354-.035-4.838-4.225-7.51-12.879-2.585-17.701 2.213-2.181 5.372-2.457 7.037-1.127 1.488 1.189 2.502 1.135 3.905-.03 2.184-1.815 5.568-1.378 7.027.915-4.636 2.302-3.805 9.155 1.097 10.976-1.082 3.036-2.079 5.862-3.404 6.946zM15.42 6.643c-.87.973-2.309 1.545-3.551 1.341-.284-1.442.366-2.88 1.171-3.791 1.01-1.138 2.535-1.637 3.655-1.376.242 1.542-.392 2.878-1.275 3.826z"/>
        </svg>
      }
    />
  );
}

export function MicrosoftButton({ onClick, disabled }: Omit<SocialButtonProps, 'icon' | 'label'>) {
  return (
    <BaseSocialButton
      onClick={onClick}
      disabled={disabled}
      label="Continue with Microsoft"
      icon={
        <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
          <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
        </svg>
      }
    />
  );
}

export function EmailButton({ onClick, label = "Continue with email", disabled }: Omit<SocialButtonProps, 'icon' | 'label'> & { label?: string }) {
  return (
    <BaseSocialButton
      onClick={onClick}
      disabled={disabled}
      label={label}
      icon={<Mail className="w-5 h-5 text-[var(--auth-text-secondary)]" />}
    />
  );
}

export function AuthDivider() {
  return (
    <div className="relative my-[18px] flex items-center justify-center">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-[var(--auth-border)]" />
      </div>
      <span className="relative bg-[var(--auth-card-bg)] px-4 text-[13px] text-[var(--auth-text-secondary)] font-medium transition-colors">
        or
      </span>
    </div>
  );
}
