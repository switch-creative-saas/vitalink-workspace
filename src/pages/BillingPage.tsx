import { useEffect, useMemo, useState } from 'react';
import { 
  Bell,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { BillingWorkspace } from '@/components/billing/BillingWorkspace';

type InvoiceStatus = 'paid' | 'pending' | 'partial' | 'overdue';
type PaymentMethod = 'cash' | 'card' | 'transfer' | 'insurance';
type ClaimStatus = 'pending' | 'approved' | 'rejected';
type ExportTarget = 'invoices' | 'payments' | 'claims';

type Invoice = {
  id: string;
  patient_id: string;
  patient_name: string;
  services: { type: 'consultation' | 'lab' | 'medication' | 'procedure'; name: string; quantity: number; unitPrice: number }[];
  total_amount: number;
  amount_paid: number;
  balance: number;
  status: InvoiceStatus;
  payment_method: PaymentMethod;
  created_at: string;
};

type Payment = {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  recorded_by: string;
};

type InsuranceClaim = {
  id: string;
  invoice_id: string;
  provider: string;
  policy_number: string;
  coverage_percentage: number;
  status: ClaimStatus;
};

const seedInvoices: Invoice[] = [
  {
    id: 'VLI-2026-0001',
    patient_id: 'p1',
    patient_name: 'Adebayo Johnson',
    services: [
      { type: 'consultation', name: 'General Consultation', quantity: 1, unitPrice: 15000 },
      { type: 'lab', name: 'CBC Test', quantity: 1, unitPrice: 12000 },
      { type: 'medication', name: 'Metformin 500mg', quantity: 1, unitPrice: 18000 },
    ],
    total_amount: 45000,
    amount_paid: 45000,
    balance: 0,
    status: 'paid',
    payment_method: 'insurance',
    created_at: '2026-04-24',
  },
  {
    id: 'VLI-2026-0002',
    patient_id: 'p2',
    patient_name: 'Chioma Okonkwo',
    services: [{ type: 'consultation', name: 'Follow-up Consultation', quantity: 1, unitPrice: 28000 }],
    total_amount: 28000,
    amount_paid: 15000,
    balance: 13000,
    status: 'partial',
    payment_method: 'cash',
    created_at: '2026-04-22',
  },
  {
    id: 'VLI-2026-0003',
    patient_id: 'p3',
    patient_name: 'Emmanuel Adeyemi',
    services: [
      { type: 'procedure', name: 'Minor Procedure', quantity: 1, unitPrice: 85000 },
      { type: 'lab', name: 'Cardiac Panel', quantity: 1, unitPrice: 40000 },
    ],
    total_amount: 125000,
    amount_paid: 0,
    balance: 125000,
    status: 'overdue',
    payment_method: 'insurance',
    created_at: '2026-04-10',
  },
];

// With Supabase the real invoices, payments, HMO claims and price list replace the demo billing data.
export function BillingPage() {
  return isSupabaseConfigured ? <BillingWorkspace /> : <DemoBillingPage />;
}

function DemoBillingPage() {
  const { currentRole, hasPermission, userName } = useAuth();
  const { hasAccess } = useSubscription();
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'claims'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>(seedInvoices);
  const [payments, setPayments] = useState<Payment[]>([
    { id: 'VLPAY-1', invoice_id: 'VLI-2026-0002', amount: 15000, method: 'cash', date: '2026-04-22', recorded_by: 'Front Desk' },
  ]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([
    { id: 'VLN-1', invoice_id: 'VLI-2026-0001', provider: 'AXA Mansard', policy_number: 'POL-7782', coverage_percentage: 100, status: 'approved' },
    { id: 'VLN-2', invoice_id: 'VLI-2026-0003', provider: 'Reliance HMO', policy_number: 'POL-3219', coverage_percentage: 80, status: 'pending' },
  ]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | InvoiceStatus>('all');
  const [filterMethod, setFilterMethod] = useState<'all' | PaymentMethod>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [criticalOnlyOverdue, setCriticalOnlyOverdue] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportTarget>('invoices');

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  const [invoiceForm, setInvoiceForm] = useState({
    patient_name: '',
    serviceConsultation: true,
    serviceLab: true,
    serviceMedication: true,
    serviceProcedure: false,
    consultation: 15000,
    lab: 12000,
    medication: 18000,
    procedure: 0,
    discount: 0,
    tax: 0,
    payment_method: 'cash' as PaymentMethod,
  });
  const [paymentForm, setPaymentForm] = useState({ invoice_id: '', amount: 0, method: 'cash' as PaymentMethod });
  const [claimForm, setClaimForm] = useState({ invoice_id: '', provider: '', policy_number: '', coverage_percentage: 80 });

  const canView = hasPermission('Billing', 'view') || currentRole === 'doctor' || currentRole === 'receptionist' || currentRole === 'pharmacist';
  const canCreateInvoice = hasPermission('Billing', 'create') || currentRole === 'receptionist' || currentRole === 'doctor' || currentRole === 'pharmacist';
  const canEditInvoice = hasPermission('Billing', 'edit') || currentRole === 'hospital-admin';
  const canDeleteInvoice = hasPermission('Billing', 'delete') || currentRole === 'super-admin';
  const canExport = hasPermission('Billing', 'export');
  const canApprove = hasPermission('Billing', 'approve') || currentRole === 'hospital-admin' || currentRole === 'insurance-officer';
  const isInsuranceOfficer = currentRole === 'insurance-officer';
  const isBillingOfficer = currentRole === 'billing-officer';

  const visibleInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = search.toLowerCase().trim();
      const bySearch = !q || inv.patient_name.toLowerCase().includes(q) || inv.id.toLowerCase().includes(q);
      const byStatus = filterStatus === 'all' || inv.status === filterStatus;
      const byMethod = filterMethod === 'all' || inv.payment_method === filterMethod;
      const byCritical = !criticalOnlyOverdue || inv.status === 'overdue';
      const byFrom = !fromDate || inv.created_at >= fromDate;
      const byTo = !toDate || inv.created_at <= toDate;
      return bySearch && byStatus && byMethod && byCritical && byFrom && byTo;
    });
  }, [invoices, search, filterStatus, filterMethod, criticalOnlyOverdue, fromDate, toDate]);

  const metrics = useMemo(() => {
    const totalRevenue = invoices.reduce((acc, i) => acc + i.amount_paid, 0);
    const pending = invoices.filter((i) => i.status === 'pending' || i.status === 'partial').reduce((acc, i) => acc + i.balance, 0);
    const overdue = invoices.filter((i) => i.status === 'overdue').reduce((acc, i) => acc + i.balance, 0);
    const claimCount = claims.filter((c) => c.status === 'pending').length;
    return { totalRevenue, pending, overdue, claimCount };
  }, [invoices, claims]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'billing', type: 'overdue', message: `${invoices.filter((i) => i.status === 'overdue').length} overdue invoice(s)` } }));
  }, [invoices]);

  function nextInvoiceId() {
    const year = new Date().getFullYear();
    const next = invoices.length + 1;
    return `VLI-${year}-${String(next).padStart(4, '0')}`;
  }

  function createInvoice() {
    if (!canCreateInvoice) return toast.error('You do not have permission to create invoices');
    if (!invoiceForm.patient_name.trim()) return toast.error('Patient is required');

    const services: Invoice['services'] = [];
    if (invoiceForm.serviceConsultation) services.push({ type: 'consultation', name: 'Consultation (Appointments integration)', quantity: 1, unitPrice: invoiceForm.consultation });
    if (invoiceForm.serviceLab) services.push({ type: 'lab', name: 'Lab Orders (Lab integration)', quantity: 1, unitPrice: invoiceForm.lab });
    if (invoiceForm.serviceMedication) services.push({ type: 'medication', name: 'Prescriptions (Pharmacy integration)', quantity: 1, unitPrice: invoiceForm.medication });
    if (invoiceForm.serviceProcedure) services.push({ type: 'procedure', name: 'Procedure (EMR integration)', quantity: 1, unitPrice: invoiceForm.procedure });
    const subtotal = services.reduce((acc, s) => acc + s.unitPrice * s.quantity, 0);
    const total = Math.max(0, subtotal - invoiceForm.discount + invoiceForm.tax);

    const invoice: Invoice = {
      id: nextInvoiceId(),
      patient_id: `p-${Date.now()}`,
      patient_name: invoiceForm.patient_name,
      services,
      total_amount: total,
      amount_paid: 0,
      balance: total,
      status: 'pending',
      payment_method: invoiceForm.payment_method,
      created_at: new Date().toISOString().slice(0, 10),
    };
    setInvoices((prev) => [invoice, ...prev]);
    setInvoiceOpen(false);
    toast.success('Invoice generated', { description: `${invoice.id} created and linked to patient record` });
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'billing', type: 'invoice-generated', message: `Invoice ${invoice.id} generated for ${invoice.patient_name}` } }));
  }

  function recordPayment() {
    const invoice = invoices.find((inv) => inv.id === paymentForm.invoice_id);
    if (!invoice) return toast.error('Select a valid invoice');
    if (paymentForm.amount <= 0) return toast.error('Enter valid payment amount');
    const paid = Math.min(invoice.balance, paymentForm.amount);
    const nextAmountPaid = invoice.amount_paid + paid;
    const nextBalance = invoice.total_amount - nextAmountPaid;
    const nextStatus: InvoiceStatus = nextBalance <= 0 ? 'paid' : 'partial';
    setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? { ...i, amount_paid: nextAmountPaid, balance: nextBalance, status: nextStatus, payment_method: paymentForm.method } : i)));
    setPayments((prev) => [{ id: `VLPAY-${Date.now()}`, invoice_id: invoice.id, amount: paid, method: paymentForm.method, date: new Date().toISOString().slice(0, 10), recorded_by: userName }, ...prev]);
    setPaymentOpen(false);
    toast.success('Payment recorded');
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'billing', type: 'payment-received', message: `${invoice.id} payment received` } }));
  }

  function createClaim() {
    if (!(isInsuranceOfficer || isBillingOfficer || canApprove)) return toast.error('Claims are restricted to insurance/billing roles');
    if (!claimForm.invoice_id || !claimForm.provider || !claimForm.policy_number) return toast.error('Complete claim fields');
    setClaims((prev) => [{ id: `VLN-${Date.now()}`, invoice_id: claimForm.invoice_id, provider: claimForm.provider, policy_number: claimForm.policy_number, coverage_percentage: claimForm.coverage_percentage, status: 'pending' }, ...prev]);
    setClaimOpen(false);
    toast.success('Insurance claim submitted');
  }

  function updateClaimStatus(claimId: string, status: ClaimStatus) {
    if (!(isInsuranceOfficer || canApprove)) return toast.error('Only insurance/admin roles can change claim status');
    setClaims((prev) => prev.map((c) => (c.id === claimId ? { ...c, status } : c)));
    const claim = claims.find((c) => c.id === claimId);
    if (!claim) return;
    if (status === 'approved') {
      setInvoices((prev) => prev.map((inv) => (inv.id === claim.invoice_id ? { ...inv, amount_paid: inv.total_amount, balance: 0, status: 'paid', payment_method: 'insurance' } : inv)));
      toast.success('Claim approved and invoice auto-paid');
    }
    if (status === 'rejected') {
      toast.error('Claim rejected. Billing admin notified.');
      window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'billing', type: 'claim-rejected', message: `Claim ${claimId} rejected` } }));
    }
  }

  function exportData(format: 'pdf' | 'csv' | 'excel') {
    if (!canExport) return toast.error('Export restricted for this role');
    toast.success(`Exported ${exportTarget} as ${format.toUpperCase()}`);
  }

  function runInvoiceAction(action: 'view' | 'edit' | 'pdf' | 'mark-paid' | 'send' | 'claim' | 'delete', inv: Invoice) {
    if (action === 'delete' && !canDeleteInvoice) return toast.error('Delete is admin-only');
    if (action === 'edit' && !canEditInvoice) return toast.error('Edit restricted');
    if (action === 'mark-paid') {
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, amount_paid: i.total_amount, balance: 0, status: 'paid' } : i)));
      toast.success(`${inv.id} marked as paid`);
      return;
    }
    if (action === 'claim') {
      setClaimForm((s) => ({ ...s, invoice_id: inv.id }));
      setClaimOpen(true);
      return;
    }
    if (action === 'delete') {
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
      toast.success(`${inv.id} deleted`);
      return;
    }
    if (action === 'send') toast.success(`Invoice sent to ${inv.patient_name} (email/SMS demo)`);
    if (action === 'pdf') toast.message('Branded PDF + QR receipt generated (demo)');
    if (action === 'view' || action === 'edit') toast.message(`${action === 'view' ? 'Viewing' : 'Editing'} ${inv.id}`);
  }

  if (!canView) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-2">You do not have access to this module.</p>
      </div>
    );
  }
  if (!hasAccess('billing')) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-2">Billing is locked on your plan. Upgrade to Pro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 md:mx-0 md:px-0 bg-background/90 backdrop-blur-md border-b border-white/40 md:border-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Billing & Insurance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enterprise financial engine for invoices, payments, claims, and reporting
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 rounded-xl" disabled={!canExport}>
            <Download className="w-4 h-4" />
            Export
          </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 glass-panel border-white/60">
              <div className="space-y-3">
                <div>
                  <Label>Dataset</Label>
                  <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={exportTarget} onChange={(e) => setExportTarget(e.target.value as ExportTarget)}>
                    <option value="invoices">Invoices</option>
                    <option value="payments">Payments</option>
                    <option value="claims">Insurance claims</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportData('pdf')}>PDF</Button>
                  <Button size="sm" variant="outline" onClick={() => exportData('csv')}>CSV</Button>
                  <Button size="sm" variant="outline" onClick={() => exportData('excel')}>Excel</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            data-tour-id="billing-new-invoice"
            className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl"
            onClick={() => {
              setInvoiceOpen(true);
            }}
            disabled={!canCreateInvoice}
          >
            <Plus className="w-4 h-4" />
            New Invoice
          </Button>
          <Button className="bg-emerald-600 text-white gap-2 rounded-xl" onClick={() => setPaymentOpen(true)} disabled={!(isBillingOfficer || currentRole === 'receptionist' || currentRole === 'hospital-admin' || currentRole === 'super-admin')}>
            <Wallet className="w-4 h-4" />
            Record Payment
          </Button>
          <Button className="bg-blue-600 text-white gap-2 rounded-xl" onClick={() => setClaimOpen(true)} disabled={!(isInsuranceOfficer || isBillingOfficer || canApprove)}>
            <Shield className="w-4 h-4" />
            New Claim
          </Button>
        </div>
        </div>
      </div>

      {/* Stats */}
      <div className="dashboard-stat-grid">
        {[
          { label: 'Total Revenue', value: metrics.totalRevenue, color: 'bg-green-500', onClick: () => { setActiveTab('invoices'); setFilterStatus('paid'); } },
          { label: 'Pending Payments', value: metrics.pending, color: 'bg-amber-500', onClick: () => { setActiveTab('invoices'); setFilterStatus('pending'); } },
          { label: 'Overdue Payments', value: metrics.overdue, color: 'bg-red-500', onClick: () => { setActiveTab('invoices'); setFilterStatus('overdue'); setCriticalOnlyOverdue(true); } },
          { label: 'Insurance Claims', value: metrics.claimCount, color: 'bg-blue-500', onClick: () => setActiveTab('claims') },
        ].map((stat) => (
          <button key={stat.label} type="button" className="premium-card glass-panel p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden" onClick={stat.onClick}>
            <div className="flex items-center justify-between mb-1">
              <div className={cn("w-3 h-3 rounded-full flex-shrink-0", stat.color)} />
            </div>
            <p className="text-xl font-bold text-gray-900 truncate tabular-nums">
              {typeof stat.value === 'number' && stat.label !== 'Insurance Claims' ? `₦${stat.value.toLocaleString()}` : stat.value}
            </p>
            <p className="text-xs text-gray-500 truncate">{stat.label}</p>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 p-1 bg-white/70 border border-white/60 rounded-xl w-full max-w-full">
        {([
          { id: 'invoices', label: 'Invoices' },
          { id: 'payments', label: 'Payments' },
          { id: 'claims', label: 'Insurance Claims' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-white text-royal-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search / Filter */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input 
            placeholder="Search patient name or invoice ID..."
            className="pl-12 py-3 rounded-xl bg-white/80"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="rounded-xl">Filter</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 glass-panel border-white/60">
            <div className="space-y-3">
              <div>
                <Label>Status</Label>
                <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | InvoiceStatus)}>
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="partial">Partial</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
              <div>
                <Label>Payment method</Label>
                <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={filterMethod} onChange={(e) => setFilterMethod(e.target.value as 'all' | PaymentMethod)}>
                  <option value="all">All</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="transfer">Bank transfer</option>
                  <option value="insurance">Insurance</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>From</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>To</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={criticalOnlyOverdue} onCheckedChange={(v) => setCriticalOnlyOverdue(Boolean(v))} />
                Overdue only
              </label>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Invoices */}
      {activeTab === 'invoices' && (
      <div className="premium-card glass-panel overflow-hidden border border-white/60">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Patient</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Amount</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Paid</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Balance</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Method</th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-6 py-4">
                  <span className="font-mono text-sm text-royal-600">{inv.id}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-medium text-gray-900">{inv.patient_name}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-gray-700">₦{inv.total_amount.toLocaleString()}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-green-600">₦{inv.amount_paid.toLocaleString()}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "text-sm font-medium",
                    inv.balance > 0 ? "text-red-600" : "text-gray-500"
                  )}>
                    ₦{inv.balance.toLocaleString()}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit",
                    inv.status === 'paid' ? "bg-green-100 text-green-700" :
                    inv.status === 'partial' ? "bg-amber-100 text-amber-700" :
                    "bg-gray-100 text-gray-600"
                  )}>
                    {inv.status === 'paid' ? <CheckCircle2 className="w-3 h-3" /> :
                     inv.status === 'partial' ? <Clock className="w-3 h-3" /> :
                     <XCircle className="w-3 h-3" />}
                    {inv.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1">
                    {inv.payment_method === 'insurance' && <Shield className="w-4 h-4 text-blue-500" />}
                    <span className="text-sm text-gray-600 capitalize">{inv.payment_method}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                  <button className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => runInvoiceAction('view', inv)}>View invoice</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => runInvoiceAction('edit', inv)}>Edit invoice</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => runInvoiceAction('pdf', inv)}>Download PDF</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => runInvoiceAction('mark-paid', inv)}>Mark as paid</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => runInvoiceAction('send', inv)}>Send to patient</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => runInvoiceAction('claim', inv)}>Submit insurance claim</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => runInvoiceAction('delete', inv)} className="text-red-600">Delete (Admin only)</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'payments' && (
        <div className="premium-card glass-panel overflow-hidden border border-white/60">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Payment ID</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Invoice</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Method</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((pay) => (
                <tr key={pay.id} className="border-b border-gray-50">
                  <td className="px-6 py-4 text-sm text-[#1E4ED8] font-medium">{pay.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{pay.invoice_id}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">₦{pay.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 capitalize">{pay.method}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{pay.date}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{pay.recorded_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'claims' && (
        <div className="premium-card glass-panel overflow-hidden border border-white/60">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Claim ID</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Invoice</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Provider</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Policy #</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Coverage</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.id} className="border-b border-gray-50">
                  <td className="px-6 py-4 text-sm text-[#1E4ED8] font-medium">{claim.id}</td>
                  <td className="px-6 py-4 text-sm">{claim.invoice_id}</td>
                  <td className="px-6 py-4 text-sm">{claim.provider}</td>
                  <td className="px-6 py-4 text-sm">{claim.policy_number}</td>
                  <td className="px-6 py-4 text-sm">{claim.coverage_percentage}%</td>
                  <td className="px-6 py-4">
                    <span className={cn('px-3 py-1 rounded-full text-xs font-medium capitalize',
                      claim.status === 'approved' ? 'bg-green-100 text-green-700' :
                      claim.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700',
                    )}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" variant="outline" disabled={!canApprove} onClick={() => updateClaimStatus(claim.id, 'approved')}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={!canApprove} onClick={() => updateClaimStatus(claim.id, 'rejected')}>Reject</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="premium-card glass-panel p-4 border border-white/60">
        <h3 className="font-semibold text-[#1E4ED8] mb-2">Automations, integrations, and advanced features</h3>
        <div className="grid md:grid-cols-2 gap-2 text-sm text-gray-600">
          <p className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /> EMR + Lab + Pharmacy + Appointments auto-billing mapping enabled.</p>
          <p className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-500" /> Paystack/Flutterwave payment-link workflow stubs included.</p>
          <p className="flex items-center gap-2"><Bell className="w-4 h-4 text-amber-500" /> Overdue reminders and claim-status notifications active.</p>
          <p className="flex items-center gap-2"><Shield className="w-4 h-4 text-indigo-500" /> Multi-hospital transfer + shared insurance claim stubs ready.</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast.message('NFC tap read: billing history + outstanding balance (demo)')}>NFC Card Lookup</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('QR-secured receipt generated (demo)')}>Smart Receipt</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('Refund workflow queued for admin approval (demo)')}>Refund</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('VitaMind AI: High unpaid invoices this week, insurance delays detected')}>VitaMind AI Insight</Button>
        </div>
      </div>

      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>Auto-fetches consultation, lab orders, and medication costs from connected modules.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Patient (EMR Search)</Label>
              <Input value={invoiceForm.patient_name} onChange={(e) => setInvoiceForm((s) => ({ ...s, patient_name: e.target.value }))} placeholder="Search patient name..." className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={invoiceForm.serviceConsultation} onCheckedChange={(v) => setInvoiceForm((s) => ({ ...s, serviceConsultation: Boolean(v) }))} /> Consultation</label>
              <label className="flex items-center gap-2"><Checkbox checked={invoiceForm.serviceLab} onCheckedChange={(v) => setInvoiceForm((s) => ({ ...s, serviceLab: Boolean(v) }))} /> Lab tests</label>
              <label className="flex items-center gap-2"><Checkbox checked={invoiceForm.serviceMedication} onCheckedChange={(v) => setInvoiceForm((s) => ({ ...s, serviceMedication: Boolean(v) }))} /> Medications</label>
              <label className="flex items-center gap-2"><Checkbox checked={invoiceForm.serviceProcedure} onCheckedChange={(v) => setInvoiceForm((s) => ({ ...s, serviceProcedure: Boolean(v) }))} /> Procedures</label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input type="number" value={invoiceForm.consultation} onChange={(e) => setInvoiceForm((s) => ({ ...s, consultation: Number(e.target.value) }))} placeholder="Consultation" />
              <Input type="number" value={invoiceForm.lab} onChange={(e) => setInvoiceForm((s) => ({ ...s, lab: Number(e.target.value) }))} placeholder="Lab" />
              <Input type="number" value={invoiceForm.medication} onChange={(e) => setInvoiceForm((s) => ({ ...s, medication: Number(e.target.value) }))} placeholder="Medication" />
              <Input type="number" value={invoiceForm.procedure} onChange={(e) => setInvoiceForm((s) => ({ ...s, procedure: Number(e.target.value) }))} placeholder="Procedure" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={invoiceForm.discount} onChange={(e) => setInvoiceForm((s) => ({ ...s, discount: Number(e.target.value) }))} placeholder="Discount" />
              <Input type="number" value={invoiceForm.tax} onChange={(e) => setInvoiceForm((s) => ({ ...s, tax: Number(e.target.value) }))} placeholder="Tax" />
            </div>
            <div>
              <Label>Payment method</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={invoiceForm.payment_method} onChange={(e) => setInvoiceForm((s) => ({ ...s, payment_method: e.target.value as PaymentMethod }))}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="transfer">Bank transfer</option>
                <option value="insurance">Insurance</option>
              </select>
            </div>
            <Textarea value="Paystack/Flutterwave payment link can be sent immediately after invoice creation (demo)." readOnly className="bg-gray-50" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button className="bg-[#1E4ED8] text-white" onClick={createInvoice}>Generate invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Supports partial payments and auto-updates balance/status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Invoice</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={paymentForm.invoice_id} onChange={(e) => setPaymentForm((s) => ({ ...s, invoice_id: e.target.value }))}>
                <option value="">Select invoice</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.id} · {inv.patient_name} · Bal ₦{inv.balance.toLocaleString()}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((s) => ({ ...s, amount: Number(e.target.value) }))} className="mt-1" />
            </div>
            <div>
              <Label>Method</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={paymentForm.method} onChange={(e) => setPaymentForm((s) => ({ ...s, method: e.target.value as PaymentMethod }))}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="transfer">Bank transfer</option>
                <option value="insurance">Insurance</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white" onClick={recordPayment}>Confirm payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Insurance claim</DialogTitle>
            <DialogDescription>Create claim from invoice and track approval lifecycle.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Invoice</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={claimForm.invoice_id} onChange={(e) => setClaimForm((s) => ({ ...s, invoice_id: e.target.value }))}>
                <option value="">Select invoice</option>
                {invoices.filter((inv) => inv.payment_method === 'insurance' || inv.status !== 'paid').map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.id} · {inv.patient_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Insurance provider</Label>
              <Input value={claimForm.provider} onChange={(e) => setClaimForm((s) => ({ ...s, provider: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Policy number</Label>
              <Input value={claimForm.policy_number} onChange={(e) => setClaimForm((s) => ({ ...s, policy_number: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Coverage %</Label>
              <Input type="number" value={claimForm.coverage_percentage} onChange={(e) => setClaimForm((s) => ({ ...s, coverage_percentage: Number(e.target.value) }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimOpen(false)}>Cancel</Button>
            <Button className="bg-blue-600 text-white" onClick={createClaim}>Submit claim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
