// Which Sentinel guided tours someone has finished or dismissed. Saved to their account
// (user_tours, shared with the workspace app, so Sentinel tour ids start with "sentinel:"),
// with a copy on this device so it also works offline.
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export type TourStatus = 'completed' | 'dismissed';
export type TourProgress = Record<string, TourStatus>;

const cacheKey = (userId: string) => `sentinel-tours:${userId}`;

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return 'demo';
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function readCache(userId: string): TourProgress {
  try { return JSON.parse(localStorage.getItem(cacheKey(userId)) ?? '{}') as TourProgress; } catch { return {}; }
}

function writeCache(userId: string, progress: TourProgress) {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify(progress)); } catch { /* storage full or blocked */ }
}

export async function loadTourProgress(): Promise<TourProgress> {
  const userId = await currentUserId();
  if (!userId) return {};
  const cached = readCache(userId);
  if (!supabase || userId === 'demo') return cached;
  const { data, error } = await supabase.from('user_tours').select('tour_id, status');
  if (error) return cached;
  // Online, the account is the record (it may have been reset or updated on another device).
  const saved: TourProgress = {};
  for (const row of data ?? []) saved[row.tour_id as string] = row.status as TourStatus;
  writeCache(userId, saved);
  return saved;
}

export async function saveTourStatus(tourId: string, status: TourStatus) {
  const userId = await currentUserId();
  if (!userId) return;
  writeCache(userId, { ...readCache(userId), [tourId]: status });
  if (!supabase || userId === 'demo') return;
  await supabase.from('user_tours').upsert({ tour_id: tourId, status, updated_at: new Date().toISOString() }, { onConflict: 'user_id,tour_id' });
}

export async function resetTourProgress() {
  const userId = await currentUserId();
  if (!userId) return;
  writeCache(userId, {});
  if (!supabase || userId === 'demo') return;
  await supabase.from('user_tours').delete().eq('user_id', userId);
}
