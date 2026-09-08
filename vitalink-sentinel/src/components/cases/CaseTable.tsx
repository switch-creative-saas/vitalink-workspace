import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { DataTable } from '@/components/ui/DataTable';
import type { MockCaseReport } from '@/data/mockSentinelData';

export function CaseTable({ cases, onSelect }: { cases: MockCaseReport[]; onSelect: (report: MockCaseReport) => void }) {
  return (
    <DataTable headers={['Case ID', 'Disease', 'State / LGA', 'Facility', 'Date Reported', 'Age Group', 'Status', 'Lab', 'Actions']}>
      {cases.map((report) => (
        <tr key={report.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
          <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-300">{report.reportId}</td>
          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{report.disease}</td>
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{report.state} / {report.lga}</td>
          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{report.facility}</td>
          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{report.dateReported}</td>
          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{report.ageGroup}</td>
          <td className="px-4 py-3"><Badge tone={report.status === 'deceased' || report.status === 'confirmed' ? 'critical' : report.status === 'suspected' ? 'moderate' : 'low'}>{report.status}</Badge></td>
          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{report.labConfirmed ? 'Confirmed' : 'Pending'}</td>
          <td className="px-4 py-3"><Button className="px-3 py-1.5 text-xs" onClick={() => onSelect(report)}>View Details</Button></td>
        </tr>
      ))}
    </DataTable>
  );
}

