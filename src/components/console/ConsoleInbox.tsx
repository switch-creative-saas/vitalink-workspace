// Console support inbox: every ticket, bug report, feedback and feature request
// from every workspace. Replies email the customer; internal notes never leave
// the console.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, Inbox, Lock, Paperclip, RefreshCw, Search, Send, X } from 'lucide-react';
import { AttachmentChips } from '@/components/support/AttachmentChips';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  KIND_LABEL, getConsoleTicket, listInbox, markRead, reply, subscribeToAllSupport, updateTicket,
  type ConsoleTicket, type InboxTicket, type InboxView, type TicketPriority, type TicketStatus,
} from '@/lib/supabase/support';
import { timeAgo } from '@/lib/timeAgo';
import { errorText } from './consoleFormat';

const VIEWS: Array<{ id: InboxView; label: string }> = [
  { id: 'open', label: 'Open' }, { id: 'unread', label: 'Unread' }, { id: 'mine', label: 'Assigned to me' },
  { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' },
];
const STATUS_TONE: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800', pending: 'bg-sky-100 text-sky-800', resolved: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-100 text-slate-600',
};
const STAFF_STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed' };
const PRIORITY_TONE: Record<TicketPriority, string> = { urgent: 'text-red-600', high: 'text-orange-600', normal: 'text-slate-500', low: 'text-slate-400' };

export function ConsoleInbox({ ticketId, onOpenTicket, onOpenWorkspace, admins, myEmail }: {
  ticketId: string | null;
  onOpenTicket: (ticketId: string | null) => void;
  onOpenWorkspace: (organizationId: string) => void;
  admins: string[];
  myEmail: string;
}) {
  const [view, setView] = useState<InboxView>('open');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<InboxTicket[] | null>(null);

  const load = useCallback(() => {
    listInbox(view, search.trim()).then(setRows).catch((error) => { toast.error(errorText(error, 'Could not load the inbox')); setRows([]); });
  }, [view, search]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => subscribeToAllSupport(load), [load]);

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
      <section className={cn('flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900', ticketId && 'hidden lg:flex')}>
        <div className="space-y-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" onClick={() => setView(item.id)}
                className={cn('rounded-full px-2.5 py-1 text-xs', view === item.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300')}>
                {item.label}
              </button>
            ))}
            <button type="button" onClick={load} className="ml-auto rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject, number, workspace, person..." className="pl-9" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows === null && <p className="p-4 text-sm text-slate-500">Loading...</p>}
          {rows?.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500"><Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />Nothing here.</div>
          )}
          {rows?.map((row) => (
            <button key={row.id} type="button" onClick={() => onOpenTicket(row.id)}
              className={cn('block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-violet-50/60 dark:border-slate-800 dark:hover:bg-slate-800',
                ticketId === row.id && 'bg-violet-50 dark:bg-slate-800')}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn('truncate text-sm', row.staffUnread ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200')}>
                  {row.staffUnread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-600" />}{row.subject}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(row.lastMessageAt)}</span>
              </div>
              <p className="truncate text-xs text-slate-500">{row.organizationName} · {row.requesterName}</p>
              <p className="truncate text-xs text-slate-400">{row.lastAuthorKind === 'staff' ? 'You: ' : ''}{row.lastMessage}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className={cn('rounded-full px-1.5 py-0.5', STATUS_TONE[row.status])}>{STAFF_STATUS_LABEL[row.status]}</span>
                <span className="text-slate-500">{KIND_LABEL[row.kind]}</span>
                {row.priority !== 'normal' && <span className={cn('font-medium', PRIORITY_TONE[row.priority])}>{row.priority}</span>}
                <span className="ml-auto text-slate-400">{row.number}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {ticketId ? (
        <TicketThread key={ticketId} ticketId={ticketId} onBack={() => onOpenTicket(null)} onOpenTicket={onOpenTicket}
          onOpenWorkspace={onOpenWorkspace} admins={admins} myEmail={myEmail} onChanged={load} />
      ) : (
        <section className="hidden items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 lg:flex dark:border-slate-700">
          Pick a conversation
        </section>
      )}
    </div>
  );
}

function TicketThread({ ticketId, onBack, onOpenTicket, onOpenWorkspace, admins, myEmail, onChanged }: {
  ticketId: string;
  onBack: () => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenWorkspace: (organizationId: string) => void;
  admins: string[];
  myEmail: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<ConsoleTicket | null>(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    getConsoleTicket(ticketId).then((result) => {
      setData(result);
      void markRead(ticketId, true).then(onChanged);
    }).catch((error) => toast.error(errorText(error, 'Could not open the ticket')));
  }, [ticketId, onChanged]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeToAllSupport(load), [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

  const change = async (changes: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string }) => {
    try { await updateTicket(ticketId, changes, true); load(); onChanged(); }
    catch (error) { toast.error(errorText(error, 'Could not update the ticket')); }
  };

  const send = async (resolveAfter = false) => {
    if (!data || !body.trim()) return;
    setSending(true);
    try {
      await reply(ticketId, data.ticket.organizationId, body, { files, internal, asStaff: true });
      if (resolveAfter && !internal) await updateTicket(ticketId, { status: 'resolved' }, true);
      setBody('');
      setFiles([]);
      toast.success(internal ? 'Internal note added' : data.requester?.email ? `Reply sent · ${data.requester.email} gets an email` : 'Reply sent');
      load();
    } catch (error) {
      toast.error(errorText(error, 'Could not send'));
    } finally {
      setSending(false);
    }
  };

  if (!data) return <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">Loading...</section>;
  const { ticket, organization, requester } = data;

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="space-y-2 border-b border-slate-100 p-4 dark:border-slate-800">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-violet-700 lg:hidden"><ArrowLeft className="h-3.5 w-3.5" />Inbox</button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{ticket.subject}</h2>
            <p className="text-xs text-slate-500">{ticket.number} · {KIND_LABEL[ticket.kind]} · {ticket.category} · opened {new Date(ticket.createdAt).toLocaleString('en-NG')}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <select value={ticket.status} onChange={(e) => void change({ status: e.target.value as TicketStatus })} aria-label="Status"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
              {(['open', 'pending', 'resolved', 'closed'] as TicketStatus[]).map((s) => <option key={s} value={s}>{STAFF_STATUS_LABEL[s]}</option>)}
            </select>
            <select value={ticket.priority} onChange={(e) => void change({ priority: e.target.value as TicketPriority })} aria-label="Priority"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs capitalize dark:border-slate-700 dark:bg-slate-900">
              {(['urgent', 'high', 'normal', 'low'] as TicketPriority[]).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={ticket.assignedTo ?? ''} onChange={(e) => void change({ assignedTo: e.target.value })} aria-label="Assignee"
              className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
              <option value="">Unassigned</option>
              {Array.from(new Set([...admins, ...(ticket.assignedTo ? [ticket.assignedTo] : [])])).map((email) => (
                <option key={email} value={email}>{email === myEmail ? `Me (${email})` : email}</option>
              ))}
            </select>
          </div>
        </div>
        {organization && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <button type="button" onClick={() => onOpenWorkspace(organization.id)} className="flex items-center gap-1 font-medium text-violet-700 hover:underline dark:text-violet-300">
              <Building2 className="h-3.5 w-3.5" />{organization.name}
            </button>
            <span>{organization.plan}</span>
            {requester && <span>{requester.name} · {requester.email}{requester.role ? ` · ${requester.role}` : ''}</span>}
            {organization.contactPhone && <span>{organization.contactPhone}</span>}
          </div>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {data.messages.map((m) => m.authorKind === 'system' ? (
          <p key={m.id} className="text-center text-[11px] text-slate-400">{m.body} · {timeAgo(m.createdAt)}</p>
        ) : (
          <div key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm',
            m.internal ? 'ml-auto border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-500/10'
              : m.authorKind === 'staff' ? 'ml-auto bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800')}>
            <p className={cn('mb-0.5 text-[11px]', m.authorKind === 'staff' && !m.internal ? 'text-violet-100' : 'text-slate-500')}>
              {m.internal && <Lock className="mr-1 inline h-3 w-3" />}{m.author}{m.internal ? ' · internal note' : ''} · {new Date(m.createdAt).toLocaleString('en-NG')}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <AttachmentChips attachments={m.attachments} />
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setInternal(false)} className={cn('rounded-full px-2.5 py-1', !internal ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800')}>Reply to customer</button>
          <button type="button" onClick={() => setInternal(true)} className={cn('rounded-full px-2.5 py-1', internal ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800')}><Lock className="mr-1 inline h-3 w-3" />Internal note</button>
        </div>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          placeholder={internal ? 'Only VitaLink admins see this' : `Reply to ${requester?.name ?? 'the customer'} (they also get it by email)`}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}
          className={cn(internal && 'border-amber-300 bg-amber-50/50')} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                {file.name}<button type="button" onClick={() => setFiles((list) => list.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { setFiles((list) => [...list, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
          <Button type="button" size="sm" variant="ghost" onClick={() => fileInput.current?.click()}><Paperclip className="mr-1 h-4 w-4" />Attach</Button>
          <span className="text-[11px] text-slate-400">Ctrl+Enter to send</span>
          <div className="ml-auto flex gap-2">
            {!internal && <Button type="button" size="sm" variant="outline" disabled={sending || !body.trim()} onClick={() => void send(true)}>Send & resolve</Button>}
            <Button type="submit" size="sm" disabled={sending || !body.trim()}><Send className="mr-1 h-4 w-4" />{sending ? 'Sending...' : internal ? 'Add note' : 'Send reply'}</Button>
          </div>
        </div>
      </form>

      {data.otherTickets.length > 0 && (
        <div className="border-t border-slate-100 p-3 text-xs dark:border-slate-800">
          <p className="mb-1 font-medium text-slate-500">Other tickets from this workspace</p>
          {data.otherTickets.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpenTicket(t.id)} className="mr-3 text-violet-700 hover:underline dark:text-violet-300">{t.number} {t.subject} ({t.status})</button>
          ))}
        </div>
      )}
    </section>
  );
}
