import { useCallback, useEffect, useState } from 'react';
import { X, Sparkles, AlertTriangle, TrendingUp, Brain, Users, Clock, CheckCircle, AlertCircle, ArrowRight, RefreshCw, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { PageType, VitaMindAIInsight } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { listInsights, markInsights, patientSwitchId } from '@/lib/supabase/insights';

interface VitaMindAIPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Offline demo only; live workspaces read public.vitamind_insights.
const mockInsights: VitaMindAIInsight[] = [
  {
    id: '1',
    type: 'risk-alert',
    patientId: 'P-001',
    patientName: 'John Doe',
    severity: 'high',
    title: 'Elevated Blood Pressure Trend',
    description: 'Patient has shown consistent elevation in BP readings over the last 3 visits. Consider medication review.',
    confidence: 0.92,
    recommendedAction: 'Schedule follow-up within 48 hours',
    createdAt: new Date().toISOString(),
    isRead: false,
  },
  {
    id: '2',
    type: 'trend',
    patientId: 'P-002',
    patientName: 'Mary Smith',
    severity: 'medium',
    title: 'Abnormal Glucose Pattern',
    description: 'Fasting glucose levels trending upward. Current average: 142 mg/dL (previous: 118 mg/dL).',
    confidence: 0.87,
    recommendedAction: 'Recommend HbA1c test',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    isRead: false,
  },
  {
    id: '3',
    type: 'duplicate-detection',
    severity: 'low',
    title: 'Potential Duplicate Record',
    description: 'Two patient records with similar demographics detected: "Adebayo Johnson" and "A. Johnson".',
    confidence: 0.78,
    recommendedAction: 'Review and merge if confirmed',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    isRead: true,
  },
  {
    id: '4',
    type: 'prediction',
    severity: 'info',
    title: 'Admission Prediction',
    description: 'Based on current occupancy and scheduled procedures, expect 15% increase in admissions next week.',
    confidence: 0.85,
    createdAt: new Date(Date.now() - 10800000).toISOString(),
    isRead: true,
  },
];

const severityConfig = {
  critical: { color: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200', icon: AlertTriangle },
  high: { color: 'bg-orange-500', bg: 'bg-orange-50', border: 'border-orange-200', icon: AlertCircle },
  medium: { color: 'bg-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle },
  low: { color: 'bg-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', icon: CheckCircle },
  info: { color: 'bg-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', icon: Brain },
};

const typeConfig = {
  'risk-alert': { label: 'Risk Alert', icon: AlertTriangle },
  'trend': { label: 'Trend', icon: TrendingUp },
  'diagnosis-suggestion': { label: 'Insight', icon: Brain },
  'duplicate-detection': { label: 'Data Quality', icon: Users },
  'prediction': { label: 'Prediction', icon: Clock },
};

const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low'] as const;
const PAGE_LABEL: Partial<Record<PageType, string>> = { emr: 'Open EMR', laboratory: 'Open Laboratory', pharmacy: 'Open Pharmacy', billing: 'Open Billing', appointments: 'Open Appointments', patients: 'Open Patients' };
const goTo = (detail: { page?: PageType; switchId?: string }) => window.dispatchEvent(new CustomEvent('app:navigate', { detail }));

export function VitaMindAIPanel({ isOpen, onClose }: VitaMindAIPanelProps) {
  const { organization } = useAuth();
  const { hasModule } = usePlan();
  const [insights, setInsights] = useState<Array<VitaMindAIInsight & { page?: PageType }> | null>(isSupabaseConfigured ? null : mockInsights);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    listInsights(organization.id)
      .then(setInsights)
      .catch((error) => { toast.error(error instanceof Error ? error.message : 'Could not load insights'); setInsights([]); })
      .finally(() => setLoading(false));
  }, [organization.id]);

  useEffect(() => {
    if (!isOpen || !isSupabaseConfigured) return;
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [isOpen, load]);

  const all = insights ?? [];
  const unreadCount = all.filter((i) => !i.isRead).length;
  const urgentCount = all.filter((i) => i.severity === 'critical' || i.severity === 'high').length;
  const filtered = all.filter((i) => (activeTab === 'all' || !i.isRead) && (severity === 'all' || i.severity === severity));

  const mark = (ids: string[], action: 'read' | 'dismiss') => {
    setInsights((list) => (list ?? []).flatMap((i) => (ids.includes(i.id) ? (action === 'dismiss' ? [] : [{ ...i, isRead: true }]) : [i])));
    if (isSupabaseConfigured) markInsights(organization.id, ids, action).catch(() => load());
  };

  const select = (insight: VitaMindAIInsight) => {
    setSelectedId(selectedId === insight.id ? null : insight.id);
    if (!insight.isRead) mark([insight.id], 'read');
  };

  const open = async (insight: VitaMindAIInsight & { page?: PageType }) => {
    if (insight.page === 'emr' && insight.patientId && isSupabaseConfigured) {
      const switchId = await patientSwitchId(insight.patientId);
      if (switchId) { goTo({ switchId }); onClose(); return; }
    }
    goTo({ page: insight.page ?? 'dashboard' });
    onClose();
  };

  if (!isOpen) return null;
  const diagnosis = hasModule('ai-clinical-intelligence');

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in slide-in-from-right duration-300 sm:left-auto sm:w-[26rem]">
      <button type="button" aria-label="Close VitaMind" className="absolute inset-0 bg-slate-950/30 sm:hidden" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-white/60 bg-white/95 shadow-2xl backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95">
        <div className="border-b border-gray-100 p-4 sm:p-5 dark:border-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-vitamind">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-slate-50">VitaMind AI</h2>
                <p className="text-xs text-gray-500">Signals from your workspace’s records</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isSupabaseConfigured && (
                <button type="button" onClick={load} aria-label="Refresh insights" className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800">
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: 'Insights', value: all.length, tone: 'bg-vitalink-50 border-vitalink-100 text-vitalink-600' },
              { label: 'New', value: unreadCount, tone: 'bg-vitamind-50 border-vitamind-100 text-vitamind-600' },
              { label: 'Urgent', value: urgentCount, tone: 'bg-red-50 border-red-100 text-red-600' },
            ].map((stat) => (
              <div key={stat.label} className={cn('rounded-xl border p-3', stat.tone)}>
                <p className="text-2xl font-bold">{insights === null ? '–' : stat.value}</p>
                <p className="text-[10px] uppercase tracking-wider opacity-70">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {(['all', 'unread'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200', activeTab === tab ? 'bg-vitalink-50 text-vitalink-700' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800')}>
                {tab === 'all' ? 'All insights' : 'Unread'}
                {tab === 'unread' && unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-vitamind-500 px-1 text-xs text-white">{unreadCount}</span>}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {SEVERITIES.map((level) => (
              <button key={level} type="button" onClick={() => setSeverity(level)}
                className={cn('whitespace-nowrap rounded-full border px-2.5 py-1 text-xs capitalize transition-colors', severity === level ? 'border-vitalink-500 bg-vitalink-50 text-vitalink-700' : 'border-gray-200 bg-white text-gray-600 hover:border-vitalink-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300')}>
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {insights === null && <p className="py-10 text-center text-sm text-gray-500">Reading your workspace…</p>}
          {insights !== null && filtered.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-500">
              <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              {all.length === 0 ? 'Nothing needs your attention right now.' : 'Nothing in this view.'}
            </div>
          )}
          {filtered.map((insight) => {
            const sev = severityConfig[insight.severity];
            const type = typeConfig[insight.type];
            const Icon = sev.icon;
            const selected = selectedId === insight.id;
            return (
              <div key={insight.id} className={cn('rounded-xl border transition-all duration-200', sev.bg, sev.border, !insight.isRead && 'ring-2 ring-vitamind-200 ring-offset-1', selected ? 'shadow-md' : 'hover:shadow-sm')}>
                <button type="button" onClick={() => select(insight)} className="flex w-full items-start gap-3 p-4 text-left">
                  <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', sev.color)}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{type.label}</span>
                      {!insight.isRead && <span className="h-2 w-2 rounded-full bg-vitamind-500" />}
                      <span className="ml-auto text-[10px] capitalize text-gray-400">{insight.severity}</span>
                    </div>
                    <h3 className={cn('mb-1 text-sm font-semibold text-gray-900', !selected && 'truncate')}>{insight.title}</h3>
                    {insight.patientName && <p className="mb-1 truncate text-xs text-gray-500">{insight.patientName}</p>}
                    <p className={cn('text-xs text-gray-600', !selected && 'line-clamp-2')}>{insight.description}</p>
                  </div>
                </button>
                {selected && (
                  <div className="space-y-2 px-4 pb-4">
                    {insight.recommendedAction && <p className="rounded-lg bg-white/70 p-2 text-xs text-gray-700"><span className="font-semibold">Suggested: </span>{insight.recommendedAction}</p>}
                    <div className="flex flex-wrap gap-2">
                      {insight.page && <Button size="sm" onClick={() => void open(insight)}>{PAGE_LABEL[insight.page] ?? 'Open'}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="outline" onClick={() => mark([insight.id], 'dismiss')}><EyeOff className="mr-1 h-3.5 w-3.5" />Dismiss</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-900">
          {unreadCount > 0 && (
            <Button variant="outline" className="w-full" onClick={() => mark(all.filter((i) => !i.isRead).map((i) => i.id), 'read')}>Mark all read</Button>
          )}
          <Button
            onClick={() => { goTo({ page: diagnosis ? 'ai-clinical-intelligence' : 'subscription' }); onClose(); }}
            className="w-full bg-gradient-vitamind text-white transition-all duration-200 hover:brightness-105"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {diagnosis ? 'Open VitaMind diagnosis' : 'VitaMind diagnosis is on Growth'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="text-center text-[10px] text-gray-400">VitaMind provides decision support, not medical advice</p>
        </div>
      </div>
    </div>
  );
}
