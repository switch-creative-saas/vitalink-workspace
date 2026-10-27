// Public health data sharing: Sentinel organisations (ministries, NCDC, NGOs)
// ask a hospital for de-identified disease reports; the hospital's admins decide.
import { requireSupabase } from './client';

export interface SentinelLink {
  id: string;
  sentinelOrg: string;
  sentinelType: string;
  sentinelState: string | null;
  status: 'pending' | 'approved' | 'declined' | 'revoked';
  requestedAt: string;
  consentedAt: string | null;
  casesShared: number;
  lastReportDate: string | null;
}

export async function listSentinelLinks(organizationId: string): Promise<SentinelLink[]> {
  const { data, error } = await requireSupabase().rpc('vitalink_sentinel_links', { p_org: organizationId });
  if (error) throw new Error(error.message);
  return (data ?? []) as SentinelLink[];
}

export async function respondToSentinelLink(linkId: string, decision: 'approved' | 'declined' | 'revoked'): Promise<void> {
  const { error } = await requireSupabase().rpc('vitalink_respond_sentinel_link', { p_link_id: linkId, p_decision: decision });
  if (error) throw new Error(error.message);
}
