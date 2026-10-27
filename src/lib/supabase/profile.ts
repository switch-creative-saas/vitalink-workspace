// My profile, synced preferences, in-app notifications and header search.
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './client';

export interface MyProfile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  phone: string;
  jobTitle: string;
  preferences: { theme?: 'light' | 'dark' | 'system'; fontScale?: number };
  notificationPrefs: Record<string, boolean>;
}

export const NOTIFICATION_KINDS = [
  { id: 'appointments', label: 'Appointments', description: 'Booked, moved to you, or cancelled' },
  { id: 'lab', label: 'Laboratory', description: 'Your results ready, critical results, urgent orders for lab staff' },
  { id: 'network', label: 'VitaLink Network', description: 'Referrals and transfers with other hospitals' },
  { id: 'staff', label: 'Staff', description: 'People accepting your invitations' },
  { id: 'billing', label: 'Billing', description: 'Subscription payments (admins)' },
  { id: 'support', label: 'Help & Support', description: 'Replies from the VitaLink team' },
  { id: 'security', label: 'Security', description: 'An admin ending one of your sessions' },
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['id'] | 'system';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  priority: 'normal' | 'high';
  readAt: string | null;
  createdAt: string;
}

const PROFILE_EVENT = 'vitalink:profile-updated';
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

type ProfileRow = {
  id: string; full_name: string | null; email: string | null; avatar_url: string | null; phone: string | null; job_title: string | null;
  preferences: MyProfile['preferences'] | null; notification_prefs: Record<string, boolean> | null;
};
const fromRow = (r: ProfileRow): MyProfile => ({
  id: r.id, fullName: r.full_name ?? '', email: r.email ?? '', avatarUrl: r.avatar_url, phone: r.phone ?? '', jobTitle: r.job_title ?? '',
  preferences: r.preferences ?? {}, notificationPrefs: r.notification_prefs ?? {},
});

export async function getMyProfile(): Promise<MyProfile | null> {
  const db = requireSupabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db.from('profiles')
    .select('id, full_name, email, avatar_url, phone, job_title, preferences, notification_prefs').eq('id', user.id).maybeSingle();
  fail(error);
  return data ? fromRow(data as ProfileRow) : null;
}

/** Tells every component showing the profile (header, settings) to reload it. */
export const announceProfileChange = () => window.dispatchEvent(new Event(PROFILE_EVENT));
export const onProfileChange = (fn: () => void) => {
  window.addEventListener(PROFILE_EVENT, fn);
  return () => window.removeEventListener(PROFILE_EVENT, fn);
};

export async function updateMyProfile(id: string, patch: Partial<Pick<MyProfile, 'fullName' | 'phone' | 'jobTitle' | 'preferences' | 'notificationPrefs'>>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName.trim();
  if (patch.phone !== undefined) row.phone = patch.phone.trim() || null;
  if (patch.jobTitle !== undefined) row.job_title = patch.jobTitle.trim() || null;
  if (patch.preferences !== undefined) row.preferences = patch.preferences;
  if (patch.notificationPrefs !== undefined) row.notification_prefs = patch.notificationPrefs;
  const { error } = await requireSupabase().from('profiles').update(row).eq('id', id);
  if (error) throw new Error(/phone/.test(error.message) ? 'Enter a valid phone number (digits, spaces, + or -).' : error.message);
  if (patch.fullName !== undefined) await requireSupabase().auth.updateUser({ data: { full_name: patch.fullName.trim() } }).catch(() => undefined);
  announceProfileChange();
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Photos must be 2 MB or smaller.');
  const db = requireSupabase();
  const path = `${userId}/avatar-${Date.now()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
  const { error } = await db.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true });
  fail(error);
  const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error: saveError } = await db.from('profiles').update({ avatar_url: url }).eq('id', userId);
  fail(saveError);
  announceProfileChange();
  return url;
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await requireSupabase().from('profiles').update({ avatar_url: null }).eq('id', userId);
  fail(error);
  announceProfileChange();
}

/** Sends a confirmation link to the new address; the change applies once it is clicked. */
export async function changeEmail(newEmail: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ email: newEmail.trim() }, { emailRedirectTo: `${window.location.origin}/settings` });
  fail(error);
}

/**
 * Re-checks the current password on a throwaway client (so this browser keeps
 * its session), ends that temporary session, then sets the new password.
 */
export async function changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
  const check = createClient(import.meta.env.VITE_SUPABASE_URL as string,
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'vitalink-password-check' } });
  const { error: authError } = await check.auth.signInWithPassword({ email, password: currentPassword });
  if (authError) throw new Error('Your current password is not correct.');
  await check.auth.signOut({ scope: 'local' }).catch(() => undefined);
  const { error } = await requireSupabase().auth.updateUser({ password: newPassword });
  if (error) throw new Error(/same|different/i.test(error.message) ? 'Choose a password different from your current one.' : error.message);
}

// ---------------------------------------------------------------------------
// Notifications

type NotificationRow = { id: number; kind: NotificationKind; title: string; body: string; link: string | null; priority: 'normal' | 'high'; read_at: string | null; created_at: string };
const fromNotification = (r: NotificationRow): AppNotification => ({
  id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, priority: r.priority, readAt: r.read_at, createdAt: r.created_at,
});

/** This workspace's notifications plus account-wide ones, newest first. */
export async function listNotifications(organizationId: string, limit = 30, before?: string): Promise<AppNotification[]> {
  let query = requireSupabase().from('user_notifications')
    .select('id, kind, title, body, link, priority, read_at, created_at')
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .order('created_at', { ascending: false }).limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  fail(error);
  return (data ?? []).map((r) => fromNotification(r as NotificationRow));
}

export async function markNotificationsRead(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await requireSupabase().from('user_notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
  fail(error);
}

export async function clearReadNotifications(organizationId: string): Promise<void> {
  const { error } = await requireSupabase().from('user_notifications').delete()
    .not('read_at', 'is', null).or(`organization_id.eq.${organizationId},organization_id.is.null`);
  fail(error);
}

export async function sendTestNotification(organizationId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('notify_test', { p_organization_id: organizationId });
  fail(error);
}

/** Calls back with each new notification for the signed-in user as it arrives. */
export function subscribeToNotifications(userId: string, onInsert: (n: AppNotification) => void): () => void {
  const db = requireSupabase();
  const channel: RealtimeChannel = db.channel(`notifications:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(fromNotification(payload.new as NotificationRow)))
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

// ---------------------------------------------------------------------------
// Header search

export interface SearchHit {
  type: 'patient' | 'appointment' | 'lab' | 'prescription' | 'staff';
  id: string;
  title: string;
  subtitle: string;
  switchId: string | null;
  status: string | null;
}

export async function globalSearch(organizationId: string, query: string): Promise<SearchHit[]> {
  const { data, error } = await requireSupabase().rpc('global_search', { p_organization_id: organizationId, p_query: query, p_limit: 5 });
  fail(error);
  return (data ?? []) as SearchHit[];
}
