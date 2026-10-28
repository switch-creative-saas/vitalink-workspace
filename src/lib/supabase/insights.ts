// VitaMind insights for the header AI panel (public.vitamind_insights): rule-based signals from the
// workspace's own records, filtered to what the signed-in role acts on, with per-user read/dismiss state.
import { requireSupabase } from './client';
import type { PageType, VitaMindAIInsight } from '@/types';

export type LiveInsight = VitaMindAIInsight & { page: PageType };

export async function listInsights(organizationId: string): Promise<LiveInsight[]> {
  const { data, error } = await requireSupabase().rpc('vitamind_insights', { p_organization_id: organizationId });
  if (error) throw error;
  return ((data ?? []) as LiveInsight[]).map((row) => ({ ...row, patientId: row.patientId ?? undefined, patientName: row.patientName ?? undefined }));
}

export async function markInsights(organizationId: string, keys: string[], action: 'read' | 'dismiss' = 'read') {
  if (!keys.length) return;
  const { error } = await requireSupabase().rpc('vitamind_mark_insights', { p_organization_id: organizationId, p_keys: keys, p_action: action });
  if (error) throw error;
}

/** The patient's VitaLink ID, used to open their EMR. */
export async function patientSwitchId(patientId: string): Promise<string | null> {
  const { data } = await requireSupabase().from('patients').select('switch_id').eq('id', patientId).maybeSingle();
  return data?.switch_id ?? null;
}
