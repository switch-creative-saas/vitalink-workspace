import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface AuthFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}

export function AuthField({ label, value, onChange, type = 'text', placeholder, required }: AuthFieldProps) {
  return (
    <div className="space-y-2">
      {label && <Label className="text-[var(--auth-text-secondary)] ml-1">{label}</Label>}
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-[52px] rounded-[16px] bg-[var(--auth-input-bg)] border-[var(--auth-input-border)] text-[var(--auth-text-primary)] placeholder:text-[var(--auth-text-secondary)]/50 focus-visible:ring-1 focus-visible:ring-[var(--auth-accent)] focus-visible:border-[var(--auth-accent)] transition-colors px-4 shadow-sm"
      />
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
      className="w-full h-[52px] rounded-full bg-[var(--auth-accent)] text-white hover:bg-[var(--auth-accent-hover)] disabled:opacity-40 font-semibold text-[15px] transition-colors mt-2 shadow-[0_0_15px_rgba(94,44,237,0.3)]"
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
    <div className="mt-[18px] text-center animate-[auth-form-slide-up_250ms_ease-out_forwards]">
      <p className="text-[13px] font-medium text-[var(--auth-text-secondary)] flex items-center justify-center gap-1.5 mb-1">
        <span>🔒</span> Secured by VitaLink
      </p>
      <p className="text-[11px] text-[var(--auth-text-secondary)]/70">
        HIPAA-inspired security • End-to-end encryption • Offline-first architecture
      </p>
    </div>
  );
}
