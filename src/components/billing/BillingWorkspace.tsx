// Billing desk. Visits, lab tests and dispensed drugs land on the patient's running bill by
// themselves (database triggers); the desk watches open bills live, adds anything extra, takes
// payment and finalizes. Also payments, HMO claims and the hospital's price list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Download, Pencil, Plus, Printer, Radio, RefreshCw, Search, Shield, Trash2, Upload, Wallet, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { findPatientBySwitchId, queryPatients, type RegistryPatient } from '@/lib/patientRegistry';
import { BILLING_HANDOFF_KEY } from '@/lib/handoffs';
import { printReceipt } from '@/lib/printDocument';
import {
  addManualLine,
  buildInvoice,
  deleteInvoice,
  deletePrice,
  finalizeInvoice,
  getPaymentReceipt,
  importPrices,
  listDrugPrices,
  listInvoiceReceipts,
  listInvoices,
  listPayments,
  listPrices,
  listUnpriced,
  previewUnbilled,
  recordPayment,
  removeLine,
  resolveClaim,
  saveDrugPrice,
  savePrice,
  setPriceActive,
  submitClaim,
  subscribeToBilling,
  voidInvoice,
  type BillingInvoice,
  type BillingPayment,
  type DrugPrice,
  type ExtraLine,
  type InvoiceLine,
  type PaymentReceipt,
  type LineCategory,
  type PaymentMethod,
  type PriceCategory,
  type PriceInput,
  type ServicePrice,
  type UnbilledItem,
  type UnpricedItem,
} from '@/lib/supabase/billing';

const WRITE_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer', 'receptionist'];
const MANAGE_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer'];
const ADMIN_ROLES: UserRole[] = ['super-admin', 'hospital-admin'];
const DRUG_PRICE_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'pharmacist'];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'pos', label: 'POS' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'nhis', label: 'NHIS' },
  { value: 'waiver', label: 'Waiver' },
];
const PRICE_CATEGORIES: PriceCategory[] = ['consultation', 'lab', 'procedure', 'imaging', 'room', 'supplies', 'other'];
const LINE_CATEGORIES: LineCategory[] = ['consultation', 'lab', 'pharmacy', 'procedure', 'imaging', 'room', 'supplies', 'other'];
const SOURCE_GROUPS: Array<{ type: InvoiceLine['sourceType']; label: string }> = [
  { type: 'appointment', label: 'Visit' }, { type: 'lab_result', label: 'Laboratory' }, { type: 'prescription', label: 'Pharmacy' }, { type: 'manual', label: 'Added by billing' },
];

const naira = (value: number) => `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const methodLabel = (method: string | null) => METHODS.find((m) => m.value === method)?.label ?? (method === 'hmo' ? 'HMO' : method === 'paystack' ? 'Paystack' : method ?? '—');
const isOpen = (inv: BillingInvoice) => inv.status === 'draft' || inv.status === 'unpaid' || inv.status === 'partial';
const sinceText = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

const printPaymentReceipt = (receipt: PaymentReceipt) => printReceipt({ ...receipt, methodLabel: methodLabel(receipt.method) });

async function printReceiptForPayment(paymentId: string) {
  try {
    const receipt = await getPaymentReceipt(paymentId);
    if (!receipt) { toast.error('No receipt found for this payment.'); return; }
    printPaymentReceipt(receipt);
  } catch (error) {
    toast.error(errorText(error, 'Could not open the receipt'));
  }
}

function statusChip(invoice: BillingInvoice) {
  if (invoice.status === 'draft') return { label: 'running bill', className: 'bg-slate-100 text-slate-700', Icon: Radio };
  if (invoice.status === 'void') return { label: 'void', className: 'bg-gray-100 text-gray-500', Icon: XCircle };
  if (invoice.status === 'paid') return { label: 'paid', className: 'bg-green-100 text-green-700', Icon: CheckCircle2 };
  if (invoice.overdue) return { label: 'overdue', className: 'bg-red-100 text-red-700', Icon: XCircle };
  if (invoice.status === 'partial') return { label: 'partial', className: 'bg-orange-100 text-orange-700', Icon: Clock };
  return { label: 'unpaid', className: 'bg-amber-100 text-amber-700', Icon: Clock };
}

export function BillingWorkspace() {
  const { organization, currentRole } = useAuth();
  const organizationId = organization.id;
  const canWrite = WRITE_ROLES.includes(currentRole);
  const canManage = MANAGE_ROLES.includes(currentRole);
  const isAdmin = ADMIN_ROLES.includes(currentRole);

  const [tab, setTab] = useState<'open' | 'invoices' | 'payments' | 'claims' | 'prices'>('open');
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'void'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const seenLines = useRef<Set<string> | null>(null);

  const reload = useCallback(async () => {
    try {
      const [inv, pay, priceList] = await Promise.all([
        listInvoices(organizationId),
        listPayments(organizationId),
        listPrices(organizationId),
      ]);
      // Announce charges that arrived by themselves since the last load (not on the first one).
      const ids = new Set(inv.flatMap((i) => i.lines.map((l) => l.id)));
      if (seenLines.current) {
        for (const i of inv) {
          if (i.status !== 'draft') continue;
          for (const line of i.lines) {
            if (!seenLines.current.has(line.id) && line.sourceType !== 'manual') toast(`New charge: ${line.description.replace(/ \(no price set\)$/, '')}`, { description: `${i.patientName} · ${line.unitPrice === 0 ? 'no price set' : naira(line.total)}` });
          }
        }
      }
      seenLines.current = ids;
      setInvoices(inv);
      setPayments(pay);
      setPrices(priceList);
    } catch (error) {
      toast.error(errorText(error, 'Could not load billing'));
    }
  }, [organizationId]);

  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(first);
  }, [reload]);

  // Live: a lab order, dispense or check-in anywhere in the workspace shows up here within a second.
  useEffect(() => {
    let timer = 0;
    const unsubscribe = subscribeToBilling(organizationId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 400);
    });
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [organizationId, reload]);

  const detail = invoices.find((inv) => inv.id === detailId) ?? null;
  const openBills = useMemo(() => invoices.filter(isOpen).sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft') || b.updatedAt.localeCompare(a.updatedAt)), [invoices]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      const bySearch = !needle || `${inv.number} ${inv.patientName} ${inv.patientSwitchId}`.toLowerCase().includes(needle);
      const byStatus = statusFilter === 'all'
        || (statusFilter === 'overdue' ? inv.overdue : statusFilter === 'unpaid' ? inv.status === 'unpaid' && !inv.overdue : inv.status === statusFilter);
      return bySearch && byStatus;
    });
  }, [invoices, search, statusFilter]);

  const claims = invoices.filter((inv) => inv.hmoClaimStatus);
  const metrics = useMemo(() => {
    const owed = invoices.filter((inv) => inv.status !== 'void' && inv.status !== 'draft');
    const running = invoices.filter((inv) => inv.status === 'draft');
    return [
      { label: `Running bills (${running.length})`, value: naira(running.reduce((sum, inv) => sum + inv.balance, 0)), tone: 'bg-slate-500', onClick: () => setTab('open') },
      { label: 'Collected', value: naira(payments.reduce((sum, p) => sum + p.amount, 0)), tone: 'bg-green-500', onClick: () => setTab('payments') },
      { label: 'Outstanding', value: naira(owed.reduce((sum, inv) => sum + inv.balance, 0)), tone: 'bg-amber-500', onClick: () => { setTab('invoices'); setStatusFilter('all'); } },
      { label: 'Overdue', value: naira(owed.filter((inv) => inv.overdue).reduce((sum, inv) => sum + inv.balance, 0)), tone: 'bg-red-500', onClick: () => { setTab('invoices'); setStatusFilter('overdue'); } },
      { label: 'HMO claims pending', value: String(claims.filter((inv) => inv.hmoClaimStatus === 'submitted').length), tone: 'bg-blue-500', onClick: () => setTab('claims') },
    ];
  }, [invoices, payments, claims]);

  // ---------- dialogs ----------
  const [newOpen, setNewOpen] = useState(false);
  const [newFor, setNewFor] = useState<RegistryPatient | null>(null);

  // "Generate Invoice" on an appointment hands the patient over through sessionStorage.
  useEffect(() => {
    const switchId = sessionStorage.getItem(BILLING_HANDOFF_KEY);
    if (!switchId) return;
    sessionStorage.removeItem(BILLING_HANDOFF_KEY);
    findPatientBySwitchId(switchId)
      .then((found) => {
        if (!found) {
          toast.error(`No patient with VitaLink ID ${switchId} in this workspace.`);
          return;
        }
        setNewFor(found);
        setNewOpen(true);
      })
      .catch((error) => toast.error(errorText(error, 'Could not open the patient for billing')));
  }, []);
  const [payFor, setPayFor] = useState<BillingInvoice | null>(null);
  const [claimFor, setClaimFor] = useState<BillingInvoice | null>(null);

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(label);
      void reload();
      return true;
    } catch (error) {
      toast.error(errorText(error, 'Something went wrong'));
      return false;
    }
  };

  const [paymentFrom, setPaymentFrom] = useState('');
  const [paymentTo, setPaymentTo] = useState('');
  const shownPayments = payments.filter((p) => (!paymentFrom || p.receivedAt.slice(0, 10) >= paymentFrom) && (!paymentTo || p.receivedAt.slice(0, 10) <= paymentTo));

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Billing & Insurance</h1>
          <p className="mt-1 text-sm text-gray-500">Visits, lab tests and dispensed drugs are added to each patient’s bill automatically. Take payments, print receipts and submit insurance claims.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700" title="New charges appear without refreshing"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Live</span>
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void reload()}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button data-tour-id="billing-new-invoice" className="gap-2 rounded-xl bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={!canWrite} onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />New Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={metric.onClick} className="premium-card glass-panel h-full min-w-0 overflow-hidden p-4 text-left transition-all">
            <div className={cn('mb-1 h-3 w-3 rounded-full', metric.tone)} />
            <p className="truncate text-xl font-bold tabular-nums text-gray-900">{metric.value}</p>
            <p className="truncate text-xs text-gray-500">{metric.label}</p>
          </button>
        ))}
      </div>

      <div data-tour-id="billing-tabs" className="flex w-full max-w-full gap-2 overflow-x-auto rounded-xl border border-white/60 bg-white/70 p-1">
        {([
          { id: 'open', label: `Open bills${openBills.length ? ` · ${openBills.length}` : ''}` },
          { id: 'invoices', label: 'All invoices' },
          { id: 'payments', label: 'Payments' },
          { id: 'claims', label: 'HMO Claims' },
          { id: 'prices', label: 'Price List' },
        ] as const).map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} className={cn('whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all', tab === item.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div className="premium-card glass-panel overflow-x-auto border border-white/60">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="whitespace-nowrap border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <th className="px-5 py-3">Patient</th><th className="px-5 py-3">Bill</th><th className="px-5 py-3">Items</th><th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Paid</th><th className="px-5 py-3">Balance</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openBills.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-sm text-gray-500"><Zap className="mx-auto mb-2 h-6 w-6 text-gray-300" />No open bills. When a patient checks in, gets a lab test or has drugs dispensed, their bill appears here by itself.</td></tr>}
              {openBills.map((inv) => {
                const chip = statusChip(inv);
                const autoLines = inv.lines.filter((l) => l.sourceType !== 'manual').length;
                return (
                  <tr key={inv.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50', inv.status === 'draft' && 'bg-slate-50/40')}>
                    <td className="px-5 py-3"><p className="font-medium text-gray-900">{inv.patientName}</p><p className="text-xs text-gray-500">{inv.patientSwitchId}</p></td>
                    <td className="px-5 py-3"><button className="font-mono text-sm text-royal-600 hover:underline" onClick={() => setDetailId(inv.id)}>{inv.number}</button><p className="text-xs text-gray-500">{new Date(inv.createdAt).toLocaleDateString()}</p></td>
                    <td className="px-5 py-3 text-sm text-gray-700">{inv.lines.length}{autoLines ? <span className="ml-1 text-xs text-gray-400">({autoLines} auto)</span> : null}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">{naira(inv.total)}</td>
                    <td className="px-5 py-3 text-sm text-green-600">{naira(inv.paid)}</td>
                    <td className="px-5 py-3 text-sm font-medium text-red-600">{naira(inv.balance)}</td>
                    <td className="px-5 py-3"><span className={cn('flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium', chip.className)}><chip.Icon className="h-3 w-3" />{chip.label}</span></td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-gray-500">{sinceText(inv.updatedAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setDetailId(inv.id)}>View</Button>
                        {inv.balance > 0 && canWrite && <Button size="sm" className="gap-1 bg-emerald-600 text-white" onClick={() => setPayFor(inv)}><Wallet className="h-3.5 w-3.5" />Pay</Button>}
                        {inv.status === 'draft' && canWrite && <Button size="sm" variant="outline" onClick={() => void runAction(`${inv.number} finalized`, () => finalizeInvoice(inv.id))}>Finalize</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'invoices' && (
        <>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search invoice number, patient or VitaLink ID..." className="rounded-xl bg-white/80 pl-12" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="rounded-xl border border-input bg-white px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              {['all', 'draft', 'unpaid', 'partial', 'overdue', 'paid', 'void'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s === 'draft' ? 'running bill' : s}</option>)}
            </select>
          </div>
          <div className="premium-card glass-panel overflow-x-auto border border-white/60">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-5 py-3">Invoice #</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Paid</th><th className="px-5 py-3">Balance</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Due</th><th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-sm text-gray-500">{invoices.length ? 'No invoices match.' : 'No invoices yet. Bills appear by themselves as patients are seen, or use “New Invoice”.'}</td></tr>}
                {visible.map((inv) => {
                  const chip = statusChip(inv);
                  return (
                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3"><button className="font-mono text-sm text-royal-600 hover:underline" onClick={() => setDetailId(inv.id)}>{inv.number}</button></td>
                      <td className="px-5 py-3"><p className="font-medium text-gray-900">{inv.patientName}</p><p className="text-xs text-gray-500">{inv.patientSwitchId}</p></td>
                      <td className="px-5 py-3 text-sm text-gray-700">{naira(inv.total)}</td>
                      <td className="px-5 py-3 text-sm text-green-600">{naira(inv.paid)}</td>
                      <td className={cn('px-5 py-3 text-sm font-medium', inv.balance > 0 && inv.status !== 'void' ? 'text-red-600' : 'text-gray-500')}>{naira(inv.balance)}</td>
                      <td className="px-5 py-3">
                        <span className={cn('flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium', chip.className)}><chip.Icon className="h-3 w-3" />{chip.label}</span>
                        {inv.hmoClaimStatus && <span className="mt-1 flex items-center gap-1 text-xs text-blue-600"><Shield className="h-3 w-3" />HMO {inv.hmoClaimStatus}</span>}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{inv.dueDate ?? '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => setDetailId(inv.id)}>View</Button>
                          {inv.balance > 0 && inv.status !== 'void' && canWrite && <Button size="sm" className="gap-1 bg-emerald-600 text-white" onClick={() => setPayFor(inv)}><Wallet className="h-3.5 w-3.5" />Pay</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'payments' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label className="text-xs">From</Label><Input type="date" value={paymentFrom} onChange={(e) => setPaymentFrom(e.target.value)} className="w-40" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={paymentTo} onChange={(e) => setPaymentTo(e.target.value)} className="w-40" /></div>
            <p className="pb-2 text-sm text-gray-600">{shownPayments.length} payments · {naira(shownPayments.reduce((sum, p) => sum + p.amount, 0))}</p>
            <Button variant="outline" className="ml-auto gap-2" disabled={!shownPayments.length} onClick={() => downloadCsv(`payments-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Date', 'Invoice', 'Patient', 'Amount (NGN)', 'Method', 'Reference', 'Received by'],
              shownPayments.map((p) => [new Date(p.receivedAt).toLocaleString(), p.invoiceNumber, p.patientName, p.amount, methodLabel(p.method), p.reference || p.note, p.receivedBy]))}>
              <Download className="h-4 w-4" />Export CSV
            </Button>
          </div>
          <div className="premium-card glass-panel overflow-x-auto border border-white/60">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-5 py-3">Date</th><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Received by</th><th className="px-5 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {shownPayments.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-sm text-gray-500">{payments.length ? 'No payments in this date range.' : 'No payments recorded yet.'}</td></tr>}
                {shownPayments.map((pay) => (
                  <tr key={pay.id} className="border-b border-gray-50 text-sm">
                    <td className="px-5 py-3 text-gray-600">{new Date(pay.receivedAt).toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono text-royal-600">{pay.invoiceNumber}</td>
                    <td className="px-5 py-3 text-gray-800">{pay.patientName}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{naira(pay.amount)}</td>
                    <td className="px-5 py-3 text-gray-700">{methodLabel(pay.method)}</td>
                    <td className="px-5 py-3 text-gray-500">{pay.reference || pay.note || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{pay.receivedBy}</td>
                    <td className="px-5 py-3 text-right"><Button size="sm" variant="outline" className="gap-1" onClick={() => void printReceiptForPayment(pay.id)}><Printer className="h-3.5 w-3.5" />Print</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div className="premium-card glass-panel overflow-x-auto border border-white/60">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="whitespace-nowrap border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">HMO</th><th className="px-5 py-3">Policy #</th>
                <th className="px-5 py-3">Coverage</th><th className="px-5 py-3">Claimed</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-sm text-gray-500">No HMO claims yet. Open an invoice and choose “Submit HMO claim”.</td></tr>}
              {claims.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-50 text-sm">
                  <td className="px-5 py-3 font-mono text-royal-600">{inv.number}</td>
                  <td className="px-5 py-3">{inv.patientName}</td>
                  <td className="px-5 py-3">{inv.hmoProvider}</td>
                  <td className="px-5 py-3">{inv.hmoPolicyNumber ?? '—'}</td>
                  <td className="px-5 py-3">{inv.hmoCoveragePercent}%</td>
                  <td className="px-5 py-3">{naira(inv.hmoClaimed)}<span className="block text-xs text-gray-400">VitaLink fee {naira(inv.hmoMicroFee)}</span></td>
                  <td className="px-5 py-3">
                    <span className={cn('rounded-full px-3 py-1 text-xs font-medium capitalize', inv.hmoClaimStatus === 'approved' ? 'bg-green-100 text-green-700' : inv.hmoClaimStatus === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{inv.hmoClaimStatus}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    {inv.hmoClaimStatus === 'submitted' && canManage && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => void runAction('Claim approved and payment booked', () => resolveClaim(inv.id, true))}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void runAction('Claim marked rejected', () => resolveClaim(inv.id, false))}>Reject</Button>
                      </div>
                    )}
                    {inv.hmoClaimStatus === 'rejected' && canManage && inv.balance > 0 && (
                      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setClaimFor(inv)}>Resubmit</Button></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'prices' && <PriceList prices={prices} canManage={canManage} canEditDrugs={DRUG_PRICE_ROLES.includes(currentRole)} organizationId={organizationId} onChanged={() => void reload()} />}

      {/* Invoice / running bill detail */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="glass-panel max-h-[90vh] overflow-y-auto border-white/60 sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.status === 'draft' ? 'Running bill' : 'Invoice'} {detail.number}</DialogTitle>
                <DialogDescription>{detail.patientName} · {detail.patientSwitchId} · {detail.status === 'draft' ? 'opened' : 'issued'} {new Date(detail.createdAt).toLocaleDateString()}{detail.dueDate ? ` · due ${detail.dueDate}` : ''}</DialogDescription>
              </DialogHeader>
              {detail.status === 'draft' && <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">Charges from this visit are added automatically as the patient is checked in, tested and given drugs. Finalize when they leave.</p>}
              <div className="space-y-4">
                {SOURCE_GROUPS.map((group) => {
                  const lines = detail.lines.filter((line) => line.sourceType === group.type);
                  if (!lines.length) return null;
                  return (
                    <div key={group.type}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label}</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {lines.map((line) => (
                            <tr key={line.id} className="border-b border-gray-50">
                              <td className="py-2">
                                {line.description.replace(/ \(no price set\)$/, '')}
                                <span className="block text-xs capitalize text-gray-400">
                                  {line.category}{line.sourceType !== 'manual' ? ' · auto' : ''}
                                  {line.unitPrice === 0 && <span className="normal-case text-amber-600"> · no price set</span>}
                                </span>
                              </td>
                              <td className="w-24 py-2 text-gray-600">{line.quantity} × {naira(line.unitPrice)}</td>
                              <td className="w-24 py-2 text-right">{naira(line.total)}</td>
                              <td className="w-8 py-2 text-right">
                                {detail.status === 'draft' && canManage && (
                                  <button type="button" aria-label="Remove charge" className="text-gray-400 hover:text-red-600" onClick={() => {
                                    if (!window.confirm(`Remove ${line.description} from this bill?`)) return;
                                    void runAction('Charge removed', () => removeLine(line.id));
                                  }}><Trash2 className="h-3.5 w-3.5" /></button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                {detail.lines.length === 0 && <p className="text-sm text-gray-500">No charges yet.</p>}
              </div>
              {detail.status === 'draft' && canWrite && <AddChargeForm onAdd={(line) => runAction('Charge added', () => addManualLine(detail.id, line))} />}
              <div className="ml-auto w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{naira(detail.subtotal)}</span></div>
                {detail.discount > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>−{naira(detail.discount)}</span></div>}
                <div className="flex justify-between font-semibold"><span>Total</span><span>{naira(detail.total)}</span></div>
                <div className="flex justify-between text-green-700"><span>Paid</span><span>{naira(detail.paid)}</span></div>
                <div className="flex justify-between font-semibold text-red-600"><span>Balance</span><span>{naira(detail.balance)}</span></div>
              </div>
              {detail.paid > 0 && <InvoiceReceipts invoiceId={detail.id} paid={detail.paid} />}
              {detail.hmoClaimStatus && (
                <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800">HMO claim {detail.hmoClaimStatus}: {detail.hmoProvider} · {detail.hmoCoveragePercent}% · {naira(detail.hmoClaimed)} claimed</p>
              )}
              <DialogFooter className="flex-wrap gap-2">
                {isAdmin && detail.paid === 0 && <Button variant="outline" className="text-red-600" onClick={() => {
                  if (!window.confirm(`Delete ${detail.number}? Its items return to “unbilled”.`)) return;
                  void runAction('Invoice deleted', () => deleteInvoice(detail.id)).then((ok) => { if (ok) setDetailId(null); });
                }}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>}
                {canManage && detail.status !== 'void' && detail.status !== 'paid' && detail.status !== 'draft' && <Button variant="outline" onClick={() => {
                  if (!window.confirm(`Void ${detail.number}? It stays on record but no longer counts as owed.`)) return;
                  void runAction('Invoice voided', () => voidInvoice(detail.id));
                }}>Void</Button>}
                {canManage && detail.balance > 0 && detail.status !== 'void' && detail.status !== 'draft' && (!detail.hmoClaimStatus || detail.hmoClaimStatus === 'rejected') && (
                  <Button variant="outline" className="gap-1" onClick={() => setClaimFor(detail)}><Shield className="h-4 w-4" />Submit HMO claim</Button>
                )}
                {detail.status === 'draft' && canWrite && <Button variant="outline" disabled={!detail.lines.length} onClick={() => void runAction(`${detail.number} finalized`, () => finalizeInvoice(detail.id))}>Finalize bill</Button>}
                {canWrite && detail.balance > 0 && detail.status !== 'void' && <Button className="gap-1 bg-emerald-600 text-white" onClick={() => setPayFor(detail)}><Wallet className="h-4 w-4" />{detail.status === 'draft' ? 'Take deposit' : 'Record payment'}</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <NewInvoiceDialog
        key={newFor?.id ?? 'search'}
        open={newOpen}
        onOpenChange={(next) => { setNewOpen(next); if (!next) setNewFor(null); }}
        tenantId={organizationId}
        initialPatient={newFor}
        onCreated={(number) => { toast.success(`Invoice ${number} created`); void reload(); }}
      />
      <PaymentDialog invoice={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); void reload(); }} />
      <ClaimDialog invoice={claimFor} onClose={() => setClaimFor(null)} onSaved={() => { setClaimFor(null); void reload(); }} />
    </div>
  );
}

function InvoiceReceipts({ invoiceId, paid }: { invoiceId: string; paid: number }) {
  const [receipts, setReceipts] = useState<PaymentReceipt[] | null>(null);
  useEffect(() => {
    // `paid` changes when a payment lands, which also means a new receipt.
    listInvoiceReceipts(invoiceId).then(setReceipts).catch(() => setReceipts([]));
  }, [invoiceId, paid]);
  if (!receipts?.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Receipts</p>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
        {receipts.map((receipt) => (
          <div key={receipt.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span><span className="font-mono text-gray-800">{receipt.number}</span><span className="ml-2 text-xs text-gray-500">{new Date(receipt.issuedAt).toLocaleString()} · {methodLabel(receipt.method)}</span></span>
            <span className="flex items-center gap-2"><span className="font-medium">{naira(receipt.amount)}</span>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => printPaymentReceipt(receipt)}><Printer className="h-3.5 w-3.5" />Print</Button></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddChargeForm({ onAdd }: { onAdd: (line: ExtraLine) => Promise<boolean> }) {
  const [line, setLine] = useState<ExtraLine>({ description: '', category: 'other', quantity: 1, unitPrice: 0 });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!line.description.trim()) { toast.error('Describe the charge'); return; }
    setBusy(true);
    if (await onAdd(line)) setLine({ description: '', category: line.category, quantity: 1, unitPrice: 0 });
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-12 gap-1 rounded-lg border border-dashed border-gray-200 p-2">
      <Input className="col-span-12 sm:col-span-5" placeholder="Add a charge (e.g. Dressing)" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} />
      <select className="col-span-5 rounded-md border border-input bg-white px-2 text-sm sm:col-span-2" value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value as LineCategory })}>
        {LINE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Input className="col-span-2 sm:col-span-1" type="number" min={1} value={line.quantity} onChange={(e) => setLine({ ...line, quantity: Math.max(1, Number(e.target.value)) })} />
      <Input className="col-span-5 sm:col-span-2" type="number" min={0} placeholder="₦" value={line.unitPrice} onChange={(e) => setLine({ ...line, unitPrice: Math.max(0, Number(e.target.value)) })} />
      <Button size="sm" className="col-span-12 h-10 sm:col-span-2" disabled={busy} onClick={() => void add()}><Plus className="mr-1 h-4 w-4" />Add</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewInvoiceDialog({ open, onOpenChange, tenantId, initialPatient, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  initialPatient?: RegistryPatient | null;
  onCreated: (number: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<RegistryPatient[]>([]);
  // A preselected patient (from an appointment) skips the search; the dialog is keyed by it.
  const [patient, setPatient] = useState<RegistryPatient | null>(initialPatient ?? null);
  const [items, setItems] = useState<UnbilledItem[] | null>(null);

  useEffect(() => {
    if (!initialPatient) return;
    previewUnbilled(initialPatient.id)
      .then(setItems)
      .catch((error) => { toast.error(errorText(error, 'Could not load unbilled items')); setItems([]); });
  }, [initialPatient]);
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [dueDays, setDueDays] = useState(7);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || patient) return;
    const needle = query.trim();
    if (needle.length < 2) return;
    const timer = window.setTimeout(() => {
      queryPatients({
        tenantId, page: 1, pageSize: 8, query: needle, sortBy: 'name', sortOrder: 'asc',
        filters: { gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '', admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '' },
      }).then((result) => setMatches(result.rows)).catch(() => setMatches([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, open, patient, tenantId]);

  const choose = (next: RegistryPatient) => {
    setPatient(next);
    setItems(null);
    previewUnbilled(next.id).then(setItems).catch((error) => { toast.error(errorText(error, 'Could not load unbilled items')); setItems([]); });
  };

  const reset = () => {
    setQuery(''); setMatches([]); setPatient(null); setItems(null); setExtras([]); setDiscount(0); setDueDays(7);
  };

  const subtotal = (items ?? []).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    + extras.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const validExtras = extras.filter((line) => line.description.trim());

  const create = async () => {
    if (!patient) return;
    setSaving(true);
    try {
      const number = await buildInvoice(patient.id, { discount, dueDays, extras: validExtras });
      onCreated(number);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error, 'Could not create the invoice'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="glass-panel max-h-[90vh] overflow-y-auto border-white/60 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Pulls the patient's unbilled visits, lab tests and dispensed medication, priced from your price list and pharmacy stock.</DialogDescription>
        </DialogHeader>

        {!patient ? (
          <div className="space-y-2">
            <Label>Patient</Label>
            <Input autoFocus placeholder="Search name, VitaLink ID or phone..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {matches.map((m) => (
                <button key={m.id} onClick={() => choose(m)} className="w-full rounded-lg border border-gray-100 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="font-medium text-gray-900">{m.firstName} {m.lastName}</span>
                  <span className="ml-2 text-xs text-gray-500">{m.switchId} · {m.phone}</span>
                </button>
              ))}
              {query.trim().length >= 2 && matches.length === 0 && <p className="text-sm text-gray-500">No matching patients.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span><strong>{patient.firstName} {patient.lastName}</strong> · {patient.switchId}</span>
              <button className="text-xs text-royal-600 hover:underline" onClick={reset}>Change</button>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Unbilled items</p>
              {items === null ? <p className="text-sm text-gray-500">Loading…</p> : items.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing unbilled for this patient. Add items below if you need to bill something else.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((item) => (
                      <tr key={`${item.sourceType}-${item.sourceId}`} className="border-b border-gray-50">
                        <td className="py-1.5">{item.description}<span className="block text-xs capitalize text-gray-400">{item.category}</span></td>
                        <td className="py-1.5 text-gray-600">{item.quantity} × {naira(item.unitPrice)}</td>
                        <td className={cn('py-1.5 text-right', item.unitPrice === 0 && 'text-amber-600')}>{item.unitPrice === 0 ? 'No price set' : naira(item.quantity * item.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {items?.some((item) => item.unitPrice === 0) && <p className="mt-1 text-xs text-amber-700">Items without a price bill at ₦0. Add them in the Price List tab (or a “Default” price for the category) and they'll be picked up next time.</p>}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-gray-500">Other charges</p>
                <Button size="sm" variant="outline" onClick={() => setExtras((list) => [...list, { description: '', category: 'other', quantity: 1, unitPrice: 0 }])}>Add line</Button>
              </div>
              {extras.map((line, index) => (
                <div key={index} className="mb-1 grid grid-cols-12 gap-1">
                  <Input className="col-span-5" placeholder="Description" value={line.description} onChange={(e) => setExtras((list) => list.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))} />
                  <select className="col-span-3 rounded-md border border-input bg-white px-2 text-sm" value={line.category} onChange={(e) => setExtras((list) => list.map((l, i) => (i === index ? { ...l, category: e.target.value as LineCategory } : l)))}>
                    {LINE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Input className="col-span-1" type="number" min={1} value={line.quantity} onChange={(e) => setExtras((list) => list.map((l, i) => (i === index ? { ...l, quantity: Math.max(1, Number(e.target.value)) } : l)))} />
                  <Input className="col-span-2" type="number" min={0} placeholder="₦" value={line.unitPrice} onChange={(e) => setExtras((list) => list.map((l, i) => (i === index ? { ...l, unitPrice: Math.max(0, Number(e.target.value)) } : l)))} />
                  <button className="col-span-1 text-gray-400 hover:text-red-600" onClick={() => setExtras((list) => list.filter((_, i) => i !== index))}><Trash2 className="mx-auto h-4 w-4" /></button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Discount (₦)</Label><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))} /></div>
              <div><Label>Due in (days)</Label><Input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(Math.max(0, Number(e.target.value)))} /></div>
            </div>
            <p className="text-right text-sm">Total: <strong>{naira(Math.max(0, subtotal - discount))}</strong></p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button className="bg-[#1E4ED8] text-white" disabled={!patient || saving || ((items?.length ?? 0) === 0 && validExtras.length === 0)} onClick={() => void create()}>
            {saving ? 'Creating…' : 'Generate invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ invoice, onClose, onSaved }: { invoice: BillingInvoice | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [forInvoice, setForInvoice] = useState<string | null>(null);

  if (invoice && forInvoice !== invoice.id) {
    setForInvoice(invoice.id);
    setAmount(invoice.balance);
    setMethod('cash');
    setReference('');
  }

  const save = async () => {
    if (!invoice) return;
    if (amount <= 0) return toast.error('Enter an amount above ₦0');
    setSaving(true);
    try {
      const paymentId = await recordPayment(invoice.id, amount, method, reference);
      toast.success(`${naira(amount)} received for ${invoice.number}`, {
        description: 'A receipt with your hospital’s name is ready.',
        action: { label: 'Print receipt', onClick: () => void printReceiptForPayment(paymentId) },
        duration: 15_000,
      });
      onSaved();
    } catch (error) {
      toast.error(errorText(error, 'Could not record the payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-panel border-white/60 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{invoice ? `${invoice.number} · ${invoice.patientName} · balance ${naira(invoice.balance)}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount (₦)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div>
            <Label>Method</Label>
            <select className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div><Label>Reference (optional)</Label><Input placeholder="POS slip, transfer ref…" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 text-white" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Confirm payment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimDialog({ invoice, onClose, onSaved }: { invoice: BillingInvoice | null; onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState('');
  const [policy, setPolicy] = useState('');
  const [coverage, setCoverage] = useState(100);
  const [forInvoice, setForInvoice] = useState<string | null>(null);

  if (invoice && forInvoice !== invoice.id) {
    setForInvoice(invoice.id);
    setProvider(invoice.hmoProvider ?? '');
    setPolicy(invoice.hmoPolicyNumber ?? '');
    setCoverage(invoice.hmoCoveragePercent ?? 100);
  }

  const save = async () => {
    if (!invoice) return;
    try {
      await submitClaim(invoice.id, provider, policy, coverage);
      toast.success('HMO claim submitted');
      onSaved();
    } catch (error) {
      toast.error(errorText(error, 'Could not submit the claim'));
    }
  };

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-panel border-white/60 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit HMO claim</DialogTitle>
          <DialogDescription>{invoice ? `${invoice.number} · total ${naira(invoice.total)} · balance ${naira(invoice.balance)}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>HMO / insurer</Label><Input placeholder="e.g. Reliance HMO, NHIA" value={provider} onChange={(e) => setProvider(e.target.value)} /></div>
          <div><Label>Policy / enrollee number</Label><Input value={policy} onChange={(e) => setPolicy(e.target.value)} /></div>
          <div><Label>Coverage %</Label><Input type="number" min={1} max={100} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} /></div>
          {invoice && <p className="text-xs text-gray-500">Claim amount ≈ {naira(Math.min(invoice.balance, (invoice.total * coverage) / 100))}. The patient pays the rest.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-blue-600 text-white" onClick={() => void save()}>Submit claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Price list: what the automatic charges cost. Services live in service_prices; drug selling
// prices live on pharmacy stock.

type PriceView = 'all' | PriceCategory | 'drugs';
const EMPTY_PRICE: PriceInput = { category: 'consultation', name: '', code: '', unit: 'each', price: 0 };

/** Click to edit; Enter or leaving the field saves, Esc cancels. */
function PriceCell({ value, canEdit, onSave }: { value: number; canEdit: boolean; onSave: (next: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const done = useRef(false);
  if (!canEdit) return <span className={cn(value === 0 && 'text-amber-600')}>{value === 0 ? 'Not set' : naira(value)}</span>;
  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(String(value)); done.current = false; setEditing(true); }} className={cn('group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-royal-50', value === 0 && 'text-amber-600')}>
        {value === 0 ? 'Set price' : naira(value)}<Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
      </button>
    );
  }
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    const next = Math.max(0, Number(draft) || 0);
    setEditing(false);
    if (next !== value) await onSave(next);
  };
  return (
    <Input autoFocus type="number" min={0} className="h-8 w-32" value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') { done.current = true; setEditing(false); } }} />
  );
}

/** Minimal CSV parser: header row, commas, double-quoted cells. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows.filter((r) => r.some((value) => value.trim()));
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  return body.map((r) => Object.fromEntries(keys.map((key, index) => [key, (r[index] ?? '').trim()])));
}

function PriceList({ prices, canManage, canEditDrugs, organizationId, onChanged }: {
  prices: ServicePrice[]; canManage: boolean; canEditDrugs: boolean; organizationId: string; onChanged: () => void;
}) {
  const [view, setView] = useState<PriceView>('all');
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<PriceInput | null>(null);
  const [drugs, setDrugs] = useState<DrugPrice[] | null>(null);
  const [unpriced, setUnpriced] = useState<UnpricedItem[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDrugs = useCallback(() => {
    listDrugPrices(organizationId).then(setDrugs).catch((error) => { toast.error(errorText(error, 'Could not load drug prices')); setDrugs([]); });
  }, [organizationId]);
  const loadUnpriced = useCallback(() => {
    listUnpriced(organizationId).then(setUnpriced).catch(() => setUnpriced([]));
  }, [organizationId]);
  useEffect(() => { loadUnpriced(); }, [loadUnpriced, prices]);
  useEffect(() => { if (view === 'drugs' && drugs === null) loadDrugs(); }, [view, drugs, loadDrugs]);

  const needle = term.trim().toLowerCase();
  const shown = prices.filter((p) => (view === 'all' || p.category === view) && (!needle || `${p.name} ${p.code}`.toLowerCase().includes(needle)));
  const shownDrugs = (drugs ?? []).filter((d) => !needle || `${d.name} ${d.strength}`.toLowerCase().includes(needle));
  const counts = useMemo(() => Object.fromEntries(PRICE_CATEGORIES.map((c) => [c, prices.filter((p) => p.category === c).length])), [prices]);

  const save = async (price: PriceInput) => {
    if (!price.name.trim()) { toast.error('Enter a name'); return false; }
    try {
      await savePrice(organizationId, price);
      toast.success(price.id ? 'Price updated' : 'Added to your price list');
      onChanged();
      return true;
    } catch (error) {
      toast.error(errorText(error, 'Could not save the price'));
      return false;
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const rows = parseCsv(await file.text())
        .map((r) => ({
          code: r.code ?? '', name: r.name ?? '', unit: r.unit || 'each',
          category: (PRICE_CATEGORIES.includes((r.category || r.servicetype || '').toLowerCase() as PriceCategory) ? (r.category || r.servicetype).toLowerCase() : 'other') as PriceCategory,
          price: Number((r.price || r.unitprice || '0').replace(/[₦,\s]/g, '')) || 0,
        }))
        .filter((r) => r.name);
      if (!rows.length) { toast.error('No rows found. Use columns: code, name, category, price, unit'); return; }
      const result = await importPrices(organizationId, rows, prices);
      toast.success(`${result.added} added, ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, {
        description: result.skipped.slice(0, 3).join(' · ') || undefined,
      });
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not import the file'));
    } finally {
      setImporting(false);
    }
  };

  const views: Array<{ id: PriceView; label: string; count?: number }> = [
    { id: 'all', label: 'All services', count: prices.length },
    ...PRICE_CATEGORIES.map((c) => ({ id: c, label: c[0].toUpperCase() + c.slice(1), count: counts[c] })),
    { id: 'drugs', label: 'Drugs' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-royal-100 bg-royal-50/70 p-4 text-sm text-royal-900">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-royal-600" />
        <p>These prices are used automatically: check-ins are charged by appointment type, lab tests by test name or code, and dispensed drugs at their pharmacy selling price. A “Default” entry in a category is used when nothing else matches.</p>
      </div>

      {unpriced.length > 0 && (
        <div className="premium-card border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-amber-900">Billed at ₦0 in the last 30 days</p>
          <p className="text-xs text-amber-800">These had no price. Set one so future charges are right (bills already made don’t change).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unpriced.slice(0, 12).map((item) => (
              <span key={`${item.category}:${item.description}`} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs">
                <span className="capitalize text-amber-700">{item.category}</span>{item.description}<span className="text-gray-400">×{item.count}</span>
                {item.category === 'pharmacy'
                  ? canEditDrugs && <button type="button" className="font-semibold text-royal-600 hover:underline" onClick={() => { setView('drugs'); setTerm(item.description.split(' ')[0]); }}>Set price</button>
                  : canManage && <button type="button" className="font-semibold text-royal-600 hover:underline" onClick={() => setEditing({ ...EMPTY_PRICE, category: (PRICE_CATEGORIES.includes(item.category as PriceCategory) ? item.category : 'other') as PriceCategory, name: item.description })}>Set price</button>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {views.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={cn('whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition', view === v.id ? 'bg-royal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100')}>
              {v.label}{v.count !== undefined ? ` · ${v.count}` : ''}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9" placeholder="Search prices..." />
          </div>
          {canManage && view !== 'drugs' && (
            <>
              <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
              <Button variant="outline" className="gap-2" disabled={importing} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />{importing ? 'Importing…' : 'Import CSV'}</Button>
              <Button className="gap-2 bg-[#1E4ED8] text-white" onClick={() => setEditing({ ...EMPTY_PRICE, category: view === 'all' ? 'consultation' : view })}><Plus className="h-4 w-4" />Add service</Button>
            </>
          )}
        </div>
      </div>

      {view === 'drugs' ? (
        <div className="premium-card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><th className="px-4 py-2">Drug</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">In stock</th><th className="px-4 py-2">Selling price</th></tr></thead>
            <tbody>
              {drugs === null && <tr><td colSpan={4} className="px-4 py-4 text-gray-500">Loading…</td></tr>}
              {drugs && shownDrugs.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-gray-500">{drugs.length ? 'No drugs match.' : 'No drugs in stock yet. Add them in Pharmacy.'}</td></tr>}
              {shownDrugs.map((d) => (
                <tr key={d.id} className="border-b border-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{d.name}{d.strength && <span className="ml-1 font-normal text-gray-500">{d.strength}</span>}</td>
                  <td className="px-4 py-2 text-gray-600">{d.unit}</td>
                  <td className="px-4 py-2 text-gray-600">{d.inStock.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <PriceCell value={d.price} canEdit={canEditDrugs} onSave={async (next) => {
                      try { await saveDrugPrice(d.id, next); toast.success(`${d.name} now ${naira(next)}`); loadDrugs(); loadUnpriced(); }
                      catch (error) { toast.error(errorText(error, 'Could not change the price')); }
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!canEditDrugs && <p className="px-4 py-3 text-xs text-gray-500">Pharmacists and admins set drug prices.</p>}
        </div>
      ) : (
        <div className="premium-card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Active</th><th className="px-4 py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-4 text-gray-500">{prices.length ? 'No prices match.' : 'No prices yet. Start with a “Default” consultation price, then your common lab tests.'}</td></tr>}
              {shown.map((p) => (
                <tr key={p.id} className={cn('border-b border-gray-50', !p.isActive && 'opacity-50')}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{p.code || '—'}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-2 capitalize text-gray-600">{p.category}</td>
                  <td className="px-4 py-2 text-gray-600">{p.unit}</td>
                  <td className="px-4 py-2"><PriceCell value={p.price} canEdit={canManage} onSave={async (next) => { await save({ ...p, price: next }); }} /></td>
                  <td className="px-4 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-[#1E4ED8]" checked={p.isActive} disabled={!canManage} aria-label={`${p.name} active`}
                      onChange={(e) => setPriceActive(p.id, e.target.checked).then(onChanged).catch((error) => toast.error(errorText(error, 'Could not update')))} />
                  </td>
                  <td className="px-4 py-2">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing({ ...p })}>Edit</Button>
                        <Button size="sm" variant="outline" className="text-red-600" aria-label={`Remove ${p.name}`} onClick={() => {
                          if (!window.confirm(`Remove the price for ${p.name}?`)) return;
                          deletePrice(p.id).then(() => { toast.success('Price removed'); onChanged(); }).catch((error) => toast.error(errorText(error, 'Could not remove')));
                        }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && view !== 'drugs' && <p className="text-xs text-gray-500">CSV import columns: code, name, category, price, unit. Rows match existing prices by code, then by category and name.</p>}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit price' : 'Add a service'}</DialogTitle>
            <DialogDescription>Charges match on the code or the exact name, so use the name your team picks when ordering.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form id="price-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(editing).then((ok) => { if (ok) setEditing(null); }); }}>
              <div className="sm:col-span-2"><Label>Name</Label><Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Full Blood Count, Consultation, Default" /></div>
              <div>
                <Label>Category</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm capitalize" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as PriceCategory })}>
                  {PRICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><Label>Code (optional)</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="e.g. FBC" /></div>
              <div><Label>Price (₦)</Label><Input type="number" min={0} value={editing.price} onChange={(e) => setEditing({ ...editing, price: Math.max(0, Number(e.target.value)) })} /></div>
              <div><Label>Unit</Label><Input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="each, test, session, day" /></div>
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="price-form" className="bg-[#1E4ED8] text-white">{editing?.id ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
