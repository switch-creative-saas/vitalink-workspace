import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, BrainCircuit, CheckCircle2, History, ImageUp, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

type AITab = 'symptom-engine' | 'imaging-analysis' | 'history-aware';

export function AIClinicalIntelligencePage() {
  const { canView } = useAuth();
  const { hasAccess } = useSubscription();
  const [activeTab, setActiveTab] = useState<AITab>('symptom-engine');
  const [symptoms, setSymptoms] = useState('');
  const [uploadedScan, setUploadedScan] = useState<File | null>(null);
  const [risk, setRisk] = useState<'Low' | 'Moderate' | 'High'>('Moderate');

  const rankedConditions = useMemo(
    () => [
      { name: 'Type 2 Diabetes progression', probability: 0.78 },
      { name: 'Metabolic syndrome', probability: 0.61 },
      { name: 'Secondary hypertension', probability: 0.44 },
    ],
    [],
  );

  if (!canView('EMR')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Access denied by RBAC policy.</div>;
  }
  if (!hasAccess('ai_limited')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">AI Clinical Intelligence is locked on Free. Upgrade to Pro.</div>;
  }

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">AI Clinical Intelligence</h1>
          <p className="text-sm text-gray-500 truncate">Decision support with explainable risk scoring, imaging insight, and historical pattern detection.</p>
        </div>
        <div className="rounded-xl px-3 py-2 bg-amber-50 text-amber-700 text-xs flex items-center gap-2 shrink-0">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span className="truncate">Clinical Decision Support - Not Final Diagnosis</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-xl min-w-0">
        {[
          { id: 'symptom-engine', label: 'Symptom Diagnosis Engine' },
          { id: 'imaging-analysis', label: 'AI Imaging Diagnosis' },
          { id: 'history-aware', label: 'History-Aware Analysis' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as AITab)} className={cn('px-4 py-2 rounded-lg text-sm min-w-0', activeTab === tab.id ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-600')}>
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'symptom-engine' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4 min-w-0 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <textarea className="min-h-28 rounded-md border border-input p-3 text-sm w-full min-w-0" placeholder="Enter symptoms (natural language or structured)" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
            <div className="rounded-xl border border-gray-200 p-3 bg-gray-50 text-sm min-w-0">
              <p className="font-medium text-gray-900 mb-1 truncate">Dynamic Follow-up Questions</p>
              <ul className="space-y-1 text-gray-600">
                <li className="truncate">Any nocturnal polyuria?</li>
                <li className="truncate">Recent unexplained weight changes?</li>
                <li className="truncate">Family history of endocrine disorders?</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-royal-700 hover:bg-royal-800 text-white min-w-0" onClick={() => toast.success('AI differential diagnosis report generated.')}>
              <BrainCircuit className="w-4 h-4 mr-2 shrink-0" />
              <span className="truncate">Run Differential Analysis</span>
            </Button>
            <Button variant="outline" onClick={() => setRisk((prev) => (prev === 'Low' ? 'Moderate' : prev === 'Moderate' ? 'High' : 'Low'))} className="min-w-0"><span className="truncate">Cycle Risk</span></Button>
            <Button variant="outline" className="min-w-0"><History className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">View Previous Diagnoses</span></Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={cn('rounded-xl p-3 border text-sm min-w-0', risk === 'Low' ? 'bg-green-50 border-green-100 text-green-700' : risk === 'Moderate' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-red-50 border-red-100 text-red-700')}>
              <span className="truncate">Risk Score: {risk}</span>
            </div>
            <div className="rounded-xl p-3 border bg-blue-50 border-blue-100 text-blue-700 text-sm min-w-0"><span className="truncate">Recommended labs: HbA1c, FBS, Lipid Panel</span></div>
            <div className="rounded-xl p-3 border bg-purple-50 border-purple-100 text-purple-700 text-sm min-w-0"><span className="truncate">Urgent escalation: Monitor if persistent dizziness with BP spikes</span></div>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 min-w-0">
            <p className="font-medium text-sm text-gray-900 mb-2 truncate">Ranked Possible Conditions</p>
            <div className="space-y-2">
              {rankedConditions.map((condition) => (
                <div key={condition.name} className="flex items-center justify-between text-sm min-w-0">
                  <span className="truncate">{condition.name}</span>
                  <span className="font-medium shrink-0">{Math.round(condition.probability * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'imaging-analysis' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4 min-w-0 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="rounded-xl border-2 border-dashed border-gray-200 p-4 text-sm text-gray-600 cursor-pointer min-w-0">
              <input
                className="hidden"
                type="file"
                accept=".png,.jpg,.jpeg,.dcm,.pdf"
                onChange={(e) => setUploadedScan(e.target.files?.[0] ?? null)}
              />
              <ImageUp className="w-5 h-5 mb-2 text-royal-700 shrink-0" />
              <span className="truncate">Upload X-ray / CT / MRI / Ultrasound / ECG</span>
            </label>
            <div className="rounded-xl border border-gray-200 p-3 bg-gray-50 text-sm min-w-0">
              <p className="font-medium text-gray-900 truncate">Imaging Analysis Pipeline</p>
              <p className="text-gray-600 mt-1 truncate">Preprocessing to heatmap to confidence scoring to suggested conditions</p>
              <p className="text-gray-600 mt-1 truncate">Versioned analysis + doctor approve/reject feedback loop</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-royal-700 hover:bg-royal-800 text-white min-w-0" disabled={!uploadedScan} onClick={() => toast.success('AI imaging report generated with anomaly heatmap.')}>
              <span className="truncate">Analyze Uploaded Imaging</span>
            </Button>
            <Button variant="outline" className="min-w-0"><span className="truncate">Compare with Previous Scans</span></Button>
            <Button variant="outline" className="min-w-0"><span className="truncate">Approve / Reject Findings</span></Button>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700 flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="truncate">Highlighted suspicious regions and confidence are advisory; doctor validation required.</span>
          </div>
        </div>
      )}

      {activeTab === 'history-aware' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden">
          <h3 className="font-semibold text-gray-900 mb-3 truncate">History-Aware AI Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700 min-w-0">
              <p className="font-medium truncate">Pattern Detected</p>
              <p className="mt-1 truncate">Recurrent elevated glucose trends across last 4 visits.</p>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700 min-w-0">
              <p className="font-medium truncate">Chronic Progression Risk</p>
              <p className="mt-1 truncate">Moderate risk of glycemic deterioration in 6 months.</p>
            </div>
            <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-sm text-purple-700 min-w-0">
              <p className="font-medium truncate">Recurrent Anomaly Flag</p>
              <p className="mt-1 truncate">Lipid panel fluctuations linked with inconsistent medication refill intervals.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" className="min-w-0"><BarChart3 className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Compare Symptom History</span></Button>
            <Button variant="outline" className="min-w-0"><CheckCircle2 className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Mark reviewed by clinician</span></Button>
          </div>
        </div>
      )}
    </div>
  );
}
