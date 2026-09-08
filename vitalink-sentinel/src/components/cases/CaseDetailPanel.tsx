import { X } from 'lucide-react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import type { MockCaseReport } from '@/data/mockSentinelData';

export function CaseDetailPanel({ report, onClose }: { report: MockCaseReport | null; onClose: () => void }) {
  if (!report) return null;
  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md animate-slide-in-right border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-blue-600 dark:text-blue-300">{report.reportId}</p>
          <h2 className="text-xl font-bold text-slate-950 dark:text-slate-50">{report.disease}</h2>
        </div>
        <Button className="h-9 w-9 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Info label="Age group" value={report.ageGroup} />
        <Info label="Sex" value={report.gender} />
        <Info label="State" value={report.state} />
        <Info label="LGA" value={report.lga} />
        <Info label="Facility" value={report.facility} wide />
        <Info label="Reported" value={report.dateReported} />
        <Info label="Lab" value={report.labConfirmed ? 'Confirmed' : 'Pending'} />
      </div>
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Timeline</p>
        <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <li>Symptom onset estimated 3 days before report</li>
          <li>Reported by {report.reportedBy}</li>
          <li>Lab status: {report.labConfirmed ? 'result confirmed' : 'awaiting sample result'}</li>
        </ol>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Badge tone={report.status === 'confirmed' ? 'critical' : 'moderate'}>{report.status}</Badge>
        <Button>Update Status</Button>
        <Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Link to Outbreak</Button>
      </div>
      <textarea className="sentinel-input mt-5 min-h-24 w-full rounded-lg p-3 text-sm" placeholder="Add note" />
    </aside>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

