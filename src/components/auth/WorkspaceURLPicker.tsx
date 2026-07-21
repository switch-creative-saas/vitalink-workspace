import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, X, Loader2 } from 'lucide-react';

const RESERVED_NAMES = new Set([
  'admin', 'www', 'support', 'help', 'dashboard', 'mail', 'root',
  'portal', 'login', 'api', 'auth', 'vitalink', 'system', 'app',
  'billing', 'status', 'docs', 'dev', 'staging', 'test',
]);

interface WorkspaceURLPickerProps {
  orgName: string;
  onConfirm: (slug: string) => void;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 30);
}

function validateSlug(slug: string): string | null {
  if (slug.length < 3) return 'Minimum 3 characters';
  if (slug.length > 30) return 'Maximum 30 characters';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) return 'Only lowercase, numbers, and hyphens';
  if (RESERVED_NAMES.has(slug)) return 'This name is reserved';
  return null;
}

function generateSuggestions(slug: string): string[] {
  return [
    `${slug}1`,
    `${slug}-ng`,
    slug.replace(/([a-z])([a-z]+)$/, '$1-$2'),
    `${slug}hq`,
  ].filter(s => s !== slug && !RESERVED_NAMES.has(s)).slice(0, 3);
}

export function WorkspaceURLPicker({ orgName, onConfirm }: WorkspaceURLPickerProps) {
  const [slug, setSlug] = useState(() => generateSlug(orgName));
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<any>(null);

  const checkAvailability = useCallback((value: string) => {
    const validationError = validateSlug(value);
    if (validationError) {
      setError(validationError);
      setAvailable(null);
      setSuggestions([]);
      return;
    }

    setChecking(true);
    setError(null);
    setAvailable(null);
    setSuggestions([]);

    // Simulated availability check (debounced)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Simulate: check against existing orgs in localStorage
      const existingOrgs: string[] = (() => {
        try {
          const users = JSON.parse(localStorage.getItem('vitalink-auth-users') || '[]');
          return users.map((u: { orgSlug?: string }) => u.orgSlug).filter(Boolean);
        } catch { return []; }
      })();

      const taken = existingOrgs.includes(value) || RESERVED_NAMES.has(value);
      setAvailable(!taken);
      setChecking(false);

      if (taken) {
        setSuggestions(generateSuggestions(value));
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (slug.length >= 3) {
      checkAvailability(slug);
    } else {
      setAvailable(null);
      setError(slug.length > 0 ? 'Minimum 3 characters' : null);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slug, checkAvailability]);

  const handleSlugInput = (raw: string) => {
    const sanitized = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
    setSlug(sanitized);
  };

  const isValid = available === true && !error && !checking;

  return (
    <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-4">
      {/* Org Name (read-only) */}
      <div>
        <label className="block text-[12px] font-medium text-[var(--auth-text-secondary)] mb-1.5 ml-1">Organization Name</label>
        <div className="h-[48px] rounded-[14px] bg-[var(--auth-input-bg)] border border-[var(--auth-border)] text-[var(--auth-text-primary)] px-4 flex items-center text-[15px] opacity-70">
          {orgName}
        </div>
      </div>

      {/* Slug Input */}
      <div>
        <label className="block text-[12px] font-medium text-[var(--auth-text-secondary)] mb-1.5 ml-1">Workspace URL</label>
        <div className="flex items-center">
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugInput(e.target.value)}
            className="flex-1 h-[48px] rounded-l-[14px] bg-[var(--auth-input-bg)] border border-r-0 border-[var(--auth-input-border)] text-[var(--auth-text-primary)] px-4 text-[15px] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--auth-accent)] focus:border-[var(--auth-accent)] transition-colors"
            placeholder="yourworkspace"
          />
          <div className="h-[48px] rounded-r-[14px] bg-[var(--auth-input-bg)] border border-l-0 border-[var(--auth-input-border)] px-3 flex items-center text-[13px] text-[var(--auth-text-secondary)] font-medium">
            .vitalink.africa
          </div>
        </div>

        {/* Status indicator */}
        <div className="mt-2 ml-1 h-5 flex items-center gap-1.5">
          {checking && (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--auth-accent)]" />
              <span className="text-[12px] text-[var(--auth-text-secondary)]">Checking availability...</span>
            </>
          )}
          {!checking && available === true && (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" />
              <span className="text-[12px] text-green-500 font-medium">Available</span>
            </>
          )}
          {!checking && available === false && (
            <>
              <X className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[12px] text-red-400 font-medium">Already taken</span>
            </>
          )}
          {error && !checking && (
            <span className="text-[12px] text-red-400">{error}</span>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setSlug(s)}
              className="px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--auth-accent)]/10 text-[var(--auth-accent)] border border-[var(--auth-accent)]/20 hover:bg-[var(--auth-accent)]/20 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Live Preview */}
      {slug.length >= 3 && (
        <div className="rounded-xl border border-[var(--auth-border)] bg-[var(--auth-input-bg)] p-4 text-center">
          <p className="text-[11px] text-[var(--auth-text-secondary)] mb-1">Your team will sign in at</p>
          <p className="text-[15px] font-mono font-semibold text-[var(--auth-accent)]">
            https://{slug}.vitalink.africa
          </p>
          <p className="text-[10px] text-[var(--auth-text-secondary)] mt-1.5">
            Also accessible via app.vitalink.africa/{slug}
          </p>
        </div>
      )}

      {/* Continue */}
      <button
        disabled={!isValid}
        onClick={() => onConfirm(slug)}
        className="w-full h-[48px] rounded-full bg-[var(--auth-accent)] text-white hover:bg-[var(--auth-accent-hover)] disabled:opacity-40 font-semibold text-[14px] transition-colors shadow-[0_0_15px_rgba(123,77,255,0.25)]"
      >
        Continue
      </button>
    </div>
  );
}
