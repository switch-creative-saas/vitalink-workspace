import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';

interface AuthFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}

export function AuthField({ label, value, onChange, type = 'text', placeholder, required, autoComplete }: AuthFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id} className="text-[13px] font-medium text-[var(--auth-text-primary)]">{label}</Label>}
      <div className="relative">
        <Input
          id={id}
          type={isPassword && visible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          className={`h-12 rounded-xl bg-[var(--auth-input-bg)] border-[var(--auth-input-border)] text-[var(--auth-text-primary)] placeholder:text-[var(--auth-text-secondary)]/60 focus-visible:ring-2 focus-visible:ring-[var(--auth-accent)]/20 focus-visible:border-[var(--auth-accent)] transition-colors px-4 shadow-none ${isPassword ? 'pr-11' : ''}`}
        />
        {isPassword && (
          <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--auth-text-secondary)] hover:text-[var(--auth-text-primary)]">
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

interface AuthButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  label: string;
}

export function AuthPrimaryButton({ onClick, loading, disabled, label }: AuthButtonProps) {
  return (
    <Button
      className="w-full h-12 rounded-full bg-[var(--auth-accent)] text-white hover:bg-[var(--auth-accent-hover)] disabled:opacity-40 font-semibold text-[15px] transition-colors mt-2 shadow-[0_10px_24px_-12px_rgba(30,78,216,0.7)]"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
      {label}
    </Button>
  );
}

export function TrustIndicator() {
  return (
    <div className="mt-3 text-center animate-[auth-form-slide-up_250ms_ease-out_forwards]">
      <p className="text-[12px] font-medium text-[var(--auth-text-secondary)] flex items-center justify-center gap-1.5">
        <LockKeyhole className="h-3.5 w-3.5" /> Secured by VitaLink · encrypted · works offline
      </p>
    </div>
  );
}
