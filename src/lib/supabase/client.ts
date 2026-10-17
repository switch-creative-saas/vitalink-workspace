import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// VITE_SUPABASE_ANON_KEY is the name the other VitaLink apps use; accept either.
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

// When the env vars are missing the app keeps running on the local mock auth,
// so UI work doesn't depend on a live backend.
export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  return supabase;
}

/**
 * Readable message for a failed Edge Function call: the function's own
 * `{ error }` body when there is one, otherwise the client's message.
 */
export async function functionErrorMessage(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: unknown } | null;
  const context = err?.context as Response | undefined;
  if (context && typeof context.json === 'function') {
    try {
      const body = await (typeof context.clone === 'function' ? context.clone() : context).json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // not JSON; fall through
    }
  }
  return err?.message || 'The request failed. Check your connection and try again.';
}
