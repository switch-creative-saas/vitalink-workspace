import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { CaseTable } from '@/components/cases/CaseTable';
import { CaseDetailPanel } from '@/components/cases/CaseDetailPanel';
import { NewCaseForm } from '@/components/cases/NewCaseForm';
import { diseaseLibrary, mockRecentCases, type MockCaseReport } from '@/data/mockSentinelData';

export function CasesPage() {
  const [query, setQuery] = useState('');
  const [disease, setDisease] = useState('all');
  const [status, setStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<MockCaseReport | null>(null);
  const filtered = useMemo(() => mockRecentCases.filter((report) => {
    const matchesQuery = [report.reportId, report.disease, report.state, report.facility].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (disease === 'all' || report.disease === disease) && (status === 'all' || report.status === status);
  }), [query, disease, status]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Case Registry</h2><p className="text-sm text-slate-500 dark:text-slate-400">{filtered.length} case reports across direct and facility feeds.</p></div><Button onClick={() => setModalOpen(true)}>Report New Case</Button></div>
      <div className="grid gap-3 md:grid-cols-[1fr_220px_180px_150px]">
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Search by case ID, disease, state, facility" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select value={disease} onChange={(event) => setDisease(event.target.value)}><option value="all">All diseases</option>{diseaseLibrary.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="suspected">Suspected</option><option value="confirmed">Confirmed</option><option value="recovered">Recovered</option><option value="deceased">Deceased</option></Select>
        <Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Export CSV</Button>
      </div>
      <CaseTable cases={filtered} onSelect={setSelected} />
      <CaseDetailPanel report={selected} onClose={() => setSelected(null)} />
      <Modal title="New Case Report" open={modalOpen} onClose={() => setModalOpen(false)}><NewCaseForm onDone={() => setModalOpen(false)} /></Modal>
    </div>
  );
}

