import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { amIPlatformAdmin } from '@/lib/supabase/auth';

// One server check per page load; the console's data functions re-check on every call.
let cached: Promise<boolean> | null = null;

/** null while checking; true only for VitaLink platform admins (live workspaces only). */
export function usePlatformAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(isSupabaseConfigured ? null : false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    cached ??= amIPlatformAdmin().catch(() => false);
    cached.then((value) => { if (!cancelled) setIsAdmin(value); });
    return () => { cancelled = true; };
  }, []);
  return isAdmin;
}

/** Call after sign-out / sign-in so the next check asks the server again. */
export function resetPlatformAdminCheck() {
  cached = null;
}
