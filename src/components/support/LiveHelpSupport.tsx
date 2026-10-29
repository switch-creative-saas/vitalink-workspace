// Help & Support for live workspaces. Staff send help requests to their own workspace admins
// (an internal help desk); workspace admins work those requests like a small CRM (assign, prioritise,
// reply, private notes, escalate) and are the ones who talk to the VitaLink team.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, Bug, CheckCircle2, Headphones, Inbox, LifeBuoy, Lock, Mail, MessageCircle, Paperclip, Phone, RefreshCw, Search, Send,
  ShieldCheck, Sparkles, Users, Wifi, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { GuidedToursList } from '@/components/tours/GuidedToursList';
import { requireSupabase } from '@/lib/supabase/client';
import { listStaff } from '@/lib/supabase/staff';
import {
  KIND_LABEL, STATUS_LABEL, TICKET_CATEGORIES, createTicket, escalateTicket, getSupportContact, listMessages, listMyTickets, markRead, reply,
  subscribeToWorkspaceSupport, updateTicket,
  type SupportContact, type SupportMessage, type SupportTicket, type TicketKind, type TicketPriority, type TicketStatus,
} from '@/lib/supabase/support';
import { AttachmentChips } from './AttachmentChips';
import { timeAgo } from '@/lib/timeAgo';
import type { PageType } from '@/types';

const WORKSPACE_ADMIN_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];

const STATUS_TONE: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800', pending: 'bg-sky-100 text-sky-800', resolved: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-100 text-slate-600',
};
const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: 'bg-slate-100 text-slate-600', normal: 'bg-blue-50 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700',
};
// What the requester sees: "pending" means someone replied and is waiting on them.
const requesterStatus = (t: SupportTicket) => (t.status === 'open' ? (t.audience === 'internal' ? 'Waiting for your admin' : 'Waiting for VitaLink') : t.status === 'pending' ? STATUS_LABEL.pending : t.status === 'resolved' ? 'Resolved' : 'Closed');
// What the admin desk sees.
const DESK_STATUS: Record<TicketStatus, string> = { open: 'Needs reply', pending: 'Waiting on requester', resolved: 'Resolved', closed: 'Closed' };

type Copy = { title: string; description: string; subject: string; body: string };
const VITALINK_COPY: Record<TicketKind, Copy> = {
  support: { title: 'Contact VitaLink support', description: 'Ask the VitaLink team for help. You will get replies here and by email.', subject: 'What do you need help with?', body: 'Tell us what happened and what you expected. Include patient IDs or invoice numbers if relevant.' },
  bug: { title: 'Report a problem to VitaLink', description: 'Something not working as it should? Screenshots help us fix it faster.', subject: 'What went wrong?', body: 'Steps to reproduce: what you clicked, what you expected, what happened instead.' },
  feature: { title: 'Request a feature', description: 'Tell us what would make VitaLink work better for your team.', subject: 'What would you like VitaLink to do?', body: 'Describe the problem it would solve and who on your team would use it.' },
  feedback: { title: 'Send feedback', description: 'Praise, complaints and ideas all go straight to the VitaLink team.', subject: 'Summary', body: 'Your feedback' },
  chat: { title: 'Chat with VitaLink', description: 'Start a conversation. Replies appear here as soon as the team answers.', subject: 'Topic', body: 'Your message' },
};
const INTERNAL_COPY: Record<TicketKind, Copy> = {
  support: { title: 'Ask for help', description: 'Your request goes to your workspace admins. You will be notified here when they reply.', subject: 'What do you need help with?', body: 'What are you trying to do, and what happened? Include patient IDs or invoice numbers if relevant.' },
  bug: { title: 'Report a problem', description: 'Tell your admins what isn’t working. They can bring in VitaLink if needed.', subject: 'What went wrong?', body: 'What you clicked, what you expected, what happened instead. A screenshot helps.' },
  feature: { title: 'Suggest an improvement', description: 'Your admins review ideas and pass the good ones to VitaLink.', subject: 'What would make your work easier?', body: 'Describe the problem it would solve.' },
  feedback: { title: 'Share feedback', description: 'Goes to your workspace admins.', subject: 'Summary', body: 'Your feedback' },
  chat: { title: 'Message your admins', description: 'Goes to your workspace admins.', subject: 'Topic', body: 'Your message' },
};

type Guide = { title: string; area: string; page: PageType; steps: string[] };
const GUIDES: Guide[] = [
  { title: 'Register a patient and open their record', area: 'Patients', page: 'patients', steps: ['Patients → Register patient.', 'Fill in their details and allergies, then save.', 'Open the patient to see their EMR, visits, labs, prescriptions and documents.'] },
  { title: 'Book an appointment and send a reminder', area: 'Appointments', page: 'appointments', steps: ['Appointments → Book appointment, pick the patient, clinician and time.', 'Use Remind to email the patient (needs an email on file).', 'Check the patient in when they arrive; the queue updates live.'] },
  { title: 'Order a lab test and publish results', area: 'Laboratory', page: 'laboratory', steps: ['Laboratory → New order (or Order lab from the patient record).', 'Move it to Processing when the sample is collected.', 'Enter results, Save draft while working, then Submit to publish them to the EMR.'] },
  { title: 'Dispense a prescription', area: 'Pharmacy', page: 'pharmacy', steps: ['Prescriptions written in the EMR appear in Pharmacy.', 'VitaLink checks the patient\'s allergies before dispensing.', 'Dispense from stock; low stock shows on the inventory tab.'] },
  { title: 'Create an invoice and record payment', area: 'Billing', page: 'billing', steps: ['Billing → New invoice, choose the patient and add services.', 'Unbilled labs and prescriptions can be pulled in automatically.', 'Record payments as they come in; the invoice status updates itself.'] },
  { title: 'Run a video visit', area: 'Telemedicine', page: 'telemedicine', steps: ['Telemedicine → New visit, then share the patient link (WhatsApp, SMS or copy).', 'The patient opens it on their phone; no app or account needed.', 'Admit them from the waiting room when you are ready.'] },
  { title: 'Order VitaCards and link them to patients', area: 'VitaCards', page: 'nfc-cards', steps: ['VitaCards → Order cards, choose quantity, delivery and payment.', 'When they arrive, link a card from Digital Health Identity.', 'Tap or scan a card to pull up the patient instantly.'] },
  { title: 'Invite staff and set their roles', area: 'Administration', page: 'administration', steps: ['Administration → Staff → Invite.', 'Pick a role; it controls which pages and records they can open.', 'They get an email invite and join your workspace on sign-up.'] },
  { title: 'Change plan or billing cycle', area: 'Subscription', page: 'subscription', steps: ['Subscription shows your plan, what it includes and when it renews.', 'Upgrade or switch monthly/annual; payment is through Paystack.', 'Contact support for invoices or custom Enterprise terms.'] },
];

const navigate = (page: PageType) => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page } }));
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type Admin = { email: string; name: string };

export function LiveHelpSupport() {
  const { organization, currentRole } = useAuth();
  const orgId = organization.id;
  const isWorkspaceAdmin = WORKSPACE_ADMIN_ROLES.includes(currentRole);

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<TicketKind | null>(null);
  const [contact, setContact] = useState<SupportContact | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState('');
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [tab, setTab] = useState<'team' | 'vitalink'>('team');
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    listMyTickets(orgId).then(setTickets).catch((error) => { toast.error(errorText(error, 'Could not load your conversations')); setTickets([]); });
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToWorkspaceSupport(orgId, load), [orgId, load]);
  useEffect(() => {
    requireSupabase().auth.getUser().then(({ data }) => { setMyId(data.user?.id ?? null); setMyEmail(data.user?.email?.toLowerCase() ?? ''); });
    listStaff(orgId)
      .then((staff) => setAdmins(staff.filter((s) => s.status === 'active' && WORKSPACE_ADMIN_ROLES.includes(s.role)).map((s) => ({ email: s.email.toLowerCase(), name: s.fullName || s.email }))))
      .catch(() => undefined);
  }, [orgId]);
  useEffect(() => { if (isWorkspaceAdmin) getSupportContact().then(setContact).catch(() => undefined); }, [isWorkspaceAdmin]);

  // Admins: requests from their team (internal) vs their own conversations with VitaLink.
  const teamRequests = useMemo(() => (tickets ?? []).filter((t) => t.audience === 'internal'), [tickets]);
  const mine = useMemo(() => (tickets ?? []).filter((t) => (isWorkspaceAdmin ? t.audience === 'vitalink' : true)), [tickets, isWorkspaceAdmin]);
  const visibleMine = mine.filter((t) => showClosed || t.status !== 'closed');
  const unreadMine = mine.filter((t) => t.customerUnread && (t.createdBy === myId || t.audience === 'vitalink')).length;
  const unreadTeam = teamRequests.filter((t) => t.staffUnread && t.status !== 'closed').length;
  const guides = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return GUIDES;
    return GUIDES.filter((g) => `${g.title} ${g.area} ${g.steps.join(' ')}`.toLowerCase().includes(term));
  }, [search]);
  const openTicket = tickets?.find((t) => t.id === openTicketId) ?? null;
  const deskMode = isWorkspaceAdmin && openTicket?.audience === 'internal';

  const actions: Array<{ kind: TicketKind; label: string; hint: string; icon: React.ElementType }> = isWorkspaceAdmin
    ? [
        { kind: 'chat', label: 'Chat with VitaLink', hint: 'Quick questions, live replies', icon: MessageCircle },
        { kind: 'support', label: 'Contact VitaLink', hint: 'Something you need help with', icon: Headphones },
        { kind: 'bug', label: 'Report a problem', hint: 'Something is broken', icon: Bug },
        { kind: 'feature', label: 'Request a feature', hint: 'Something VitaLink should do', icon: Sparkles },
      ]
    : [
        { kind: 'support', label: 'Ask for help', hint: 'Goes to your workspace admins', icon: Headphones },
        { kind: 'bug', label: 'Report a problem', hint: 'Something isn’t working', icon: Bug },
        { kind: 'feature', label: 'Suggest an improvement', hint: 'An idea for your team', icon: Sparkles },
        { kind: 'feedback', label: 'Share feedback', hint: 'Tell your admins what you think', icon: LifeBuoy },
      ];

  const conversationList = (
    <div className="premium-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">
          {isWorkspaceAdmin ? 'Conversations with VitaLink' : 'Your requests'}
          {unreadMine > 0 && <span className="ml-2 rounded-full bg-royal-600 px-2 py-0.5 text-xs text-white">{unreadMine} new</span>}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show closed</label>
          <Button size="sm" variant="ghost" onClick={load} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      {tickets === null && <p className="text-sm text-gray-500">Loading...</p>}
      {tickets && visibleMine.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
          <LifeBuoy className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          {isWorkspaceAdmin ? 'No conversations with VitaLink yet. Use the buttons above to reach the team.' : 'No requests yet. Use the buttons above to ask your workspace admins for help.'}
        </div>
      )}
      <div className="space-y-2">
        {visibleMine.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpenTicketId(t.id)}
            className={cn('w-full rounded-xl border p-3 text-left transition hover:border-royal-200 hover:bg-royal-50/40', t.customerUnread ? 'border-royal-200 bg-royal-50/60' : 'border-gray-100 bg-gray-50')}>
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p className={cn('text-sm text-gray-900', t.customerUnread && 'font-semibold')}>
                {t.customerUnread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-royal-600" />}{t.subject}
              </p>
              <span className={cn('self-start rounded-full px-2 py-0.5 text-xs md:self-auto', STATUS_TONE[t.status])}>{requesterStatus(t)}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {t.number} · {KIND_LABEL[t.kind]} · {t.category}
              {!isWorkspaceAdmin && t.escalatedAt ? ' · passed to VitaLink' : ''}
              {isWorkspaceAdmin && t.createdBy !== myId ? ` · from ${t.createdByName}` : ''} · updated {timeAgo(t.lastMessageAt)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6 page-transition" data-tour-id="help-dashboard">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Help & Support</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isWorkspaceAdmin
              ? 'Answer your team’s requests, talk to the VitaLink team and find quick how-tos.'
              : `Your requests go to your workspace admins${admins.length ? ` (${admins.slice(0, 3).map((a) => a.name).join(', ')}${admins.length > 3 ? '…' : ''})` : ''}. They’ll bring in VitaLink if needed.`}
          </p>
        </div>
        {isWorkspaceAdmin && contact && (contact.hours || contact.email || contact.phone || contact.whatsapp) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {contact.hours && <span className="flex items-center gap-1 rounded-full bg-green-50 px-3 py-1.5 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />{contact.hours}</span>}
            {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200"><Mail className="h-3.5 w-3.5" />{contact.email}</a>}
            {contact.phone && <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200"><Phone className="h-3.5 w-3.5" />{contact.phone}</a>}
            {contact.whatsapp && <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener" className="flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 hover:bg-emerald-100"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
          </div>
        )}
      </div>

      {isWorkspaceAdmin && (
        <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 sm:w-fit dark:bg-slate-800">
          {([['team', 'Team requests', Users, unreadTeam], ['vitalink', 'VitaLink Support', ShieldCheck, unreadMine]] as const).map(([id, label, Icon, count]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setOpenTicketId(null); }}
              className={cn('flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none', tab === id ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-300')}>
              <Icon className="h-4 w-4" />{label}{count > 0 && <span className="rounded-full bg-royal-600 px-1.5 text-[11px] text-white">{count}</span>}
            </button>
          ))}
        </div>
      )}

      {(!isWorkspaceAdmin || tab === 'vitalink') && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {actions.map((a) => (
            <button key={a.kind} type="button" onClick={() => setNewKind(a.kind)}
              className="premium-card flex items-start gap-3 p-3 text-left transition sm:p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-700"><a.icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900">{a.label}</span><span className="text-xs text-gray-500">{a.hint}</span></span>
            </button>
          ))}
        </div>
      )}

      {isWorkspaceAdmin && tab === 'team' ? (
        deskMode && openTicket ? (
          <DeskThread key={openTicket.id} ticket={openTicket} organizationId={orgId} myId={myId} admins={admins}
            onBack={() => setOpenTicketId(null)} onChanged={load} />
        ) : (
          <TeamInbox tickets={teamRequests} loading={tickets === null} myEmail={myEmail} admins={admins} onOpen={setOpenTicketId} onRefresh={load} />
        )
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="min-w-0 space-y-4 xl:col-span-2">
            {openTicket ? (
              <TicketThread key={openTicket.id} ticket={openTicket} organizationId={orgId} myId={myId} onBack={() => setOpenTicketId(null)} onChanged={load} />
            ) : conversationList}

            <GuidedToursList />

            <div className="premium-card p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">How-to guides</h3>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Search guides..." />
                </div>
              </div>
              {guides.length === 0 && (
                <p className="text-sm text-gray-500">No guide matches “{search}”. <button type="button" className="text-royal-700 underline" onClick={() => setNewKind('support')}>Ask for help</button> instead.</p>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                {guides.map((g) => (
                  <details key={g.title} className="group rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <summary className="cursor-pointer list-none">
                      <p className="text-sm font-semibold text-gray-900">{g.title}</p>
                      <p className="text-xs text-gray-500">{g.area}</p>
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-gray-600">{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate(g.page)}>Open {g.area}</Button>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <ConnectionCheck />
            {isWorkspaceAdmin ? (
              <div className="premium-card p-5">
                <h3 className="mb-2 font-semibold text-gray-900">Ideas & feedback</h3>
                <p className="mb-3 text-sm text-gray-600">The VitaLink team reads every message.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setNewKind('feedback')}><LifeBuoy className="mr-2 h-4 w-4" />Feedback</Button>
                  <Button variant="outline" onClick={() => setNewKind('feature')}><Sparkles className="mr-2 h-4 w-4" />Feature</Button>
                </div>
              </div>
            ) : (
              <div className="premium-card p-5">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-gray-900"><Lock className="h-4 w-4 text-slate-400" />Who answers?</h3>
                <p className="text-sm text-gray-600">Your workspace admins see every request, reply here and can pass it to the VitaLink team. Replies show up here and in your notifications.</p>
                {admins.length > 0 && <ul className="mt-3 space-y-1 text-sm text-gray-700">{admins.map((a) => <li key={a.email} className="truncate">• {a.name}</li>)}</ul>}
              </div>
            )}
          </div>
        </div>
      )}

      <NewTicketDialog kind={newKind} organizationId={orgId} toVitaLink={isWorkspaceAdmin} onClose={() => setNewKind(null)}
        onCreated={(id) => { setNewKind(null); load(); setOpenTicketId(id); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin help desk: the team's requests with filters, owner, priority and status.

type DeskView = 'open' | 'unassigned' | 'mine' | 'resolved' | 'all';

function TeamInbox({ tickets, loading, myEmail, admins, onOpen, onRefresh }: {
  tickets: SupportTicket[]; loading: boolean; myEmail: string; admins: Admin[]; onOpen: (id: string) => void; onRefresh: () => void;
}) {
  const [view, setView] = useState<DeskView>('open');
  const [term, setTerm] = useState('');
  const active = (t: SupportTicket) => t.status === 'open' || t.status === 'pending';
  const counts: Record<DeskView, number> = {
    open: tickets.filter(active).length,
    unassigned: tickets.filter((t) => active(t) && !t.assignedTo).length,
    mine: tickets.filter((t) => active(t) && t.assignedTo === myEmail).length,
    resolved: tickets.filter((t) => !active(t)).length,
    all: tickets.length,
  };
  const rank: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const shown = tickets
    .filter((t) => view === 'all' || (view === 'open' ? active(t) : view === 'unassigned' ? active(t) && !t.assignedTo : view === 'mine' ? active(t) && t.assignedTo === myEmail : !active(t)))
    .filter((t) => !term.trim() || `${t.subject} ${t.number} ${t.createdByName} ${t.category}`.toLowerCase().includes(term.trim().toLowerCase()))
    .sort((a, b) => Number(b.staffUnread) - Number(a.staffUnread) || (active(a) && active(b) ? rank[a.priority] - rank[b.priority] : 0) || b.lastMessageAt.localeCompare(a.lastMessageAt));
  const adminName = (email: string | null) => (email ? admins.find((a) => a.email === email)?.name ?? email : null);
  const stats = [
    { label: 'Needs reply', value: tickets.filter((t) => t.status === 'open').length, tone: 'text-amber-700' },
    { label: 'Unassigned', value: counts.unassigned, tone: 'text-slate-900' },
    { label: 'Urgent / high', value: tickets.filter((t) => active(t) && (t.priority === 'urgent' || t.priority === 'high')).length, tone: 'text-red-600' },
    { label: 'Passed to VitaLink', value: tickets.filter((t) => t.escalatedAt).length, tone: 'text-violet-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="premium-card p-4"><p className="text-xs text-gray-500">{s.label}</p><p className={cn('mt-1 text-2xl font-bold', s.tone)}>{s.value}</p></div>
        ))}
      </div>
      <div className="premium-card p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1 lg:pb-0">
            {(['open', 'unassigned', 'mine', 'resolved', 'all'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn('whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition', view === v ? 'bg-royal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {v === 'open' ? 'Open' : v === 'unassigned' ? 'Unassigned' : v === 'mine' ? 'Assigned to me' : v === 'resolved' ? 'Resolved' : 'All'} · {counts[v]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full lg:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9" placeholder="Search requests..." />
            </div>
            <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {!loading && shown.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
            <Inbox className="mx-auto mb-2 h-8 w-8 text-gray-300" />
            {tickets.length === 0 ? 'No requests from your team yet. When staff ask for help, it lands here.' : 'Nothing in this view.'}
          </div>
        )}
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
          {shown.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)}
              className={cn('grid w-full gap-2 p-3 text-left transition hover:bg-royal-50/40 md:grid-cols-[1fr_auto] md:items-center', t.staffUnread && active(t) && 'bg-royal-50/50')}>
              <div className="min-w-0">
                <p className={cn('truncate text-sm text-gray-900', t.staffUnread && 'font-semibold')}>
                  {t.staffUnread && active(t) && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-royal-600" />}{t.subject}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">{t.number} · {t.createdByName} · {KIND_LABEL[t.kind]} · {t.category} · {timeAgo(t.lastMessageAt)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', PRIORITY_TONE[t.priority])}>{t.priority}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px]', STATUS_TONE[t.status])}>{DESK_STATUS[t.status]}</span>
                <span className="max-w-[10rem] truncate rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{adminName(t.assignedTo) ?? 'Unassigned'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeskThread({ ticket, organizationId, myId, admins, onBack, onChanged }: {
  ticket: SupportTicket; organizationId: string; myId: string | null; admins: Admin[]; onBack: () => void; onChanged: () => void;
}) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listMessages(ticket.id, true).then(setMessages).catch((error) => toast.error(errorText(error, 'Could not load messages')));
  }, [ticket.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToWorkspaceSupport(organizationId, load), [organizationId, load]);
  useEffect(() => { if (ticket.staffUnread) void markRead(ticket.id, true).then(onChanged); }, [ticket.id, ticket.staffUnread, onChanged]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  const change = async (changes: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string }) => {
    try { await updateTicket(ticket.id, changes, false, true); onChanged(); load(); }
    catch (error) { toast.error(errorText(error, 'Could not update')); }
  };
  const send = async (resolveAfter = false) => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await reply(ticket.id, organizationId, body, { files, internal: note, asAdmin: true });
      if (resolveAfter && !note) await updateTicket(ticket.id, { status: 'resolved' }, false, true);
      setBody(''); setFiles([]);
      load(); onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not send'));
    } finally {
      setSending(false);
    }
  };
  const escalate = async () => {
    try {
      await escalateTicket(ticket.id, escalateNote);
      toast.success('Sent to VitaLink Support. Follow it in the VitaLink Support tab.');
      setEscalating(false); onChanged(); onBack();
    } catch (error) { toast.error(errorText(error, 'Could not escalate')); }
  };

  const select = 'w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm';
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="premium-card flex min-w-0 flex-col p-0">
        <div className="border-b border-gray-100 p-4">
          <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-royal-700"><ArrowLeft className="h-3.5 w-3.5" />Team requests</button>
          <h3 className="break-words font-semibold text-gray-900">{ticket.subject}</h3>
          <p className="text-xs text-gray-500">{ticket.number} · from {ticket.createdByName} · {KIND_LABEL[ticket.kind]} · {ticket.category} · opened {timeAgo(ticket.createdAt)}</p>
        </div>
        <div className="max-h-[60vh] min-h-[220px] space-y-3 overflow-y-auto p-4">
          {messages === null && <p className="text-sm text-gray-500">Loading...</p>}
          {messages?.map((m) => m.authorKind === 'system' ? (
            <p key={m.id} className="text-center text-[11px] text-gray-400">{m.body} · {timeAgo(m.createdAt)}</p>
          ) : (
            <div key={m.id} className={cn('max-w-[90%] rounded-xl px-3 py-2 text-sm sm:max-w-[80%]',
              m.internal ? 'ml-auto border border-amber-200 bg-amber-50 text-amber-950' : m.authorKind === 'admin' ? 'ml-auto bg-royal-600 text-white' : 'bg-slate-100 text-gray-900')}>
              <p className={cn('mb-0.5 text-[11px]', m.internal ? 'text-amber-700' : m.authorKind === 'admin' ? 'text-royal-100' : 'text-slate-500')}>
                {m.internal && <Lock className="mr-1 inline h-3 w-3" />}{m.authorId === myId ? 'You' : m.author}{m.internal ? ' · private note' : ''} · {new Date(m.createdAt).toLocaleString('en-NG')}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <AttachmentChips attachments={m.attachments} />
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form className="space-y-2 border-t border-gray-100 p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="flex gap-1 text-xs">
            <button type="button" onClick={() => setNote(false)} className={cn('rounded-full px-3 py-1', !note ? 'bg-royal-600 text-white' : 'bg-slate-100 text-slate-600')}>Reply to {ticket.createdByName.split(' ')[0]}</button>
            <button type="button" onClick={() => setNote(true)} className={cn('flex items-center gap-1 rounded-full px-3 py-1', note ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600')}><Lock className="h-3 w-3" />Private note</button>
          </div>
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={cn(note && 'border-amber-300 bg-amber-50/50')}
            placeholder={note ? 'Only workspace admins see private notes' : 'Write a reply...'}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <FilePicker files={files} onChange={setFiles} />
            <div className="flex flex-wrap gap-2">
              {!note && <Button type="button" size="sm" variant="outline" disabled={sending || !body.trim()} onClick={() => void send(true)}>Send & resolve</Button>}
              <Button type="submit" size="sm" disabled={sending || !body.trim()}><Send className="mr-1 h-4 w-4" />{sending ? 'Sending...' : note ? 'Add note' : 'Send'}</Button>
            </div>
          </div>
        </form>
      </div>

      <aside className="premium-card h-fit space-y-4 p-4">
        <div><Label className="text-xs text-gray-500">Status</Label>
          <select className={select} value={ticket.status} onChange={(e) => void change({ status: e.target.value as TicketStatus })}>
            {(['open', 'pending', 'resolved', 'closed'] as const).map((s) => <option key={s} value={s}>{DESK_STATUS[s]}</option>)}
          </select></div>
        <div><Label className="text-xs text-gray-500">Priority</Label>
          <select className={select} value={ticket.priority} onChange={(e) => void change({ priority: e.target.value as TicketPriority })}>
            {(['low', 'normal', 'high', 'urgent'] as const).map((p) => <option key={p} value={p} className="capitalize">{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select></div>
        <div><Label className="text-xs text-gray-500">Owner</Label>
          <select className={select} value={ticket.assignedTo ?? ''} onChange={(e) => void change({ assignedTo: e.target.value })}>
            <option value="">Unassigned</option>
            {admins.map((a) => <option key={a.email} value={a.email}>{a.name}</option>)}
          </select></div>
        <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-500/10">
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">Need VitaLink?</p>
          <p className="mt-1 text-xs text-violet-800/80 dark:text-violet-200/80">Pass this to the VitaLink team. {ticket.createdByName.split(' ')[0]} keeps seeing the replies.</p>
          <Button size="sm" className="mt-2 w-full bg-violet-600 hover:bg-violet-500" onClick={() => setEscalating(true)}><ArrowUpRight className="mr-1 h-4 w-4" />Escalate to VitaLink</Button>
        </div>
      </aside>

      <Dialog open={escalating} onOpenChange={setEscalating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Escalate {ticket.number} to VitaLink</DialogTitle>
            <DialogDescription>The VitaLink team sees the conversation so far (not your private notes). Add anything they should know.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={escalateNote} onChange={(e) => setEscalateNote(e.target.value)} placeholder="What you've already tried, how many people it affects..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalating(false)}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-500" onClick={() => void escalate()}><ArrowUpRight className="mr-1 h-4 w-4" />Escalate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FilePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input ref={input} type="file" multiple hidden accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
        onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      <Button type="button" size="sm" variant="ghost" onClick={() => input.current?.click()}><Paperclip className="mr-1 h-4 w-4" />Attach screenshot or file</Button>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs">
              {file.name}
              <button type="button" onClick={() => onChange(files.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTicketDialog({ kind, organizationId, toVitaLink, onClose, onCreated }: {
  kind: TicketKind | null;
  organizationId: string;
  toVitaLink: boolean;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const copy = (toVitaLink ? VITALINK_COPY : INTERNAL_COPY)[kind ?? 'support'];
  const showPriority = kind === 'support' || kind === 'bug';

  const reset = () => { setSubject(''); setBody(''); setCategory('general'); setPriority('normal'); setFiles([]); };

  const submit = async () => {
    if (!kind) return;
    const finalSubject = subject.trim() || (kind === 'chat' ? body.trim().slice(0, 80) : '');
    if (!finalSubject) { toast.error('Add a short subject'); return; }
    if (!body.trim()) { toast.error('Write a message'); return; }
    setBusy(true);
    try {
      const id = await createTicket({ organizationId, kind, subject: finalSubject, body, category, priority: showPriority ? priority : 'normal', files, audience: toVitaLink ? 'vitalink' : 'internal' });
      toast.success(toVitaLink ? (kind === 'chat' ? 'Message sent. Replies will appear here.' : 'Sent to the VitaLink team. You will get replies here and by email.') : 'Sent to your workspace admins. You’ll be notified when they reply.');
      reset();
      onCreated(id);
    } catch (error) {
      toast.error(errorText(error, 'Could not send'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form id="new-ticket" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {kind !== 'chat' && (
            <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={copy.subject} maxLength={140} /></div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Area</Label>
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm capitalize" value={category} onChange={(e) => setCategory(e.target.value)}>
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c === 'emr' ? 'EMR' : c === 'vitacards' ? 'VitaCards' : c}</option>)}
              </select>
            </div>
            {showPriority && (
              <div>
                <Label>How urgent?</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                  <option value="low">Low: whenever you can</option>
                  <option value="normal">Normal</option>
                  <option value="high">High: slowing us down</option>
                  <option value="urgent">Urgent: can't work</option>
                </select>
              </div>
            )}
          </div>
          <div><Label>Message</Label><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={copy.body} /></div>
          <FilePicker files={files} onChange={setFiles} />
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-ticket" disabled={busy}><Send className="mr-2 h-4 w-4" />{busy ? 'Sending...' : 'Send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** The requester's view of a conversation (staff with their admins, or an admin with VitaLink). */
function TicketThread({ ticket, organizationId, myId, onBack, onChanged }: {
  ticket: SupportTicket;
  organizationId: string;
  myId: string | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listMessages(ticket.id).then(setMessages).catch((error) => toast.error(errorText(error, 'Could not load messages')));
  }, [ticket.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToWorkspaceSupport(organizationId, load), [organizationId, load]);
  useEffect(() => {
    if (ticket.customerUnread) void markRead(ticket.id).then(onChanged);
  }, [ticket.id, ticket.customerUnread, onChanged]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await reply(ticket.id, organizationId, body, { files });
      setBody('');
      setFiles([]);
      load();
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not send'));
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: TicketStatus) => {
    try { await updateTicket(ticket.id, { status }); onChanged(); }
    catch (error) { toast.error(errorText(error, 'Could not update')); }
  };

  const closed = ticket.status === 'closed';
  const answeredBy = ticket.audience === 'internal' ? 'your workspace admins' : 'the VitaLink team';
  const theirs = (m: SupportMessage) => m.authorKind === 'staff' || m.authorKind === 'admin' || (m.authorKind === 'customer' && m.authorId !== ticket.createdBy);

  return (
    <div className="premium-card flex flex-col p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 p-4">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-royal-700"><ArrowLeft className="h-3.5 w-3.5" />All conversations</button>
          <h3 className="break-words font-semibold text-gray-900">{ticket.subject}</h3>
          <p className="text-xs text-gray-500">{ticket.number} · {KIND_LABEL[ticket.kind]} · <span className={cn('rounded-full px-1.5 py-0.5', STATUS_TONE[ticket.status])}>{requesterStatus(ticket)}</span>{ticket.escalatedAt ? ' · passed to VitaLink' : ''}</p>
        </div>
        {closed
          ? <Button size="sm" variant="outline" onClick={() => void setStatus('open')}>Reopen</Button>
          : <Button size="sm" variant="outline" onClick={() => void setStatus('closed')}>Close conversation</Button>}
      </div>
      <div className="max-h-[55vh] min-h-[200px] space-y-3 overflow-y-auto p-4">
        {messages === null && <p className="text-sm text-gray-500">Loading...</p>}
        {messages?.map((m) => m.authorKind === 'system' ? (
          <p key={m.id} className="text-center text-[11px] text-gray-400">{m.body} · {timeAgo(m.createdAt)}</p>
        ) : (
          <div key={m.id} className={cn('max-w-[90%] rounded-xl px-3 py-2 text-sm sm:max-w-[85%]',
            theirs(m) ? 'bg-royal-50 text-gray-900' : 'ml-auto bg-royal-600 text-white')}>
            <p className={cn('mb-0.5 text-[11px]', theirs(m) ? 'text-royal-700' : 'text-royal-100')}>
              {m.authorKind === 'staff' ? 'VitaLink Support' : m.authorId === myId ? 'You' : m.authorKind === 'admin' ? `${m.author} (admin)` : m.author} · {new Date(m.createdAt).toLocaleString('en-NG')}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <AttachmentChips attachments={m.attachments} />
          </div>
        ))}
        {messages && ticket.status === 'open' && messages.every((m) => !theirs(m)) && (
          <p className="text-center text-xs text-gray-400">Your message is with {answeredBy}. You'll be notified when they reply.</p>
        )}
        <div ref={bottom} />
      </div>
      <form className="space-y-2 border-t border-gray-100 p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={closed ? 'Writing here reopens the conversation' : 'Write a reply...'}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <FilePicker files={files} onChange={setFiles} />
          <Button type="submit" size="sm" disabled={sending || !body.trim()}><Send className="mr-1 h-4 w-4" />{sending ? 'Sending...' : 'Send'}</Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

type CheckState = 'checking' | 'ok' | 'slow' | 'down';
type CheckResult = { name: string; state: CheckState; detail: string };

/** Real checks from this browser: internet, VitaLink servers (with latency) and live updates. */
async function runConnectionChecks(): Promise<CheckResult[]> {
  const online = navigator.onLine;
  const results: CheckResult[] = [
    { name: 'Internet', state: online ? 'ok' : 'down', detail: online ? 'This device is online' : 'This device is offline' },
  ];
  const db = requireSupabase();
  const started = performance.now();
  const { error } = await db.from('platform_settings').select('id').limit(1);
  const ms = Math.round(performance.now() - started);
  results.push(error
    ? { name: 'VitaLink servers', state: 'down', detail: error.message }
    : { name: 'VitaLink servers', state: ms > 1500 ? 'slow' : 'ok', detail: `Responded in ${ms} ms${ms > 1500 ? ' (slow connection)' : ''}` });

  const live = await new Promise<CheckState>((resolve) => {
    const channel = db.channel(`help-check-${crypto.randomUUID()}`);
    const finish = (state: CheckState) => { window.clearTimeout(timer); void db.removeChannel(channel); resolve(state); };
    const timer = window.setTimeout(() => finish('down'), 6000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') finish('ok');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') finish('down');
    });
  });
  results.push({ name: 'Live updates', state: live, detail: live === 'ok' ? 'Queues, chats and video visits update instantly' : 'Blocked; pages still work but need a refresh to update' });
  return results;
}

function ConnectionCheck() {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let cancelled = false;
    runConnectionChecks().then((results) => { if (!cancelled) { setChecks(results); setRunning(false); } });
    return () => { cancelled = true; };
  }, []);

  const recheck = () => {
    setRunning(true);
    runConnectionChecks().then((results) => { setChecks(results); setRunning(false); });
  };

  const icon = (state: CheckState) => state === 'ok' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : state === 'slow' ? <Wifi className="h-4 w-4 text-amber-500" /> : state === 'down' ? <XCircle className="h-4 w-4 text-red-500" /> : <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />;

  return (
    <div className="premium-card p-5">
      <h3 className="mb-3 font-semibold text-gray-900">Connection check</h3>
      <div className="space-y-2">
        {checks.length === 0 && <p className="text-sm text-gray-500">Checking...</p>}
        {checks.map((c) => (
          <div key={c.name} className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            {icon(c.state)}
            <div><p className="text-sm text-gray-800">{c.name}</p><p className="text-xs text-gray-500">{c.detail}</p></div>
          </div>
        ))}
      </div>
      <Button variant="outline" className="mt-3 w-full" onClick={recheck} disabled={running}>
        <RefreshCw className={cn('mr-2 h-4 w-4', running && 'animate-spin')} />{running ? 'Checking...' : 'Check again'}
      </Button>
      <p className="mt-2 text-[11px] text-gray-500">If something is red, include a screenshot of this when you contact support.</p>
    </div>
  );
}
