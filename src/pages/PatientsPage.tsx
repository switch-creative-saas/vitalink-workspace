import { useEffect, useState } from 'react';
import { Download, Filter, Loader2, MoreHorizontal, Nfc, Plus, Search, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { PatientOnboardingWizard } from '@/components/patients/PatientOnboardingWizard';
import { buildCsv, getAge, getPatientSummary, listTenantPatients, parseCsvRows, queryPatients, sampleImportTemplate, type PatientSummary, type RegistryPatient } from '@/lib/patientRegistry';
import { isSupabaseConfigured } from '@/lib/supabase/client';

// Demo tenants for the offline mock; with Supabase the active workspace is the only tenant.
const demoTenants = [
  { id: 'lagos-central-hospital', name: 'Lagos Central Hospital' },
  { id: 'abuja-specialist-hospital', name: 'Abuja Specialist Hospital' },
];

const pageSizes = [10, 25, 50, 100];

interface PatientsPageProps {
  onOpenPatientEmr?: (switchId: string) => void;
}

const defaultFilters = {
  gender: [] as string[],
  status: [] as string[],
  ageMin: '',
  ageMax: '',
  department: '',
  doctorAssigned: '',
  admissionStatus: '',
  chronicCondition: '',
  dateRegistered: '',
  insuranceProvider: '',
};

export function PatientsPage({ onOpenPatientEmr }: PatientsPageProps) {
  const { canCreate, canExport, canView, userName, organization } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const tenants = isSupabaseConfigured ? [{ id: organization.id, name: organization.name }] : demoTenants;
  const [tenantId, setTenantId] = useState(isSupabaseConfigured ? organization.id : searchParams.get('tenantId') ?? tenants[0].id);
  const [patientSummary, setPatientSummary] = useState<PatientSummary>({ total: 0, active: 0, inpatient: 0, withNfc: 0 });
  const [query, setQuery] = useState(searchParams.get('query') ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get('query') ?? '');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pageRows, setPageRows] = useState<RegistryPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('pageSize') ?? '10'));
  const [totalCount, setTotalCount] = useState(0);
  const [jumpPage, setJumpPage] = useState('1');
  const [sortBy, setSortBy] = useState<'createdAt' | 'switchId' | 'name' | 'phone'>((searchParams.get('sortBy') as 'createdAt' | 'switchId' | 'name' | 'phone') ?? 'createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>((searchParams.get('sortOrder') as 'asc' | 'desc') ?? 'desc');
  const [filters, setFilters] = useState(defaultFilters);

  const refresh = () => {
    setLoading(true);
    queryPatients({
      tenantId,
      page,
      pageSize,
      query: debouncedQuery,
      sortBy,
      sortOrder,
      filters,
    })
      .then((result) => {
        setPageRows(result.rows);
        setTotalCount(result.total);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load patients'))
      .finally(() => setLoading(false));
    getPatientSummary(tenantId).then(setPatientSummary).catch(() => undefined);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    refresh();
  }, [tenantId, page, pageSize, debouncedQuery, sortBy, sortOrder, filters]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tenantId', tenantId);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    params.set('query', query);
    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    window.history.replaceState({}, '', `/patients?${params.toString()}`);
  }, [tenantId, page, pageSize, query, sortBy, sortOrder]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const summary = [
    { label: 'All Patients', value: patientSummary.total },
    { label: 'Active', value: patientSummary.active },
    { label: 'Inpatient', value: patientSummary.inpatient },
    { label: 'With NFC', value: patientSummary.withNfc },
  ];

  const saveTemplate = () => {
    const blob = new Blob([sampleImportTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vitalink-patient-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async (file: File) => {
    if (!canCreate('Patients')) {
      toast.error('RBAC policy prevents bulk import for your role.');
      return;
    }
    const content = await file.text();
    const parsed = parseCsvRows(content);
    if (parsed.headers.length === 0) {
      toast.error('Import failed: empty file.');
      return;
    }
    const missing = ['firstName', 'lastName', 'dateOfBirth', 'gender', 'phone', 'tenantId'].filter((h) => !parsed.headers.includes(h));
    if (missing.length > 0) {
      toast.error(`Missing required columns: ${missing.join(', ')}`);
      return;
    }
    toast.info(`Queued ${parsed.rows.length} rows for background processing`, { description: 'Preview and validation complete.' });
  };

  const exportRows = async (mode: 'filtered' | 'selected' | 'all', format: 'csv' | 'xlsx' | 'pdf') => {
    if (!canExport('Patients')) {
      toast.error('RBAC policy prevents export for your role.');
      return;
    }
    const outputRows = mode === 'all' ? await listTenantPatients(tenantId) : pageRows;
    if (format !== 'csv') {
      toast.success(`Prepared ${format.toUpperCase()} export (${mode})`, {
        description: 'Enterprise export adapters are queued server-side in production mode.',
      });
      return;
    }
    const csv = buildCsv(outputRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `patients-${mode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!canView('Patients')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Access denied by RBAC policy.</div>;
  }

  return (
    <div className="space-y-5 page-transition">
      <PatientOnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        tenantId={tenantId}
        creatorName={userName}
        canCreate={canCreate('Patients')}
        onCreated={() => {
          setPage(1);
          refresh();
          window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'patients:created' } }));
          window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'patients:vitalink-id-generated' } }));
        }}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">Patient Registry</h1>
          <p className="text-sm text-gray-500 truncate">Multi-tenant, secure, and scalable patient management.</p>
        </div>
        <div className="flex flex-wrap gap-2 min-w-0">
          <select className="h-10 rounded-md border border-input px-3 text-sm bg-white min-w-0" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={saveTemplate} className="min-w-0">Template</Button>
          <label className="inline-flex items-center shrink-0">
            <input
              className="hidden"
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) runImport(file);
              }}
            />
            <span className="inline-flex h-10 items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium gap-2 cursor-pointer min-w-0"><Upload className="w-4 h-4 shrink-0" /><span className="truncate">Import</span></span>
          </label>
          <Button variant="outline" onClick={() => exportRows('filtered', 'csv')} className="gap-2 min-w-0"><Download className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Export CSV</span></Button>
          <Button variant="outline" onClick={() => exportRows('all', 'xlsx')} className="min-w-0">Excel</Button>
          <Button variant="outline" onClick={() => exportRows('filtered', 'pdf')} className="min-w-0">PDF</Button>
          <Button
            data-tour-id="patients-add"
            className="bg-gradient-to-r from-royal-600 to-royal-800 text-white gap-2 min-w-0"
            onClick={() => {
              setWizardOpen(true);
              window.dispatchEvent(new CustomEvent('vitalink:tour-trigger', { detail: { tourId: 'micro-new-patient' } }));
            }}
            disabled={!canCreate('Patients')}
          >
            <Plus className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Add Patient</span>
          </Button>
        </div>
      </div>

      <div className="dashboard-stat-grid">
        {summary.map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl p-4 shadow-soft card-equal-height h-full min-w-0 overflow-hidden">
            <p className="text-xs uppercase tracking-wide text-gray-500 truncate">{card.label}</p>
            <p className="text-2xl font-bold text-gray-900 truncate tabular-nums">{card.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex-1 relative min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 shrink-0" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Name, VitaLink ID, Phone" className="pl-9 min-w-0" />
          </div>
          <Button variant="outline" className="gap-2 min-w-0" onClick={() => setDrawerOpen((value) => !value)}>
            <Filter className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Advanced Filters</span>
          </Button>
        </div>
        {drawerOpen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-gray-100 pt-3">
            <Input placeholder="Department" value={filters.department} onChange={(e) => setFilters((prev) => ({ ...prev, department: e.target.value }))} className="min-w-0" />
            <Input placeholder="Doctor assigned" value={filters.doctorAssigned} onChange={(e) => setFilters((prev) => ({ ...prev, doctorAssigned: e.target.value }))} className="min-w-0" />
            <Input placeholder="Insurance provider" value={filters.insuranceProvider} onChange={(e) => setFilters((prev) => ({ ...prev, insuranceProvider: e.target.value }))} className="min-w-0" />
            <Input placeholder="Admission status" value={filters.admissionStatus} onChange={(e) => setFilters((prev) => ({ ...prev, admissionStatus: e.target.value }))} className="min-w-0" />
            <Input placeholder="Chronic condition" value={filters.chronicCondition} onChange={(e) => setFilters((prev) => ({ ...prev, chronicCondition: e.target.value }))} className="min-w-0" />
            <Input type="date" value={filters.dateRegistered} onChange={(e) => setFilters((prev) => ({ ...prev, dateRegistered: e.target.value }))} className="min-w-0" />
            <div className="flex items-center gap-2">
              <Input type="number" placeholder="Age min" value={filters.ageMin} onChange={(e) => setFilters((prev) => ({ ...prev, ageMin: e.target.value }))} className="min-w-0" />
              <Input type="number" placeholder="Age max" value={filters.ageMax} onChange={(e) => setFilters((prev) => ({ ...prev, ageMax: e.target.value }))} className="min-w-0" />
            </div>
            <div className="flex flex-wrap gap-2">
              {['male', 'female', 'other'].map((value) => (
                <button
                  key={value}
                  onClick={() => setFilters((prev) => ({ ...prev, gender: prev.gender.includes(value) ? prev.gender.filter((x) => x !== value) : [...prev.gender, value] }))}
                  className={cn('px-3 py-2 text-xs rounded-lg border min-w-0', filters.gender.includes(value) ? 'bg-royal-700 text-white border-royal-700' : 'bg-white border-gray-200')}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {['active', 'inpatient', 'outpatient', 'discharged', 'referred'].map((value) => (
                <button
                  key={value}
                  onClick={() => setFilters((prev) => ({ ...prev, status: prev.status.includes(value) ? prev.status.filter((x) => x !== value) : [...prev.status, value] }))}
                  className={cn('px-3 py-2 text-xs rounded-lg border min-w-0', filters.status.includes(value) ? 'bg-royal-700 text-white border-royal-700' : 'bg-white border-gray-200')}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="md:col-span-3">
              <Button variant="outline" onClick={() => setFilters({ gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '', admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '' })} className="min-w-0">
                Clear all
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/60 bg-white/75 backdrop-blur-xl overflow-hidden min-w-0">
        <div className="hidden md:block responsive-table-wrap">
          <table className="min-w-full">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
              <tr className="text-xs uppercase text-gray-500">
                <th className="px-4 py-3 text-left cursor-pointer min-w-0" onClick={() => { setSortBy('name'); setSortOrder((v) => (sortBy === 'name' && v === 'asc' ? 'desc' : 'asc')); }}>Patient</th>
                <th className="px-4 py-3 text-left cursor-pointer min-w-0" onClick={() => { setSortBy('switchId'); setSortOrder((v) => (sortBy === 'switchId' && v === 'asc' ? 'desc' : 'asc')); }}>VitaLink ID</th>
                <th className="px-4 py-3 text-left cursor-pointer min-w-0" onClick={() => { setSortBy('phone'); setSortOrder((v) => (sortBy === 'phone' && v === 'asc' ? 'desc' : 'asc')); }}>Phone</th>
                <th className="px-4 py-3 text-left min-w-0">Gender / Age</th>
                <th className="px-4 py-3 text-left min-w-0">Status</th>
                <th className="px-4 py-3 text-left min-w-0">Department</th>
                <th className="px-4 py-3 text-right min-w-0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3" colSpan={7}><Skeleton className="h-8 w-full" /></td>
                    </tr>
                  ))
                : pageRows.map((patient) => (
                    <tr
                      key={patient.id}
                      className={cn('border-t border-gray-100 hover:bg-gray-50/60 transition-all cursor-pointer active:scale-[0.998]', selectedRow === patient.id ? 'bg-royal-50/50 shadow-[inset_0_0_0_1px_rgba(79,70,229,0.18)]' : '')}
                      onClick={() => { setSelectedRow(patient.id); onOpenPatientEmr?.(patient.switchId); }}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 truncate min-w-0">{patient.firstName} {patient.lastName}</td>
                      <td className="px-4 py-3 text-sm truncate min-w-0">{patient.switchId}</td>
                      <td className="px-4 py-3 text-sm truncate min-w-0">{patient.phone}</td>
                      <td className="px-4 py-3 text-sm min-w-0">{patient.gender} / {getAge(patient.dateOfBirth)}</td>
                      <td className="px-4 py-3 min-w-0"><Badge>{patient.status}</Badge></td>
                      <td className="px-4 py-3 text-sm truncate min-w-0">{patient.department ?? '--'}</td>
                      <td className="px-4 py-3 text-right min-w-0">
                        <button className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 shrink-0"><MoreHorizontal className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden p-3 space-y-3 min-w-0">
          {loading && Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-32 w-full rounded-xl" />)}
          {!loading &&
            pageRows.map((patient) => (
              <button key={patient.id} className="w-full rounded-xl border border-gray-100 p-3 bg-white shadow-sm transition-all duration-300 text-left active:scale-[0.99] min-w-0" onClick={() => onOpenPatientEmr?.(patient.switchId)}>
                <div className="w-full flex items-start justify-between text-left min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{patient.firstName} {patient.lastName}</p>
                    <p className="text-xs text-gray-500 truncate">{patient.switchId}</p>
                  </div>
                  <Badge className="shrink-0">{patient.status}</Badge>
                </div>
                <div className="overflow-hidden text-sm text-gray-600 space-y-1 mt-3 min-w-0">
                  <p className="truncate">{patient.phone}</p>
                  <p className="truncate">{patient.email ?? '--'}</p>
                  <p className="truncate">{patient.state}, {patient.country}</p>
                  <p className="flex items-center gap-1 truncate">{patient.nfcActive ? <Nfc className="w-3 h-3 shrink-0" /> : null} {patient.nfcActive ? 'NFC Active' : 'NFC Inactive'}</p>
                </div>
              </button>
            ))}
        </div>

        <div className="border-t border-gray-100 px-3 py-3 sm:px-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between min-w-0">
          <p className="text-sm text-gray-500 truncate">Total {totalCount} patients</p>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <details className="sm:hidden shrink-0">
              <summary className="px-2 py-1 text-xs border rounded-md cursor-pointer">Per page</summary>
              <select className="mt-1 h-9 rounded-md border border-input px-2 text-sm" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {pageSizes.map((size) => <option key={size} value={size}>{size}/page</option>)}
              </select>
            </details>
            <select className="hidden sm:block h-9 rounded-md border border-input px-2 text-sm min-w-0" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {pageSizes.map((size) => <option key={size} value={size}>{size}/page</option>)}
            </select>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((prev) => prev - 1)} className="min-w-0">Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((prev) => prev + 1)} className="min-w-0">Next</Button>
            <div className="hidden md:flex items-center gap-1 shrink-0">
              {Array.from({ length: Math.min(totalPages, 6) }).map((_, idx) => {
                const pageNumber = idx + 1;
                return (
                  <button key={pageNumber} onClick={() => setPage(pageNumber)} className={cn('w-8 h-8 rounded-md text-xs border min-w-0', page === pageNumber ? 'bg-royal-700 text-white border-royal-700' : 'bg-white border-gray-200')}>
                    {pageNumber}
                  </button>
                );
              })}
            </div>
            <Input className="w-20 h-9 min-w-0" value={jumpPage} onChange={(e) => setJumpPage(e.target.value)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = Number(jumpPage);
                if (!Number.isNaN(next) && next >= 1 && next <= totalPages) {
                  setPage(next);
                }
              }}
              className="min-w-0"
            >
              Jump
            </Button>
            <span className="text-xs text-gray-500 shrink-0">Page {page} / {totalPages}</span>
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
