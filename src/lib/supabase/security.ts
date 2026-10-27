// Security & Audit: the workspace audit trail, sign-in sessions and the
// workspace security policy (idle sign-out, re-sign-in after N days).
import { requireSupabase } from './client';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'REVOKE';
export type AuditRisk = 'low' | 'medium' | 'high';

export interface AuditEvent {
  id: number;
  at: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: AuditAction;
  rawAction: string;
  entity: string;
  entityId: string | null;
  module: string;
  risk: AuditRisk;
  summary: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  flagged: boolean;
  flagNote: string | null;
  flaggedAt: string | null;
}

export interface AuditFilters {
  from?: string; to?: string; search?: string; module?: string; actor?: string; action?: string; risk?: string; flagged?: boolean;
}

export interface AuditFeed {
  total: number;
  stats: { events: number; high: number; deletes: number; signIns: number; flagged: number };
  rows: AuditEvent[];
  facets: { modules: string[]; actors: Array<{ id: string; name: string }>; actions: string[] };
  canSeeAll: boolean;
}

export interface SignInSession {
  id: string; userId: string; name: string | null; email: string | null; role: string;
  createdAt: string; lastActiveAt: string; ip: string | null; userAgent: string | null;
  mfa: boolean; isCurrent: boolean; expiresByPolicy: boolean;
}

export interface SecurityPolicy { idleTimeoutMinutes: number; maxSessionDays: number }

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const opt = (v: string | undefined) => (v && v !== 'all' ? v : null);

export async function getAuditFeed(organizationId: string, filters: AuditFilters, limit = 50, offset = 0): Promise<AuditFeed> {
  const { data, error } = await requireSupabase().rpc('security_audit_feed', {
    p_organization_id: organizationId, p_from: filters.from || null, p_to: filters.to || null, p_search: filters.search?.trim() || null,
    p_module: opt(filters.module), p_actor: opt(filters.actor), p_action: opt(filters.action), p_risk: opt(filters.risk),
    p_flagged: filters.flagged ?? null, p_limit: limit, p_offset: offset,
  });
  fail(error);
  return data as AuditFeed;
}

export async function flagAuditEvent(id: number, flagged: boolean, note?: string): Promise<void> {
  const { error } = await requireSupabase().rpc('security_flag_event', { p_log_id: id, p_flagged: flagged, p_note: note ?? null });
  fail(error);
}

export async function logSecurityEvent(action: 'sign_in' | 'sign_out' | 'export', organizationId?: string, details: Record<string, unknown> = {}): Promise<void> {
  const { error } = await requireSupabase().rpc('security_log_event', { p_action: action, p_organization_id: organizationId ?? null, p_details: details });
  fail(error);
}

export async function listSessions(organizationId: string): Promise<SignInSession[]> {
  const { data, error } = await requireSupabase().rpc('security_sessions', { p_organization_id: organizationId });
  fail(error);
  return (data ?? []) as SignInSession[];
}

export async function revokeSession(organizationId: string, sessionId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('security_revoke_session', { p_organization_id: organizationId, p_session_id: sessionId });
  fail(error);
}

export async function revokeAllSessions(organizationId: string, scope: 'mine' | 'workspace'): Promise<number> {
  const { data, error } = await requireSupabase().rpc('security_revoke_all', { p_organization_id: organizationId, p_scope: scope });
  fail(error);
  return Number(data ?? 0);
}

export async function getSecurityPolicy(organizationId: string): Promise<SecurityPolicy | null> {
  const { data, error } = await requireSupabase().rpc('security_policy', { p_organization_id: organizationId });
  fail(error);
  return data as SecurityPolicy | null;
}

export async function saveSecurityPolicy(organizationId: string, policy: SecurityPolicy): Promise<void> {
  const { error } = await requireSupabase().rpc('security_save_policy', {
    p_organization_id: organizationId, p_idle_timeout_minutes: policy.idleTimeoutMinutes, p_max_session_days: policy.maxSessionDays,
  });
  fail(error);
}

/** The Supabase session id inside the current access token. */
export async function currentSessionId(): Promise<string | null> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Records the sign-in once per session (page reloads reuse the session and are not logged). */
export async function recordSignInOnce(): Promise<void> {
  const sessionId = await currentSessionId();
  if (!sessionId) return;
  const key = `vitalink-signin-logged:${sessionId}`;
  try { if (localStorage.getItem(key)) return; } catch { /* storage unavailable: log anyway */ }
  await logSecurityEvent('sign_in');
  try { localStorage.setItem(key, '1'); } catch { /* not essential */ }
}

/** "Chrome on Windows" from a user-agent string. */
export function describeUserAgent(ua: string | null | undefined): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Deno|node|python|curl/i.test(ua) ? 'API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|Android|iPhone/.test(ua) };
}
