// Help & Support for live workspaces: conversations with the VitaLink team
// (support requests, bug reports, feedback, feature requests, chat), real
// connection checks and short guides that open the right page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Bug, CheckCircle2, Headphones, LifeBuoy, Mail, MessageCircle, Paperclip, Phone, RefreshCw, Search, Send, Sparkles,
  Wifi, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { isFeatureEnabled } from '@/config/featureFlags';
import { requireSupabase } from '@/lib/supabase/client';
import {
  KIND_LABEL, STATUS_LABEL, TICKET_CATEGORIES, createTicket, getSupportContact, listMessages, listMyTickets, markRead, reply,
  subscribeToWorkspaceSupport, updateTicket,
  type SupportContact, type SupportMessage, type SupportTicket, type TicketKind, type TicketPriority, type TicketStatus,
} from '@/lib/supabase/support';
import { AttachmentChips } from './AttachmentChips';
import { timeAgo } from '@/lib/timeAgo';
import type { PageType } from '@/types';

const STATUS_TONE: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800', pending: 'bg-sky-100 text-sky-800', resolved: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-100 text-slate-600',
};
// What the customer sees: "pending" means the team replied and is waiting on them.
const CUSTOMER_STATUS: Record<TicketStatus, string> = { open: 'Waiting for VitaLink', pending: STATUS_LABEL.pending, resolved: 'Resolved', closed: 'Closed' };

const KIND_COPY: Record<TicketKind, { title: string; description: string; subject: string; body: string }> = {
  support: { title: 'Contact support', description: 'Ask the VitaLink team for help. You will get replies here and by email.', subject: 'What do you need help with?', body: 'Tell us what happened and what you expected. Include patient IDs or invoice numbers if relevant.' },
  bug: { title: 'Report a problem', description: 'Something not working as it should? Screenshots help us fix it faster.', subject: 'What went wrong?', body: 'Steps to reproduce: what you clicked, what you expected, what happened instead.' },
  feature: { title: 'Request a feature', description: 'Tell us what would make VitaLink work better for your team.', subject: 'What would you like VitaLink to do?', body: 'Describe the problem it would solve and who on your team would use it.' },
  feedback: { title: 'Send feedback', description: 'Praise, complaints and ideas all go straight to the VitaLink team.', subject: 'Summary', body: 'Your feedback' },
  chat: { title: 'Chat with VitaLink', description: 'Start a conversation. Replies appear here as soon as the team answers.', subject: 'Topic', body: 'Your message' },
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

export function LiveHelpSupport() {
  const { organization, currentRole } = useAuth();
  const orgId = organization.id;
  const { replayCurrentRoleTour, startIntroTour, startWorkflowTraining } = useGuidedTour();
  const toursEnabled = isFeatureEnabled('onboardingToursEnabled');
  const isWorkspaceAdmin = currentRole === 'super-admin' || currentRole === 'hospital-admin';

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<TicketKind | null>(null);
  const [contact, setContact] = useState<SupportContact | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    listMyTickets(orgId).then(setTickets).catch((error) => { toast.error(errorText(error, 'Could not load your conversations')); setTickets([]); });
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToWorkspaceSupport(orgId, load), [orgId, load]);
  useEffect(() => {
    getSupportContact().then(setContact).catch(() => undefined);
    requireSupabase().auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  const unread = (tickets ?? []).filter((t) => t.customerUnread).length;
  const visibleTickets = (tickets ?? []).filter((t) => showClosed || t.status !== 'closed');
  const guides = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return GUIDES;
    return GUIDES.filter((g) => `${g.title} ${g.area} ${g.steps.join(' ')}`.toLowerCase().includes(term));
  }, [search]);
  const openTicket = tickets?.find((t) => t.id === openTicketId) ?? null;

  const actions: Array<{ kind: TicketKind; label: string; hint: string; icon: React.ElementType }> = [
    { kind: 'chat', label: 'Chat with us', hint: 'Quick questions, live replies', icon: MessageCircle },
    { kind: 'support', label: 'Contact support', hint: 'Something you need help with', icon: Headphones },
    { kind: 'bug', label: 'Report a problem', hint: 'Something is broken', icon: Bug },
    { kind: 'feature', label: 'Request a feature', hint: 'Something VitaLink should do', icon: Sparkles },
  ];

  return (
    <div className="space-y-4 md:space-y-6 page-transition" data-tour-id="help-dashboard">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Help & Support</h1>
          <p className="mt-1 text-sm text-gray-500">Talk to the VitaLink team, track your requests and find quick how-tos.</p>
        </div>
        {contact && (contact.hours || contact.email || contact.phone || contact.whatsapp) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {contact.hours && <span className="flex items-center gap-1 rounded-full bg-green-50 px-3 py-1.5 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />{contact.hours}</span>}
            {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200"><Mail className="h-3.5 w-3.5" />{contact.email}</a>}
            {contact.phone && <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200"><Phone className="h-3.5 w-3.5" />{contact.phone}</a>}
            {contact.whatsapp && <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener" className="flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 hover:bg-emerald-100"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map((a) => (
          <button key={a.kind} type="button" onClick={() => setNewKind(a.kind)}
            className="premium-card flex items-start gap-3 p-4 text-left transition hover:shadow-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-700"><a.icon className="h-4 w-4" /></span>
            <span><span className="block text-sm font-semibold text-gray-900">{a.label}</span><span className="text-xs text-gray-500">{a.hint}</span></span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {openTicket ? (
            <TicketThread key={openTicket.id} ticket={openTicket} organizationId={orgId} myId={myId} onBack={() => setOpenTicketId(null)} onChanged={load} />
          ) : (
            <div className="premium-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">
                  {isWorkspaceAdmin ? 'Your workspace\'s conversations' : 'Your conversations'}
                  {unread > 0 && <span className="ml-2 rounded-full bg-royal-600 px-2 py-0.5 text-xs text-white">{unread} new</span>}
                </h3>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show closed</label>
                  <Button size="sm" variant="ghost" onClick={load} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              {tickets === null && <p className="text-sm text-gray-500">Loading...</p>}
              {tickets && visibleTickets.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
                  <LifeBuoy className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  No conversations yet. Use the buttons above to reach the VitaLink team.
                </div>
              )}
              <div className="space-y-2">
                {visibleTickets.map((t) => (
                  <button key={t.id} type="button" onClick={() => setOpenTicketId(t.id)}
                    className={cn('w-full rounded-xl border p-3 text-left transition hover:border-royal-200 hover:bg-royal-50/40', t.customerUnread ? 'border-royal-200 bg-royal-50/60' : 'border-gray-100 bg-gray-50')}>
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <p className={cn('text-sm text-gray-900', t.customerUnread && 'font-semibold')}>
                        {t.customerUnread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-royal-600" />}{t.subject}
                      </p>
                      <span className={cn('self-start rounded-full px-2 py-0.5 text-xs md:self-auto', STATUS_TONE[t.status])}>{CUSTOMER_STATUS[t.status]}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {t.number} · {KIND_LABEL[t.kind]} · {t.category}
                      {isWorkspaceAdmin && t.createdBy !== myId ? ` · from ${t.createdByName}` : ''} · updated {timeAgo(t.lastMessageAt)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="premium-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900">How-to guides</h3>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Search guides..." />
              </div>
            </div>
            {guides.length === 0 && (
              <p className="text-sm text-gray-500">No guide matches “{search}”. <button type="button" className="text-royal-700 underline" onClick={() => setNewKind('support')}>Ask the team</button> instead.</p>
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

        <div className="space-y-4">
          <ConnectionCheck />
          {toursEnabled && (
            <div className="premium-card p-5">
              <h3 className="mb-2 font-semibold text-gray-900">Guided tours</h3>
              <p className="mb-3 text-sm text-gray-600">Step-by-step walkthroughs of the pages your role uses.</p>
              <div className="grid gap-2">
                <Button variant="outline" onClick={startIntroTour}>Start intro tour</Button>
                <Button variant="outline" onClick={() => startWorkflowTraining()}>Workflow training</Button>
                <Button variant="outline" onClick={replayCurrentRoleTour}>Replay my role's tour</Button>
              </div>
            </div>
          )}
          <div className="premium-card p-5">
            <h3 className="mb-2 font-semibold text-gray-900">Ideas & feedback</h3>
            <p className="mb-3 text-sm text-gray-600">The VitaLink team reads every message.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setNewKind('feedback')}><LifeBuoy className="mr-2 h-4 w-4" />Feedback</Button>
              <Button variant="outline" onClick={() => setNewKind('feature')}><Sparkles className="mr-2 h-4 w-4" />Feature</Button>
            </div>
          </div>
        </div>
      </div>

      <NewTicketDialog kind={newKind} organizationId={orgId} onClose={() => setNewKind(null)}
        onCreated={(id) => { setNewKind(null); load(); setOpenTicketId(id); }} />
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

function NewTicketDialog({ kind, organizationId, onClose, onCreated }: {
  kind: TicketKind | null;
  organizationId: string;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const copy = KIND_COPY[kind ?? 'support'];
  const showPriority = kind === 'support' || kind === 'bug';

  const reset = () => { setSubject(''); setBody(''); setCategory('general'); setPriority('normal'); setFiles([]); };

  const submit = async () => {
    if (!kind) return;
    const finalSubject = subject.trim() || (kind === 'chat' ? body.trim().slice(0, 80) : '');
    if (!finalSubject) { toast.error('Add a short subject'); return; }
    if (!body.trim()) { toast.error('Write a message'); return; }
    setBusy(true);
    try {
      const id = await createTicket({ organizationId, kind, subject: finalSubject, body, category, priority: showPriority ? priority : 'normal', files });
      toast.success(kind === 'chat' ? 'Message sent. Replies will appear here.' : 'Sent to the VitaLink team. You will get replies here and by email.');
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form id="new-ticket" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {kind !== 'chat' && (
            <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={copy.subject} maxLength={140} /></div>
          )}
          <div className="grid grid-cols-2 gap-3">
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-ticket" disabled={busy}><Send className="mr-2 h-4 w-4" />{busy ? 'Sending...' : 'Send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

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

  return (
    <div className="premium-card flex flex-col p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 p-4">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-royal-700"><ArrowLeft className="h-3.5 w-3.5" />All conversations</button>
          <h3 className="font-semibold text-gray-900">{ticket.subject}</h3>
          <p className="text-xs text-gray-500">{ticket.number} · {KIND_LABEL[ticket.kind]} · <span className={cn('rounded-full px-1.5 py-0.5', STATUS_TONE[ticket.status])}>{CUSTOMER_STATUS[ticket.status]}</span></p>
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
          <div key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm',
            m.authorKind === 'staff' ? 'bg-royal-50 text-gray-900' : 'ml-auto bg-royal-600 text-white')}>
            <p className={cn('mb-0.5 text-[11px]', m.authorKind === 'staff' ? 'text-royal-700' : 'text-royal-100')}>
              {m.authorKind === 'staff' ? 'VitaLink Support' : m.authorId === myId ? 'You' : m.author} · {new Date(m.createdAt).toLocaleString('en-NG')}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <AttachmentChips attachments={m.attachments} />
          </div>
        ))}
        {messages && ticket.status === 'open' && messages.every((m) => m.authorKind !== 'staff') && (
          <p className="text-center text-xs text-gray-400">The VitaLink team has your message. You'll be notified here and by email when they reply.</p>
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
