import { useState } from 'react';
import { X, Sparkles, AlertTriangle, TrendingUp, Brain, Users, Clock, CheckCircle, AlertCircle, ArrowRight, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { VitaMindAIInsight } from '@/types';

interface VitaMindAIPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

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

export function VitaMindAIPanel({ isOpen, onClose }: VitaMindAIPanelProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [selectedInsight, setSelectedInsight] = useState<VitaMindAIInsight | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filteredInsights = activeTab === 'unread' 
    ? mockInsights.filter(i => !i.isRead)
    : mockInsights;

  const unreadCount = mockInsights.filter(i => !i.isRead).length;

  const handleViewAllInsights = () => {
    toast.info('Opening full VitaMind Insights dashboard...');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 z-50 animate-in slide-in-from-right duration-300">
      <div className="h-full bg-white/90 backdrop-blur-2xl border-l border-white/60 shadow-2xl flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-vitamind flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">VitaMind AI</h2>
                <p className="text-xs text-gray-500">Clinical Intelligence for Better Healthcare</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-vitalink-50 border border-vitalink-100">
              <p className="text-2xl font-bold text-vitalink-600">{mockInsights.length}</p>
              <p className="text-[10px] text-vitalink-600/70 uppercase tracking-wider">Insights</p>
            </div>
            <div className="p-3 rounded-xl bg-vitamind-50 border border-vitamind-100">
              <p className="text-2xl font-bold text-vitamind-600">{unreadCount}</p>
              <p className="text-[10px] text-vitamind-600/70 uppercase tracking-wider">New</p>
            </div>
            <div className="p-3 rounded-xl bg-green-50 border border-green-100">
              <p className="text-2xl font-bold text-green-600">94%</p>
              <p className="text-[10px] text-green-600/70 uppercase tracking-wider">Accuracy</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200",
                activeTab === 'all'
                  ? "bg-vitalink-50 text-vitalink-700"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              All Insights
            </button>
            <button
              onClick={() => setActiveTab('unread')}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2",
                activeTab === 'unread'
                  ? "bg-vitalink-50 text-vitalink-700"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              Unread
              {unreadCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-vitamind-500 text-white text-xs flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "p-2 rounded-lg transition-all",
                showFilters ? "bg-vitalink-50 text-vitalink-700" : "text-gray-400 hover:bg-gray-100"
              )}
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>

          {showFilters && (
            <div className="mt-3 p-3 rounded-xl bg-gray-50 space-y-2 animate-in slide-in-from-top-2 duration-200">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-gray-500 font-medium">Risk:</span>
                {['all', 'critical', 'high', 'medium', 'low'].map((level) => (
                  <button key={level} type="button" className="px-2 py-1 rounded-lg text-xs bg-white border border-gray-200 hover:border-vitalink-500 text-gray-600 capitalize transition-colors">
                    {level}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-gray-500 font-medium">Dept:</span>
                {['All', 'General', 'Cardiology', 'Pediatrics', 'Lab'].map((dept) => (
                  <button key={dept} type="button" className="px-2 py-1 rounded-lg text-xs bg-white border border-gray-200 hover:border-vitalink-500 text-gray-600 transition-colors">
                    {dept}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredInsights.map((insight) => {
            const severity = severityConfig[insight.severity];
            const type = typeConfig[insight.type];
            const Icon = severity.icon;
            
            return (
              <div
                key={insight.id}
                onClick={() => setSelectedInsight(insight)}
                className={cn(
                  "p-4 rounded-xl border cursor-pointer transition-all duration-200",
                  severity.bg,
                  severity.border,
                  !insight.isRead && "ring-2 ring-vitamind-200 ring-offset-1",
                  selectedInsight?.id === insight.id 
                    ? "shadow-lg scale-[1.02]" 
                    : "hover:shadow-md hover:scale-[1.01]"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", severity.color)}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                        {type.label}
                      </span>
                      {!insight.isRead && (
                        <span className="w-2 h-2 rounded-full bg-vitamind-500" />
                      )}
                    </div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1 truncate">{insight.title}</h3>
                    {insight.patientName && (
                      <p className="text-xs text-gray-500 mb-1 truncate">{insight.patientName}</p>
                    )}
                    <p className="text-xs text-gray-600 line-clamp-2">{insight.description}</p>
                    
                    {insight.confidence && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 rounded-full bg-white/50 overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full", severity.color)}
                            style={{ width: `${insight.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500">
                          {Math.round(insight.confidence * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <Button 
            onClick={handleViewAllInsights}
            className="w-full bg-gradient-vitamind text-white hover:shadow-lg hover:shadow-vitamind-500/25 transition-all duration-200"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            View All Insights
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <p className="text-center text-[10px] text-gray-400 mt-2">
            VitaMind AI provides clinical decision support, not medical advice
          </p>
        </div>
      </div>
    </div>
  );
}
