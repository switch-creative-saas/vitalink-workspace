import { useMemo, useState } from 'react';
import {
  Bot,
  Bug,
  CheckCircle2,
  Clock3,
  Headphones,
  LifeBuoy,
  MessageCircle,
  Mic,
  PhoneCall,
  Plus,
  Search,
  Send,
  Sparkles,
  Ticket,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { isFeatureEnabled } from '@/config/featureFlags';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveHelpSupport } from '@/components/support/LiveHelpSupport';

type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
type TicketCategory = 'billing' | 'laboratory' | 'emr' | 'pharmacy' | 'appointments' | 'general';

interface SupportTicket {
  id: string;
  owner: string;
  title: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  description: string;
  assignedTo?: string;
  createdAt: string;
  slaHours: number;
  replies: { by: string; message: string; at: string }[];
}

interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  content: string;
  helpful: number;
  notHelpful: number;
}

const knowledgeBase: KnowledgeArticle[] = [
  { id: 'kb1', title: 'Getting Started with VitaLink', category: 'Getting Started', content: 'Set up facility, departments, and users from Administration.', helpful: 24, notHelpful: 3 },
  { id: 'kb2', title: 'Create an Invoice in Billing', category: 'Billing & Insurance', content: 'Go to Billing > Add Invoice > link patient > services > save.', helpful: 42, notHelpful: 2 },
  { id: 'kb3', title: 'Lab Result Workflow', category: 'Laboratory', content: 'Create order -> process sample -> validate -> publish results.', helpful: 31, notHelpful: 4 },
  { id: 'kb4', title: 'Pharmacy Dispensing Guide', category: 'Pharmacy', content: 'Validate prescription, dispense stock, sync billing.', helpful: 28, notHelpful: 5 },
  { id: 'kb5', title: 'Troubleshoot Sync Errors', category: 'Troubleshooting', content: 'Run diagnostics, confirm connectivity, retry sync queue.', helpful: 19, notHelpful: 6 },
];

export function HelpSupportPage() {
  return isSupabaseConfigured ? <LiveHelpSupport /> : <DemoHelpSupportPage />;
}

// Offline demo (no Supabase): sample tickets and canned replies only.
function DemoHelpSupportPage() {
  const { currentRole, userName } = useAuth();
  const { subscription, hasAccess, addAudit } = useSubscription();
  const { replayCurrentRoleTour, startTourById, startIntroTour, startWorkflowTraining, startAdvancedTour, progress } = useGuidedTour();
  const toursEnabled = isFeatureEnabled('onboardingToursEnabled');
  const [search, setSearch] = useState('');
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatTyping, setChatTyping] = useState(false);
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnostics, setDiagnostics] = useState([
    { name: 'Server status', state: 'ok' as 'ok' | 'warn' | 'error', detail: 'All core servers online' },
    { name: 'Sync status', state: 'warn' as 'ok' | 'warn' | 'error', detail: 'Minor queue backlog detected' },
    { name: 'API connectivity', state: 'ok' as 'ok' | 'warn' | 'error', detail: 'API response normal (220ms avg)' },
    { name: 'Offline mode', state: 'ok' as 'ok' | 'warn' | 'error', detail: 'Offline-first cache healthy' },
  ]);
  const [ticketForm, setTicketForm] = useState({
    title: '',
    category: 'general' as TicketCategory,
    priority: 'medium' as TicketPriority,
    description: '',
    attachment: '',
  });
  const [feedbackForm, setFeedbackForm] = useState({ title: '', description: '', attachment: '' });
  const [featureForm, setFeatureForm] = useState({ title: '', description: '', tag: 'General', attachment: '' });
  const [chatHistory, setChatHistory] = useState<{ by: 'user' | 'vitamind'; text: string }[]>([
    { by: 'vitamind', text: "Hi, I'm VitaMind AI Support Assistant. I can help with tickets, billing, and diagnostics." },
  ]);
  const [tickets, setTickets] = useState<SupportTicket[]>([
    {
      id: 'VLT-001',
      owner: 'Dr. Sarah Johnson',
      title: 'Invoice payment mismatch',
      category: 'billing',
      priority: 'high',
      status: 'in-progress',
      description: 'Patient payment received but invoice remains pending.',
      assignedTo: 'Support Agent Michael',
      createdAt: '2026-04-27 10:30',
      slaHours: 4,
      replies: [
        { by: 'Support Agent Michael', message: 'Investigating payment webhook logs.', at: '2026-04-27 11:02' },
      ],
    },
    {
      id: 'VLT-002',
      owner: userName,
      title: 'Lab result sync delay',
      category: 'laboratory',
      priority: 'medium',
      status: 'open',
      description: 'Results are delayed from lab to EMR.',
      createdAt: '2026-04-28 08:41',
      slaHours: 12,
      replies: [],
    },
  ]);

  const canAdminViewAll = currentRole === 'super-admin' || currentRole === 'hospital-admin';
  const isSupportAgent = currentRole === 'support-agent';
  const canManageTickets = canAdminViewAll || isSupportAgent;
  const canUseAIAssistant = hasAccess('ai_limited');
  const planSupportsTickets = subscription.plan !== 'free';
  const enterpriseSupport = subscription.plan === 'enterprise';
  const filteredTickets = canManageTickets ? tickets : tickets.filter((ticket) => ticket.owner === userName);
  const filteredKb = knowledgeBase.filter((article) => !search.trim() || article.title.toLowerCase().includes(search.toLowerCase()) || article.category.toLowerCase().includes(search.toLowerCase()));
  const currentPageHint = "It looks like you're in Help & Support, do you want to create a billing support ticket?";
  const roleCompletion = progress.roleCompletion[currentRole] ?? 0;
  const completionRate = Math.min(100, Math.round((progress.completedTours.length / 12) * 100));
  const isAdminRole = currentRole === 'super-admin' || currentRole === 'hospital-admin';

  const smartSuggestions = useMemo(
    () => [
      'Need help creating an invoice?',
      'Troubleshoot lab sync delay',
      'Check API connectivity diagnostics',
      'View role-based permissions help',
    ],
    [],
  );

  const createTicket = (source: 'manual' | 'chat-escalation') => {
    if (!ticketForm.title.trim()) return toast.error('Ticket title is required');
    if (!ticketForm.description.trim()) return toast.error('Ticket description is required');
    if (!planSupportsTickets && source === 'manual') return toast.error('Ticket support requires Pro or Enterprise plan');
    const ticket: SupportTicket = {
      id: `VLT-${String(Date.now()).slice(-4)}`,
      owner: userName,
      title: ticketForm.title,
      category: ticketForm.category,
      priority: ticketForm.priority,
      status: 'open',
      description: ticketForm.description,
      createdAt: new Date().toLocaleString(),
      slaHours: enterpriseSupport ? 2 : 12,
      assignedTo: isSupportAgent ? userName : undefined,
      replies: [],
    };
    setTickets((prev) => [ticket, ...prev]);
    setTicketDialogOpen(false);
    setTicketForm({ title: '', category: 'general', priority: 'medium', description: '', attachment: '' });
    addAudit(`Support ticket created (${ticket.id})`);
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'support', type: 'ticket-created', message: `${ticket.id} created` } }));
    toast.success('Support ticket created');
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const input = chatInput.trim();
    setChatHistory((prev) => [...prev, { by: 'user', text: input }]);
    setChatInput('');
    setChatTyping(true);
    window.setTimeout(() => {
      const wantsHuman = /human|agent|ticket|escalate/i.test(input);
      const wantsTour = /tour|onboard|walkthrough|guide/i.test(input);
      const response = wantsHuman
        ? 'I can escalate this to a human support agent. I have pre-filled a ticket for you.'
        : wantsTour
          ? 'Would you like a quick tour of this module? I can start it now.'
          : 'I found a related article in Billing & Insurance. Would you like me to open it or create a ticket?';
      setChatHistory((prev) => [...prev, { by: 'vitamind', text: response }]);
      setChatTyping(false);
      if (wantsTour) {
        replayCurrentRoleTour();
      }
      if (wantsHuman) {
        setTicketForm((prev) => ({
          ...prev,
          title: prev.title || 'Escalated from VitaMind AI chat',
          description: prev.description || `Escalation context: ${input}`,
          category: prev.category === 'general' ? 'billing' : prev.category,
          priority: 'high',
        }));
        setTicketDialogOpen(true);
        window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'support', type: 'chat-escalation', message: 'Chat escalated to human support' } }));
      }
    }, 800);
  };

  const runDiagnostics = async () => {
    if (!canManageTickets && currentRole !== 'it-officer') return toast.error('Admin/Support/IT only');
    setDiagnosticRunning(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setDiagnostics([
      { name: 'Server status', state: 'ok', detail: 'Server heartbeat healthy' },
      { name: 'Sync status', state: 'ok', detail: 'All sync queues cleared' },
      { name: 'API connectivity', state: 'warn', detail: 'Intermittent latency to billing API' },
      { name: 'Offline mode', state: 'ok', detail: 'Offline cache and restore validated' },
    ]);
    setDiagnosticRunning(false);
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'support', type: 'diagnostics', message: 'Diagnostics completed with warnings' } }));
    toast.success('Diagnostics complete');
  };

  const updateTicketStatus = (ticketId: string, status: TicketStatus) => {
    if (!canManageTickets) return toast.error('Only Admin/Support Agent can update tickets');
    setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? { ...ticket, status } : ticket)));
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'support', type: 'ticket-updated', message: `${ticketId} marked ${status}` } }));
    toast.success(`Ticket ${ticketId} -> ${status}`);
  };

  const submitFeedback = (type: 'feedback' | 'feature') => {
    if (type === 'feedback') {
      if (!feedbackForm.title.trim() || !feedbackForm.description.trim()) return toast.error('Title and description required');
      toast.success('Feedback submitted');
      setFeedbackDialogOpen(false);
      setFeedbackForm({ title: '', description: '', attachment: '' });
      return;
    }
    if (!featureForm.title.trim() || !featureForm.description.trim()) return toast.error('Title and description required');
    toast.success('Feature request submitted with upvote tracking');
    setFeatureDialogOpen(false);
    setFeatureForm({ title: '', description: '', tag: 'General', attachment: '' });
  };

  return (
    <div className="space-y-4 md:space-y-6 page-transition" data-tour-id="help-dashboard">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Help & Support</h1>
          <p className="text-sm text-gray-500 mt-1">AI + Human support desk with diagnostics and knowledge base for VitaLink.</p>
        </div>
        <div className="rounded-xl px-3 py-2 bg-green-50 text-green-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Support availability: 9AM–6PM WAT
        </div>
        {toursEnabled && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={replayCurrentRoleTour}>Replay Tour</Button>
            <Button variant="outline" size="sm" onClick={() => startTourById('micro-billing-first')}>Billing Quick Tour</Button>
          </div>
        )}
      </div>

      <div className="premium-card p-5">
        <h3 className="font-semibold text-gray-900 mb-2">How can we help you?</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Search articles, tickets, diagnostics..." />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {smartSuggestions.map((suggestion) => (
            <button key={suggestion} className="text-xs px-2.5 py-1 rounded-full bg-royal-50 text-royal-700 border border-royal-100 hover:bg-royal-100 transition-colors">
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {toursEnabled && (
            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Training Center</h3>
              <p className="text-sm text-gray-600">Role-based onboarding with intro, workflow drills, advanced modules, and replay support.</p>
              <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-royal-600 transition-all" style={{ width: `${completionRate}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-full bg-royal-50 text-royal-700 border border-royal-100">Overall: {completionRate}%</span>
                <span className="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">Role Workflow: {roleCompletion}%</span>
                <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">Skill Level: {progress.skillLevel}</span>
                {completionRate >= 90 && <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">You are ready to use VitaLink</span>}
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                <Button variant="outline" onClick={startIntroTour}>Start Intro Tour</Button>
                <Button variant="outline" onClick={() => startWorkflowTraining()}>Start Workflow Training</Button>
                <Button variant="outline" onClick={() => startAdvancedTour('feature-ai-diagnosis')}>AI Diagnosis Tour</Button>
                <Button variant="outline" onClick={() => startAdvancedTour('feature-telemedicine')}>Telemedicine Tour</Button>
                <Button variant="outline" onClick={() => startAdvancedTour('feature-billing-insurance')}>Billing & Insurance Tour</Button>
                <Button variant="outline" onClick={() => startAdvancedTour('feature-analytics')}>Analytics Tour</Button>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Subscription-aware access: Free (basic workflow), Pro (full module training), Enterprise (advanced + custom workflows).
              </div>
            </div>
          )}

          {isAdminRole && toursEnabled && (
            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Onboarding Admin Control Panel</h3>
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <Metric label="Staff Completed" value={`${Math.max(1, progress.completedTours.length)} users`} />
                <Metric label="Pending Assignment" value={`${Math.max(0, 10 - progress.completedTours.length)} users`} />
                <Metric label="Mandatory Mode" value={completionRate < 100 ? 'Enabled' : 'Completed'} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { addAudit('Onboarding assigned to staff by admin'); toast.success('Onboarding assigned to staff'); }}>
                  Assign onboarding to staff
                </Button>
                <Button variant="outline" size="sm" onClick={() => { addAudit('Mandatory onboarding toggle updated'); toast.success('Mandatory onboarding requirement updated'); }}>
                  Require onboarding before full system use
                </Button>
              </div>
            </div>
          )}

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <Button variant="outline" className="justify-start" onClick={() => setTicketDialogOpen(true)} disabled={!planSupportsTickets}>
                <Headphones className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => { setTicketForm((prev) => ({ ...prev, category: 'general', priority: 'high', title: 'Bug report:' })); setTicketDialogOpen(true); }}>
                <Bug className="w-4 h-4 mr-2" />
                Report a Bug
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => setFeatureDialogOpen(true)}>
                <Sparkles className="w-4 h-4 mr-2" />
                Request Feature
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => setChatOpen(true)}>
                <MessageCircle className="w-4 h-4 mr-2" />
                Live Chat (VitaMind AI)
              </Button>
            </div>
            {!planSupportsTickets && (
              <div className="mt-3 text-sm rounded-xl border border-amber-100 bg-amber-50 p-3 text-amber-800">
                Free plan includes chatbot support only. Upgrade to Pro for full ticket support.
              </div>
            )}
          </div>

          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Recent Tickets</h3>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{filteredTickets.length} total</span>
            </div>
            <div className="space-y-2">
              {filteredTickets.map((ticket) => (
                <div key={ticket.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{ticket.id} • {ticket.title}</p>
                      <p className="text-xs text-gray-500">{ticket.category} • Priority {ticket.priority} • SLA {ticket.slaHours}h</p>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span className={cn('text-xs px-2 py-1 rounded-full', ticket.status === 'open' ? 'bg-amber-100 text-amber-700' : ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : ticket.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700')}>
                        {ticket.status}
                      </span>
                      {canManageTickets && (
                        <select className="text-xs rounded-md border border-input px-2 py-1" value={ticket.status} onChange={(e) => updateTicketStatus(ticket.id, e.target.value as TicketStatus)}>
                          <option value="open">Open</option>
                          <option value="in-progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Assigned: {ticket.assignedTo ?? 'Unassigned'} • Created: {ticket.createdAt}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Knowledge Base</h3>
            <div className="grid md:grid-cols-2 gap-2">
              {filteredKb.map((article) => (
                <div key={article.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-sm font-semibold text-gray-900">{article.title}</p>
                  <p className="text-xs text-gray-500">{article.category}</p>
                  <p className="text-xs text-gray-600 mt-2">{article.content}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <button className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Helpful ({article.helpful})</button>
                    <button className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">Not helpful ({article.notHelpful})</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">System Status</h3>
            <div className="space-y-2">
              {diagnostics.map((diag) => (
                <div key={diag.name} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-800">{diag.name}</span>
                    <span className={cn('text-xs px-2 py-1 rounded-full', diag.state === 'ok' ? 'bg-green-100 text-green-700' : diag.state === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                      {diag.state === 'ok' ? 'OK' : diag.state === 'warn' ? 'Warning' : 'Error'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{diag.detail}</p>
                </div>
              ))}
            </div>
            <Button className="w-full mt-3 bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={runDiagnostics} disabled={diagnosticRunning}>
              {diagnosticRunning ? <Loader2Spin /> : <Wrench className="w-4 h-4 mr-2" />}
              Run Diagnostics
            </Button>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Contact Support</h3>
            <div className="space-y-2 text-sm">
              <div className="rounded-xl border border-gray-100 p-3 bg-gray-50 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-royal-600" /> Live Chat</div>
              <div className="rounded-xl border border-gray-100 p-3 bg-gray-50 flex items-center gap-2"><Send className="w-4 h-4 text-royal-600" /> Email Support</div>
              <div className="rounded-xl border border-gray-100 p-3 bg-gray-50 flex items-center gap-2"><PhoneCall className="w-4 h-4 text-green-600" /> WhatsApp Priority {enterpriseSupport ? '(Enabled)' : '(Enterprise only)'}</div>
              <div className="rounded-xl border border-gray-100 p-3 bg-gray-50 flex items-center gap-2"><Users className="w-4 h-4 text-gray-600" /> Phone Support {enterpriseSupport ? '(Enabled)' : '(Optional)'}</div>
            </div>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Support Analytics</h3>
            <div className="space-y-2 text-sm">
              <Metric label="Most Common Issue" value="Billing webhook mismatch" />
              <Metric label="Avg Response Time" value={enterpriseSupport ? '22 min' : '2h 40m'} />
              <Metric label="Avg Resolution Time" value="6h 18m" />
              <Metric label="Satisfaction" value="4.4 / 5.0" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setFeedbackDialogOpen(true)}><LifeBuoy className="w-4 h-4 mr-2" />Send Feedback</Button>
            <Button variant="outline" onClick={() => setFeatureDialogOpen(true)}><Plus className="w-4 h-4 mr-2" />Feature Request</Button>
          </div>
        </div>
      </div>

      <button
        className="fixed bottom-6 right-6 z-40 rounded-full w-14 h-14 shadow-lg bg-gradient-to-br from-royal-500 to-royal-700 text-white flex items-center justify-center transition-transform"
        onClick={() => setChatOpen((prev) => !prev)}
        title="VitaMind AI Support Assistant"
      >
        <Bot className="w-6 h-6" />
      </button>

      {chatOpen && (
        <div className="fixed bottom-24 right-6 z-40 w-[92vw] max-w-sm rounded-2xl border border-white/60 glass-panel shadow-xl p-3 animate-page-fade-in">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-900">VitaMind AI Support Assistant</p>
            <button className="text-gray-400 hover:text-gray-600" onClick={() => setChatOpen(false)}>×</button>
          </div>
          <p className="text-xs text-indigo-600 mb-2">{currentPageHint}</p>
          <div className="max-h-56 overflow-y-auto space-y-2 mb-2">
            {chatHistory.map((item, idx) => (
              <div key={`${item.by}-${idx}`} className={cn('text-xs p-2 rounded-xl', item.by === 'user' ? 'bg-royal-600 text-white ml-8' : 'bg-gray-100 text-gray-700 mr-8')}>
                {item.text}
              </div>
            ))}
            {chatTyping && <div className="text-xs p-2 rounded-xl bg-gray-100 text-gray-500 mr-8">VitaMind is typing...</div>}
          </div>
          <div className="flex gap-2">
            <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask VitaMind for support..." />
            <Button size="icon" onClick={sendChat}><Send className="w-4 h-4" /></Button>
          </div>
          <div className="mt-2 flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setTicketDialogOpen(true)}>Talk to human</Button>
            <Button variant="ghost" size="sm" disabled={!canUseAIAssistant}><Mic className="w-4 h-4 mr-1" />Voice (Soon)</Button>
          </div>
        </div>
      )}

      <Dialog open={ticketDialogOpen} onOpenChange={setTicketDialogOpen}>
        <DialogContent className="glass-panel border-white/60 max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Support Ticket</DialogTitle>
            <DialogDescription>Track issue lifecycle: Open {'->'} In Progress {'->'} Resolved {'->'} Closed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={ticketForm.title} onChange={(e) => setTicketForm((prev) => ({ ...prev, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={ticketForm.category} onChange={(e) => setTicketForm((prev) => ({ ...prev, category: e.target.value as TicketCategory }))}>
                  <option value="billing">Billing</option>
                  <option value="laboratory">Lab</option>
                  <option value="emr">EMR</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="appointments">Appointments</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <Label>Priority</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={ticketForm.priority} onChange={(e) => setTicketForm((prev) => ({ ...prev, priority: e.target.value as TicketPriority }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div><Label>Description</Label><Textarea value={ticketForm.description} onChange={(e) => setTicketForm((prev) => ({ ...prev, description: e.target.value }))} /></div>
            <div>
              <Label>Attachment</Label>
              <Button variant="outline" className="w-full justify-start mt-1" onClick={() => setTicketForm((prev) => ({ ...prev, attachment: 'screenshot.png' }))}>
                <Upload className="w-4 h-4 mr-2" />
                {ticketForm.attachment || 'Attach screenshot/file'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketDialogOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={() => createTicket('manual')}>
              <Ticket className="w-4 h-4 mr-2" />
              Submit Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
        <DialogContent className="glass-panel border-white/60 max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>Share product feedback to improve VitaLink.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={feedbackForm.title} onChange={(e) => setFeedbackForm((prev) => ({ ...prev, title: e.target.value }))} /></div>
            <div><Label>Description</Label><Textarea value={feedbackForm.description} onChange={(e) => setFeedbackForm((prev) => ({ ...prev, description: e.target.value }))} /></div>
            <div><Label>Screenshot (optional)</Label><Input value={feedbackForm.attachment} onChange={(e) => setFeedbackForm((prev) => ({ ...prev, attachment: e.target.value }))} placeholder="screenshot.png" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => submitFeedback('feedback')}>Submit Feedback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={featureDialogOpen} onOpenChange={setFeatureDialogOpen}>
        <DialogContent className="glass-panel border-white/60 max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Feature</DialogTitle>
            <DialogDescription>Submit and tag feature requests. Upvotes are tracked for roadmap prioritization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={featureForm.title} onChange={(e) => setFeatureForm((prev) => ({ ...prev, title: e.target.value }))} /></div>
            <div><Label>Description</Label><Textarea value={featureForm.description} onChange={(e) => setFeatureForm((prev) => ({ ...prev, description: e.target.value }))} /></div>
            <div>
              <Label>Tag</Label>
              <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={featureForm.tag} onChange={(e) => setFeatureForm((prev) => ({ ...prev, tag: e.target.value }))}>
                <option>AI</option>
                <option>Billing</option>
                <option>EMR</option>
                <option>Lab</option>
                <option>Pharmacy</option>
                <option>General</option>
              </select>
            </div>
            <div><Label>Screenshot (optional)</Label><Input value={featureForm.attachment} onChange={(e) => setFeatureForm((prev) => ({ ...prev, attachment: e.target.value }))} placeholder="mockup.png" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeatureDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => submitFeedback('feature')}>Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function Loader2Spin() {
  return <Clock3 className="w-4 h-4 mr-2 animate-spin" />;
}
