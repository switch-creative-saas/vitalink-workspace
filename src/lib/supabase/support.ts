// Help & Support tickets. Staff send help requests to their workspace admins (audience 'internal');
// workspace admins answer those and talk to VitaLink (audience 'vitalink'), whose staff answer from
// the console inbox (console_* functions, platform admins only).
import { requireSupabase } from './client';

export type TicketKind = 'support' | 'bug' | 'feedback' | 'feature' | 'chat';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AuthorKind = 'customer' | 'staff' | 'admin' | 'system';
export type TicketAudience = 'vitalink' | 'internal';

export const TICKET_CATEGORIES = ['general', 'account', 'billing', 'appointments', 'emr', 'laboratory', 'pharmacy', 'telemedicine', 'vitacards', 'other'] as const;

export const KIND_LABEL: Record<TicketKind, string> = {
  support: 'Support request', bug: 'Bug report', feedback: 'Feedback', feature: 'Feature request', chat: 'Chat',
};
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open', pending: 'Awaiting your reply', resolved: 'Resolved', closed: 'Closed',
};

export interface Attachment { name: string; path: string; size: number; type: string }

export interface SupportTicket {
  id: string;
  number: string;
  kind: TicketKind;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  audience: TicketAudience;
  assignedTo: string | null;
  staffUnread: boolean;
  escalatedAt: string | null;
  subject: string;
  createdBy: string | null;
  createdByName: string;
  customerUnread: boolean;
  lastMessageAt: string;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  authorKind: AuthorKind;
  authorId?: string | null;
  author: string;
  authorEmail: string | null;
  body: string;
  internal: boolean;
  attachments: Attachment[];
  createdAt: string;
}

const BUCKET = 'support-attachments';
const MAX_BYTES = 10 * 1024 * 1024;

function fail(error: { code?: string; message: string }): never {
  if (error.code === '42501') throw new Error(/VitaLink support/.test(error.message) ? error.message : 'You do not have access to that.');
  throw new Error(error.message);
}

// ---------- attachments ----------

export async function uploadAttachments(organizationId: string, files: File[]): Promise<Attachment[]> {
  const db = requireSupabase();
  const uploaded: Attachment[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const path = `${organizationId}/${crypto.randomUUID()}/${safeName}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (error) {
      throw new Error(/mime type|not supported/i.test(error.message)
        ? `${file.name}: that file type is not allowed. Use images, PDF, Word, Excel, CSV or text files.`
        : error.message);
    }
    uploaded.push({ name: file.name, path, size: file.size, type: file.type });
  }
  return uploaded;
}

export async function attachmentLink(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error || !data) throw new Error(error?.message ?? 'Could not open the file');
  return data.signedUrl;
}

// ---------- customer side ----------

type TicketRow = {
  id: string; number: string; kind: TicketKind; category: string; priority: TicketPriority; status: TicketStatus;
  subject: string; created_by: string | null; customer_unread: boolean; last_message_at: string; created_at: string;
  audience: TicketAudience; assigned_to: string | null; staff_unread: boolean; escalated_at: string | null;
  creator: { full_name: string; email: string } | null;
};

export async function listMyTickets(organizationId: string): Promise<SupportTicket[]> {
  const { data, error } = await requireSupabase()
    .from('support_tickets')
    .select('id, number, kind, category, priority, status, subject, created_by, customer_unread, last_message_at, created_at, audience, assigned_to, staff_unread, escalated_at, creator:profiles!support_tickets_created_by_fkey(full_name, email)')
    .eq('organization_id', organizationId)
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) fail(error);
  return (data as unknown as TicketRow[]).map((row) => ({
    id: row.id, number: row.number, kind: row.kind, category: row.category, priority: row.priority, status: row.status,
    audience: row.audience, assignedTo: row.assigned_to, staffUnread: row.staff_unread, escalatedAt: row.escalated_at,
    subject: row.subject, createdBy: row.created_by, createdByName: row.creator?.full_name || row.creator?.email || 'Former colleague',
    customerUnread: row.customer_unread, lastMessageAt: row.last_message_at, createdAt: row.created_at,
  }));
}

/**
 * Messages on a ticket. RLS hides VitaLink's internal notes from workspaces and workspace admins'
 * notes from staff; `withAdminNotes` keeps workspace admins' own notes (VitaLink notes stay hidden
 * for VitaLink admins who happen to be members of the workspace).
 */
export async function listMessages(ticketId: string, withAdminNotes = false): Promise<SupportMessage[]> {
  const { data, error } = await requireSupabase()
    .from('support_messages')
    .select('id, author_id, author_kind, body, internal, attachments, created_at, author:profiles!support_messages_author_id_fkey(full_name, email)')
    .eq('ticket_id', ticketId)
    .order('created_at');
  if (error) fail(error);
  const rows = (data as unknown as Array<{ internal: boolean; author_kind: AuthorKind }>)
    .filter((row) => !row.internal || (withAdminNotes && row.author_kind === 'admin'));
  return (rows as unknown as Array<{
    id: string; author_id: string | null; author_kind: AuthorKind; body: string; internal: boolean; attachments: Attachment[]; created_at: string;
    author: { full_name: string; email: string } | null;
  }>).map((row) => ({
    id: row.id, authorId: row.author_id, authorKind: row.author_kind, body: row.body, internal: row.internal, attachments: row.attachments ?? [],
    createdAt: row.created_at, authorEmail: row.author?.email ?? null,
    // Customers can't read VitaLink staff profiles; staff show as the support team.
    author: row.author_kind === 'staff' ? 'VitaLink Support' : row.author?.full_name || row.author?.email || 'Former colleague',
  }));
}

/** Staff requests always go to the workspace admins; only admins can address VitaLink (the server enforces this). */
export async function createTicket(input: {
  organizationId: string; kind: TicketKind; subject: string; body: string; category?: string; priority?: TicketPriority; files?: File[]; audience?: TicketAudience;
}): Promise<string> {
  const attachments = input.files?.length ? await uploadAttachments(input.organizationId, input.files) : [];
  const { data, error } = await requireSupabase().rpc('support_create_ticket', {
    p_organization_id: input.organizationId,
    p_kind: input.kind,
    p_subject: input.subject.trim(),
    p_body: input.body.trim(),
    p_category: input.category ?? 'general',
    p_priority: input.priority ?? 'normal',
    p_attachments: attachments,
    p_audience: input.audience ?? null,
  });
  if (error) fail(error);
  return data as string;
}

export async function reply(ticketId: string, organizationId: string, body: string, options: { files?: File[]; internal?: boolean; asStaff?: boolean; asAdmin?: boolean } = {}) {
  const attachments = options.files?.length ? await uploadAttachments(organizationId, options.files) : [];
  const { error } = await requireSupabase().rpc('support_reply', {
    p_ticket_id: ticketId, p_body: body.trim(), p_internal: Boolean(options.internal), p_attachments: attachments, p_as_staff: Boolean(options.asStaff), p_as_admin: Boolean(options.asAdmin),
  });
  if (error) fail(error);
}

export async function updateTicket(ticketId: string, changes: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string }, asStaff = false, asAdmin = false) {
  const { error } = await requireSupabase().rpc('support_update_ticket', {
    p_ticket_id: ticketId,
    p_status: changes.status ?? null,
    p_priority: changes.priority ?? null,
    p_assigned_to: changes.assignedTo ?? null,
    p_as_staff: asStaff,
    p_as_admin: asAdmin,
  });
  if (error) fail(error);
}

/** A workspace admin hands a staff help request to VitaLink Support. */
export async function escalateTicket(ticketId: string, note?: string) {
  const { error } = await requireSupabase().rpc('support_escalate', { p_ticket_id: ticketId, p_note: note?.trim() || null });
  if (error) fail(error);
}

export async function markRead(ticketId: string, asStaff = false) {
  await requireSupabase().rpc('support_mark_read', { p_ticket_id: ticketId, p_as_staff: asStaff });
}

/** Re-runs onChange whenever a ticket or message in the workspace changes. */
export function subscribeToWorkspaceSupport(organizationId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`support-${organizationId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets', filter: `organization_id=eq.${organizationId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `organization_id=eq.${organizationId}` }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

export interface SupportContact { email: string; phone: string; whatsapp: string; hours: string }

export async function getSupportContact(): Promise<SupportContact> {
  const { data, error } = await requireSupabase().from('platform_settings').select('support_email, support_phone, support_whatsapp, support_hours').maybeSingle();
  if (error) fail(error);
  return { email: data?.support_email ?? '', phone: data?.support_phone ?? '', whatsapp: data?.support_whatsapp ?? '', hours: data?.support_hours ?? '' };
}

// ---------- VitaLink staff (console) ----------

export type InboxView = 'open' | 'unread' | 'mine' | 'resolved' | 'all';

export interface InboxTicket {
  id: string; number: string; kind: TicketKind; category: string; priority: TicketPriority; status: TicketStatus; subject: string;
  organizationId: string; organizationName: string; requesterName: string; requesterEmail: string | null;
  assignedTo: string | null; staffUnread: boolean; lastMessageAt: string; createdAt: string; firstResponseAt: string | null;
  messageCount: number; lastMessage: string; lastAuthorKind: AuthorKind | null;
}

export async function listInbox(view: InboxView, search = '', organizationId?: string): Promise<InboxTicket[]> {
  const { data, error } = await requireSupabase().rpc('console_inbox', { p_view: view, p_search: search || null, p_organization_id: organizationId ?? null });
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), number: String(row.number), kind: row.kind as TicketKind, category: String(row.category),
    priority: row.priority as TicketPriority, status: row.status as TicketStatus, subject: String(row.subject),
    organizationId: String(row.organization_id), organizationName: String(row.organization_name ?? ''),
    requesterName: String(row.requester_name ?? ''), requesterEmail: (row.requester_email as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null, staffUnread: Boolean(row.staff_unread),
    lastMessageAt: String(row.last_message_at), createdAt: String(row.created_at), firstResponseAt: (row.first_response_at as string | null) ?? null,
    messageCount: Number(row.message_count ?? 0), lastMessage: String(row.last_message ?? ''), lastAuthorKind: (row.last_author_kind as AuthorKind | null) ?? null,
  }));
}

export interface ConsoleTicket {
  ticket: { id: string; number: string; kind: TicketKind; category: string; priority: TicketPriority; status: TicketStatus; subject: string; assignedTo: string | null; createdAt: string; organizationId: string };
  organization: { id: string; name: string; type: string; state: string; contactEmail: string; contactPhone: string; plan: string } | null;
  requester: { name: string; email: string; role: string | null } | null;
  messages: SupportMessage[];
  otherTickets: Array<{ id: string; number: string; subject: string; status: TicketStatus; createdAt: string }>;
}

export async function getConsoleTicket(ticketId: string): Promise<ConsoleTicket> {
  const { data, error } = await requireSupabase().rpc('console_ticket', { p_ticket_id: ticketId });
  if (error) fail(error);
  const r = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = r.ticket;
  const o = r.organization;
  return {
    ticket: {
      id: t.id, number: t.number, kind: t.kind, category: t.category, priority: t.priority, status: t.status, subject: t.subject,
      assignedTo: t.assigned_to, createdAt: t.created_at, organizationId: t.organization_id,
    },
    organization: o ? { id: o.id, name: o.name, type: o.type ?? '', state: o.state ?? '', contactEmail: o.contact_email ?? '', contactPhone: o.contact_phone ?? '', plan: o.plan ?? '' } : null,
    requester: r.requester ? { name: r.requester.name, email: r.requester.email, role: r.requester.role } : null,
    messages: (r.messages ?? []).map((m: Record<string, unknown>) => ({
      id: String(m.id), authorKind: m.author_kind as AuthorKind, author: String(m.author ?? ''), authorEmail: (m.author_email as string | null) ?? null,
      body: String(m.body), internal: Boolean(m.internal), attachments: (m.attachments as Attachment[]) ?? [], createdAt: String(m.created_at),
    })),
    otherTickets: (r.other_tickets ?? []).map((x: Record<string, string>) => ({ id: x.id, number: x.number, subject: x.subject, status: x.status as TicketStatus, createdAt: x.created_at })),
  };
}

/** Console: re-runs onChange on any ticket / message change (RLS limits it to platform admins). */
export function subscribeToAllSupport(onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`console-support-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}
