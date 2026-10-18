// VitaLink Console data (platform admins only; every call is re-checked server side).
import { requireSupabase } from './client';

const toNaira = (kobo: unknown) => Number(kobo ?? 0) / 100;

function fail(error: { code?: string; message: string }): never {
  throw new Error(error.code === '42501' ? 'You do not have access to the VitaLink Console.' : error.message);
}

export interface ConsoleOverview {
  workspaces: number;
  workspacesNewThisMonth: number;
  users: number;
  usersNewThisMonth: number;
  paying: number;
  trialing: number;
  trialsEnding7d: number;
  comped: number;
  free: number;
  pastDue: number;
  pendingPayment: number;
  mrr: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  cardOrdersAwaitingPayment: number;
  cardOrdersToDispatch: number;
  cardOrdersInTransit: number;
  plans: Array<{ plan: string; count: number }>;
}

export async function getOverview(): Promise<ConsoleOverview> {
  const { data, error } = await requireSupabase().rpc('console_overview');
  if (error) fail(error);
  const r = data as Record<string, unknown>;
  return {
    workspaces: Number(r.workspaces), workspacesNewThisMonth: Number(r.workspaces_new_this_month),
    users: Number(r.users), usersNewThisMonth: Number(r.users_new_this_month),
    paying: Number(r.paying), trialing: Number(r.trialing), trialsEnding7d: Number(r.trials_ending_7d),
    comped: Number(r.comped), free: Number(r.free), pastDue: Number(r.past_due), pendingPayment: Number(r.pending_payment),
    mrr: toNaira(r.mrr_kobo), revenueThisMonth: toNaira(r.revenue_this_month_kobo), revenueLastMonth: toNaira(r.revenue_last_month_kobo),
    cardOrdersAwaitingPayment: Number(r.card_orders_awaiting_payment), cardOrdersToDispatch: Number(r.card_orders_to_dispatch),
    cardOrdersInTransit: Number(r.card_orders_in_transit),
    plans: ((r.plans as Array<{ plan: string; count: number }>) ?? []).map((item) => ({ plan: item.plan, count: Number(item.count) })),
  };
}

export interface ConsoleWorkspace {
  id: string;
  name: string;
  slug: string;
  organizationType: string;
  state: string;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  ownerEmail: string;
  planId: string;
  planName: string;
  effectivePlan: string;
  status: string;
  billingCycle: string;
  currentPeriodEnd: string | null;
  staffCount: number;
  patientCount: number;
  lastPaymentAt: string | null;
  revenue: number;
}

export async function listWorkspaces(search = ''): Promise<ConsoleWorkspace[]> {
  const { data, error } = await requireSupabase().rpc('console_workspaces', { p_search: search || null });
  if (error) fail(error);
  return (data as Array<Record<string, string | number | null>>).map((row) => ({
    id: String(row.id), name: String(row.name ?? ''), slug: String(row.slug ?? ''), organizationType: String(row.organization_type ?? ''),
    state: String(row.state ?? ''), contactEmail: String(row.contact_email ?? ''), contactPhone: String(row.contact_phone ?? ''),
    createdAt: String(row.created_at), ownerEmail: String(row.owner_email ?? ''), planId: String(row.plan_id ?? 'free'),
    planName: String(row.plan_name ?? ''), effectivePlan: String(row.effective_plan ?? 'free'), status: String(row.status ?? ''),
    billingCycle: String(row.billing_cycle ?? ''), currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    staffCount: Number(row.staff_count ?? 0), patientCount: Number(row.patient_count ?? 0),
    lastPaymentAt: (row.last_payment_at as string | null) ?? null, revenue: toNaira(row.revenue_kobo),
  }));
}

export interface WorkspaceDetail {
  workspace: Record<string, string | boolean | null>;
  subscription: {
    planId: string; planName: string; effectivePlan: string; status: string; billingCycle: string;
    currentPeriodEnd: string | null; hasRecurring: boolean; compedBy: string | null; updatedAt: string;
  } | null;
  counts: { patients: number; appointments30d: number; invoices30d: number; videoVisits30d: number };
  members: Array<{ name: string; email: string; role: string; status: string; joined: string; lastSignIn: string | null }>;
  payments: Array<{ reference: string; kind: string; planId: string; billingCycle: string; amount: number; setupFee: number; status: string; createdAt: string; paidAt: string | null }>;
  cardOrders: Array<{ orderNumber: string; quantity: number; total: number; status: string; paymentMethod: string; deliveryOption: string; deliveryAddress: string; contactName: string; contactPhone: string; orderedAt: string; paidAt: string | null }>;
  log: Array<{ action: string; actor: string; details: Record<string, unknown>; at: string }>;
}

export async function getWorkspace(id: string): Promise<WorkspaceDetail> {
  const { data, error } = await requireSupabase().rpc('console_workspace', { p_organization_id: id });
  if (error) fail(error);
  const r = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = r.subscription;
  return {
    workspace: r.workspace,
    subscription: s ? {
      planId: s.plan_id, planName: s.plan_name, effectivePlan: s.effective_plan, status: s.status, billingCycle: s.billing_cycle,
      currentPeriodEnd: s.current_period_end, hasRecurring: Boolean(s.has_recurring), compedBy: s.comped_by, updatedAt: s.updated_at,
    } : null,
    counts: {
      patients: Number(r.counts?.patients ?? 0), appointments30d: Number(r.counts?.appointments_30d ?? 0),
      invoices30d: Number(r.counts?.invoices_30d ?? 0), videoVisits30d: Number(r.counts?.video_visits_30d ?? 0),
    },
    members: (r.members ?? []).map((m: Record<string, string | null>) => ({
      name: m.name ?? '', email: m.email ?? '', role: m.role ?? '', status: m.status ?? '', joined: m.joined ?? '', lastSignIn: m.last_sign_in,
    })),
    payments: (r.payments ?? []).map((p: Record<string, string | number | null>) => ({
      reference: String(p.reference), kind: String(p.kind), planId: String(p.plan_id), billingCycle: String(p.billing_cycle),
      amount: toNaira(p.amount_kobo), setupFee: toNaira(p.setup_fee_kobo), status: String(p.status),
      createdAt: String(p.created_at), paidAt: (p.paid_at as string | null) ?? null,
    })),
    cardOrders: (r.card_orders ?? []).map((o: Record<string, string | number | null>) => ({
      orderNumber: String(o.order_number), quantity: Number(o.quantity), total: toNaira(o.total_kobo), status: String(o.status),
      paymentMethod: String(o.payment_method), deliveryOption: String(o.delivery_option), deliveryAddress: String(o.delivery_address ?? ''),
      contactName: String(o.contact_name ?? ''), contactPhone: String(o.contact_phone ?? ''),
      orderedAt: String(o.ordered_at), paidAt: (o.paid_at as string | null) ?? null,
    })),
    log: (r.log ?? []).map((l: Record<string, unknown>) => ({ action: String(l.action), actor: String(l.actor ?? ''), details: (l.details as Record<string, unknown>) ?? {}, at: String(l.at) })),
  };
}

export type SubscriptionAction = 'comp' | 'trial' | 'extend' | 'free';

export async function setSubscription(organizationId: string, action: SubscriptionAction, options: { planId?: string; days?: number; reason?: string }) {
  const { error } = await requireSupabase().rpc('console_set_subscription', {
    p_organization_id: organizationId,
    p_action: action,
    p_plan_id: options.planId ?? null,
    p_days: options.days ?? null,
    p_reason: options.reason ?? '',
  });
  if (error) fail(error);
}

export interface ConsolePayment {
  at: string | null;
  organizationId: string;
  organizationName: string;
  kind: 'subscription' | 'card_order';
  description: string;
  amount: number;
  status: string;
  reference: string;
}

export async function listPayments(limit = 300): Promise<ConsolePayment[]> {
  const { data, error } = await requireSupabase().rpc('console_payments', { p_limit: limit });
  if (error) fail(error);
  return (data as Array<Record<string, string | number | null>>).map((row) => ({
    at: (row.occurred_at as string | null) ?? null, organizationId: String(row.organization_id), organizationName: String(row.organization_name ?? ''),
    kind: row.kind as ConsolePayment['kind'], description: String(row.description ?? ''), amount: toNaira(row.amount_kobo),
    status: String(row.status), reference: String(row.reference ?? ''),
  }));
}

export interface ConsoleLogEntry { id: number; actorEmail: string; action: string; organizationId: string | null; details: Record<string, unknown>; at: string }

export async function listLog(limit = 300): Promise<ConsoleLogEntry[]> {
  const { data, error } = await requireSupabase().rpc('console_log', { p_limit: limit });
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id), actorEmail: String(row.actor_email ?? ''), action: String(row.action), organizationId: (row.organization_id as string | null) ?? null,
    details: (row.details as Record<string, unknown>) ?? {}, at: String(row.created_at),
  }));
}

export interface PlatformAdmin { email: string; addedAt: string; hasAccount: boolean; lastSignIn: string | null }

export async function listAdmins(): Promise<PlatformAdmin[]> {
  const { data, error } = await requireSupabase().rpc('console_admins');
  if (error) fail(error);
  return (data as Array<Record<string, string | boolean | null>>).map((row) => ({
    email: String(row.email), addedAt: String(row.added_at), hasAccount: Boolean(row.has_account), lastSignIn: (row.last_sign_in as string | null) ?? null,
  }));
}

export async function addAdmin(email: string) {
  const { error } = await requireSupabase().rpc('console_add_admin', { p_email: email });
  if (error) fail(error);
}

export async function removeAdmin(email: string) {
  const { error } = await requireSupabase().rpc('console_remove_admin', { p_email: email });
  if (error) fail(error);
}

// ---------- notifications feed & email alerts ----------

export type EventCategory = 'signups' | 'subscriptions' | 'payments' | 'orders' | 'support';
export const EVENT_CATEGORIES: Array<{ id: EventCategory; label: string; hint: string }> = [
  { id: 'payments', label: 'Payments', hint: 'Subscription payments, failed charges, paid card orders' },
  { id: 'orders', label: 'VitaCard orders', hint: 'New orders, cancellations, deliveries' },
  { id: 'subscriptions', label: 'Plans & trials', hint: 'Upgrades, trials, comps, overdue and cancelled plans' },
  { id: 'signups', label: 'Sign-ups', hint: 'New accounts and new workspaces' },
  { id: 'support', label: 'Help & Support', hint: 'New tickets, replies and reopened tickets' },
];

export interface PlatformEvent {
  id: number;
  category: EventCategory;
  type: string;
  title: string;
  body: string;
  organizationId: string | null;
  organizationName: string | null;
  ticketId: string | null;
  amount: number | null;
  actorEmail: string;
  at: string;
}

const toEvent = (row: Record<string, unknown>): PlatformEvent => ({
  id: Number(row.id), category: row.category as EventCategory, type: String(row.type ?? ''), title: String(row.title), body: String(row.body ?? ''),
  organizationId: (row.organization_id as string | null) ?? null, organizationName: (row.organization_name as string | null) ?? null,
  ticketId: (row.ticket_id as string | null) ?? null, amount: row.amount_kobo == null ? null : toNaira(row.amount_kobo),
  actorEmail: String(row.actor_email ?? ''), at: String(row.created_at),
});

export async function listFeed(options: { limit?: number; before?: string; category?: EventCategory } = {}) {
  const { data, error } = await requireSupabase().rpc('console_feed', {
    p_limit: options.limit ?? 50, p_before: options.before ?? null, p_category: options.category ?? null,
  });
  if (error) fail(error);
  const r = data as { unread: number; last_read_at: string; events: Array<Record<string, unknown>> };
  return { unread: Number(r.unread), lastReadAt: r.last_read_at, events: (r.events ?? []).map(toEvent) };
}

export async function markFeedRead() {
  const { error } = await requireSupabase().rpc('console_mark_feed_read');
  if (error) fail(error);
}

/** Re-runs onEvent for every new platform event (RLS limits it to platform admins). */
export function subscribeToEvents(onEvent: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`console-events-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_events' }, onEvent)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

export interface AlertPrefs { email: string; emailEnabled: boolean; categories: EventCategory[]; includeOwnActions: boolean }

export async function getAlertPrefs(): Promise<AlertPrefs> {
  const { data, error } = await requireSupabase().rpc('console_my_prefs');
  if (error) fail(error);
  const r = data as Record<string, unknown>;
  return { email: String(r.email), emailEnabled: Boolean(r.email_enabled), categories: (r.categories as EventCategory[]) ?? [], includeOwnActions: Boolean(r.include_own_actions) };
}

export async function saveAlertPrefs(prefs: Omit<AlertPrefs, 'email'>) {
  const { error } = await requireSupabase().rpc('console_save_prefs', {
    p_email_enabled: prefs.emailEnabled, p_categories: prefs.categories, p_include_own: prefs.includeOwnActions,
  });
  if (error) fail(error);
}

export interface OutboxStatus { pending: number; sent24h: number; failed24h: number; lastSentAt: string | null; lastError: string | null }

export async function getOutboxStatus(): Promise<OutboxStatus> {
  const { data, error } = await requireSupabase().rpc('console_outbox_status');
  if (error) fail(error);
  const r = data as Record<string, unknown>;
  return {
    pending: Number(r.pending ?? 0), sent24h: Number(r.sent_24h ?? 0), failed24h: Number(r.failed_24h ?? 0),
    lastSentAt: (r.last_sent_at as string | null) ?? null, lastError: (r.last_error as string | null) ?? null,
  };
}

// ---------- CRM ----------

export interface WorkspaceCrm {
  notes: Array<{ id: string; author: string; body: string; at: string }>;
  tickets: Array<{ id: string; number: string; subject: string; status: string; kind: string; priority: string; lastMessageAt: string; staffUnread: boolean }>;
  events: Array<{ id: number; category: EventCategory; title: string; body: string; amount: number | null; at: string }>;
}

export async function getWorkspaceCrm(organizationId: string): Promise<WorkspaceCrm> {
  const { data, error } = await requireSupabase().rpc('console_workspace_crm', { p_organization_id: organizationId });
  if (error) fail(error);
  const r = data as Record<string, Array<Record<string, unknown>>>;
  return {
    notes: (r.notes ?? []).map((n) => ({ id: String(n.id), author: String(n.author), body: String(n.body), at: String(n.created_at) })),
    tickets: (r.tickets ?? []).map((t) => ({
      id: String(t.id), number: String(t.number), subject: String(t.subject), status: String(t.status), kind: String(t.kind),
      priority: String(t.priority), lastMessageAt: String(t.last_message_at), staffUnread: Boolean(t.staff_unread),
    })),
    events: (r.events ?? []).map((e) => ({
      id: Number(e.id), category: e.category as EventCategory, title: String(e.title), body: String(e.body ?? ''),
      amount: e.amount_kobo == null ? null : toNaira(e.amount_kobo), at: String(e.created_at),
    })),
  };
}

export async function addNote(organizationId: string, body: string) {
  const { error } = await requireSupabase().rpc('console_add_note', { p_organization_id: organizationId, p_body: body.trim() });
  if (error) fail(error);
}

export async function deleteNote(noteId: string) {
  const { error } = await requireSupabase().rpc('console_delete_note', { p_note_id: noteId });
  if (error) fail(error);
}

// ---------- support contact details shown on every workspace's Help page ----------

export async function saveSupportContact(contact: { email: string; phone: string; whatsapp: string; hours: string }) {
  const { error } = await requireSupabase()
    .from('platform_settings')
    .update({ support_email: contact.email.trim(), support_phone: contact.phone.trim(), support_whatsapp: contact.whatsapp.trim(), support_hours: contact.hours.trim(), updated_at: new Date().toISOString() })
    .not('id', 'is', null);
  if (error) fail(error);
}

// ---------- VitaLink Network verification ----------

export async function getNetworkStatus(organizationId: string): Promise<{ listed: boolean; verifiedAt: string | null; verifiedBy: string | null }> {
  const { data, error } = await requireSupabase().from('network_profiles').select('visible_in_directory, verified_at, verified_by').eq('organization_id', organizationId).maybeSingle();
  if (error) fail(error);
  return { listed: Boolean(data?.visible_in_directory), verifiedAt: data?.verified_at ?? null, verifiedBy: data?.verified_by ?? null };
}

export async function setNetworkVerified(organizationId: string, verified: boolean) {
  const { error } = await requireSupabase().rpc('console_verify_network_org', { p_organization_id: organizationId, p_verified: verified });
  if (error) fail(error);
}
