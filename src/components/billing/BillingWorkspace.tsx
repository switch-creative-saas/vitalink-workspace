import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Plus, RefreshCw, Search, Shield, Trash2, Wallet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { findPatientBySwitchId, queryPatients, type RegistryPatient } from '@/lib/patientRegistry';
import { BILLING_HANDOFF_KEY } from '@/lib/handoffs';
import {
  buildInvoice,
  deleteInvoice,
  deletePrice,
  listInvoices,
  listPayments,
  listPrices,
  previewUnbilled,
  recordPayment,
  resolveClaim,
  savePrice,
  submitClaim,
  voidInvoice,
  type BillingInvoice,
  type BillingPayment,
  type ExtraLine,
  type LineCategory,
  type PaymentMethod,
  type ServicePrice,
  type UnbilledItem,
} from '@/lib/supabase/billing';

const WRITE_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer', 'receptionist'];
const MANAGE_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer'];
const ADMIN_ROLES: UserRole[] = ['super-admin', 'hospital-admin'];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'pos', label: 'POS' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'nhis', label: 'NHIS' },
  { value: 'waiver', label: 'Waiver' },
];
const PRICE_CATEGORIES: ServicePrice['category'][] = ['consultation', 'lab', 'procedure', 'imaging', 'room', 'supplies', 'other'];
const LINE_CATEGORIES: LineCategory[] = ['consultation', 'lab', 'pharmacy', 'procedure', 'imaging', 'room', 'supplies', 'other'];

const naira = (value: number) => `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const methodLabel = (method: string | null) => METHODS.find((m) => m.value === method)?.label ?? (method === 'hmo' ? 'HMO' : method === 'paystack' ? 'Paystack' : method ?? '—');

function statusChip(invoice: BillingInvoice) {
  if (invoice.status === 'void') return { label: 'void', className: 'bg-gray-100 text-gray-500', Icon: XCircle };
  if (invoice.status === 'paid') return { label: 'paid', className: 'bg-green-100 text-green-700', Icon: CheckCircle2 };
  if (invoice.overdue) return { label: 'overdue', className: 'bg-red-100 text-red-700', Icon: XCircle };
  if (invoice.status === 'partial') return { label: 'partial', className: 'bg-amber-100 text-amber-700', Icon: Clock };
  return { label: 'unpaid', className: 'bg-gray-100 text-gray-600', Icon: Clock };
}

export function BillingWorkspace() {
  const { organization, currentRole } = useAuth();
  const organizationId = organization.id;
  const canWrite = WRITE_ROLES.includes(currentRole);
  const canManage = MANAGE_ROLES.includes(currentRole);
  const isAdmin = ADMIN_ROLES.includes(currentRole);

  const [tab, setTab] = useState<'invoices' | 'payments' | 'claims' | 'prices'>('invoices');
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'void'>('all');
  const [detail, setDetail] = useState<BillingInvoice | null>(null);

  const reload = useCallback(async () => {
    try {
      const [inv, pay, priceList] = await Promise.all([
        listInvoices(organizationId),
        listPayments(organizationId),
        listPrices(organizationId),
      ]);
      setInvoices(inv);
      setPayments(pay);
      setPrices(priceList);
      setDetail((current) => (current ? inv.find((item) => item.id === current.id) ?? null : null));
    } catch (error) {
      toast.error(errorText(error, 'Could not load billing'));
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    const open = invoices.filter((inv) => inv.status !== 'void');
    return [
      { label: 'Collected', value: naira(payments.reduce((sum, p) => sum + p.amount, 0)), tone: 'bg-green-500', onClick: () => setTab('payments') },
      { label: 'Outstanding', value: naira(open.reduce((sum, inv) => sum + inv.balance, 0)), tone: 'bg-amber-500', onClick: () => { setTab('invoices'); setStatusFilter('all'); } },
      { label: 'Overdue', value: naira(open.filter((inv) => inv.overdue).reduce((sum, inv) => sum + inv.balance, 0)), tone: 'bg-red-500', onClick: () => { setTab('invoices'); setStatusFilter('overdue'); } },
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
    } catch (error) {
      toast.error(errorText(error, 'Something went wrong'));
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Billing & Insurance</h1>
          <p className="mt-1 text-sm text-gray-500">Invoices from visits, lab tests and dispensed drugs, payments and HMO claims for {organization.name}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void reload()}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button data-tour-id="billing-new-invoice" className="gap-2 rounded-xl bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={!canWrite} onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />New Invoice
          </Button>
        </div>
      </div>

      <div className="dashboard-stat-grid">
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={metric.onClick} className="premium-card glass-panel card-equal-height h-full min-w-0 overflow-hidden p-4 text-left transition-all hover:shadow-md">
            <div className={cn('mb-1 h-3 w-3 rounded-full', metric.tone)} />
            <p className="truncate text-xl font-bold tabular-nums text-gray-900">{metric.value}</p>
            <p className="truncate text-xs text-gray-500">{metric.label}</p>
          </button>
        ))}
      </div>

      <div data-tour-id="billing-tabs" className="flex w-full max-w-full flex-wrap gap-2 rounded-xl border border-white/60 bg-white/70 p-1">
        {([
          { id: 'invoices', label: 'Invoices' },
          { id: 'payments', label: 'Payments' },
          { id: 'claims', label: 'HMO Claims' },
          { id: 'prices', label: 'Price List' },
        ] as const).map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} className={cn('rounded-lg px-4 py-2.5 text-sm font-medium transition-all', tab === item.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search invoice number, patient or VitaLink ID..." className="rounded-xl bg-white/80 pl-12" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="rounded-xl border border-input bg-white px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              {['all', 'unpaid', 'partial', 'overdue', 'paid', 'void'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div className="premium-card glass-panel overflow-x-auto border border-white/60">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-5 py-3">Invoice #</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Paid</th><th className="px-5 py-3">Balance</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Due</th><th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-sm text-gray-500">{invoices.length ? 'No invoices match.' : 'No invoices yet. Use “New Invoice” to bill a patient for their visits, tests and medication.'}</td></tr>}
                {visible.map((inv) => {
                  const chip = statusChip(inv);
                  return (
                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3"><button className="font-mono text-sm text-royal-600 hover:underline" onClick={() => setDetail(inv)}>{inv.number}</button></td>
                      <td className="px-5 py-3"><p className="font-medium text-gray-900">{inv.patientName}</p><p className="text-xs text-gray-500">{inv.patientSwitchId}</p></td>
                      <td className="px-5 py-3 text-sm text-gray-700">{naira(inv.total)}</td>
                      <td className="px-5 py-3 text-sm text-green-600">{naira(inv.paid)}</td>
                      <td className={cn('px-5 py-3 text-sm font-medium', inv.balance > 0 && inv.status !== 'void' ? 'text-red-600' : 'text-gray-500')}>{naira(inv.balance)}</td>
                      <td className="px-5 py-3">
                        <span className={cn('flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-medium', chip.className)}><chip.Icon className="h-3 w-3" />{chip.label}</span>
                        {inv.hmoClaimStatus && <span className="mt-1 flex items-center gap-1 text-xs text-blue-600"><Shield className="h-3 w-3" />HMO {inv.hmoClaimStatus}</span>}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{inv.dueDate ?? '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => setDetail(inv)}>View</Button>
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
        <div className="premium-card glass-panel overflow-x-auto border border-white/60">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <th className="px-5 py-3">Date</th><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Patient</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Received by</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-sm text-gray-500">No payments recorded yet.</td></tr>}
              {payments.map((pay) => (
                <tr key={pay.id} className="border-b border-gray-50 text-sm">
                  <td className="px-5 py-3 text-gray-600">{new Date(pay.receivedAt).toLocaleString()}</td>
                  <td className="px-5 py-3 font-mono text-royal-600">{pay.invoiceNumber}</td>
                  <td className="px-5 py-3 text-gray-800">{pay.patientName}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{naira(pay.amount)}</td>
                  <td className="px-5 py-3 text-gray-700">{methodLabel(pay.method)}</td>
                  <td className="px-5 py-3 text-gray-500">{pay.reference || pay.note || '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{pay.receivedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'claims' && (
        <div className="premium-card glass-panel overflow-x-auto border border-white/60">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
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

      {tab === 'prices' && <PriceList prices={prices} canManage={canManage} organizationId={organizationId} onChanged={() => void reload()} />}

      {/* Invoice detail */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="glass-panel max-h-[90vh] overflow-y-auto border-white/60 sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>Invoice {detail.number}</DialogTitle>
                <DialogDescription>{detail.patientName} · {detail.patientSwitchId} · issued {new Date(detail.createdAt).toLocaleDateString()}{detail.dueDate ? ` · due ${detail.dueDate}` : ''}</DialogDescription>
              </DialogHeader>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-gray-500"><th className="py-2">Item</th><th className="py-2">Qty</th><th className="py-2">Unit</th><th className="py-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id} className="border-b border-gray-50">
                      <td className="py-2">{line.description}<span className="block text-xs capitalize text-gray-400">{line.category}{line.unitPrice === 0 ? ' · no price set' : ''}</span></td>
                      <td className="py-2">{line.quantity}</td>
                      <td className="py-2">{naira(line.unitPrice)}</td>
                      <td className="py-2 text-right">{naira(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{naira(detail.subtotal)}</span></div>
                {detail.discount > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>−{naira(detail.discount)}</span></div>}
                <div className="flex justify-between font-semibold"><span>Total</span><span>{naira(detail.total)}</span></div>
                <div className="flex justify-between text-green-700"><span>Paid</span><span>{naira(detail.paid)}</span></div>
                <div className="flex justify-between font-semibold text-red-600"><span>Balance</span><span>{naira(detail.balance)}</span></div>
              </div>
              {detail.hmoClaimStatus && (
                <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800">HMO claim {detail.hmoClaimStatus}: {detail.hmoProvider} · {detail.hmoCoveragePercent}% · {naira(detail.hmoClaimed)} claimed</p>
              )}
              <DialogFooter className="flex-wrap gap-2">
                {isAdmin && detail.paid === 0 && <Button variant="outline" className="text-red-600" onClick={() => {
                  if (!window.confirm(`Delete ${detail.number}? Its items return to “unbilled”.`)) return;
                  void runAction('Invoice deleted', () => deleteInvoice(detail.id)).then(() => setDetail(null));
                }}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>}
                {canManage && detail.status !== 'void' && detail.status !== 'paid' && <Button variant="outline" onClick={() => {
                  if (!window.confirm(`Void ${detail.number}? It stays on record but no longer counts as owed.`)) return;
                  void runAction('Invoice voided', () => voidInvoice(detail.id));
                }}>Void</Button>}
                {canManage && detail.balance > 0 && detail.status !== 'void' && (!detail.hmoClaimStatus || detail.hmoClaimStatus === 'rejected') && (
                  <Button variant="outline" className="gap-1" onClick={() => setClaimFor(detail)}><Shield className="h-4 w-4" />Submit HMO claim</Button>
                )}
                {canWrite && detail.balance > 0 && detail.status !== 'void' && <Button className="gap-1 bg-emerald-600 text-white" onClick={() => setPayFor(detail)}><Wallet className="h-4 w-4" />Record payment</Button>}
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
      await recordPayment(invoice.id, amount, method, reference);
      toast.success(`${naira(amount)} received for ${invoice.number}`);
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

function PriceList({ prices, canManage, organizationId, onChanged }: { prices: ServicePrice[]; canManage: boolean; organizationId: string; onChanged: () => void }) {
  const [form, setForm] = useState<{ id?: string; category: ServicePrice['category']; name: string; price: number }>({ category: 'consultation', name: '', price: 0 });

  const save = async () => {
    if (!form.name.trim()) return toast.error('Enter a name');
    try {
      await savePrice(organizationId, form);
      toast.success(form.id ? 'Price updated' : 'Price added');
      setForm({ category: form.category, name: '', price: 0 });
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not save the price'));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Consultations are priced by appointment type (e.g. “Consultation”, “Follow-up”), lab tests by test name. A “Default” entry in a category is used when nothing matches. Drug prices come from Pharmacy stock.
      </p>
      {canManage && (
        <div className="premium-card grid grid-cols-1 gap-2 p-3 md:grid-cols-[160px_1fr_160px_auto_auto]">
          <select className="rounded-md border border-input bg-white px-3 py-2 text-sm capitalize" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ServicePrice['category'] }))}>
            {PRICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Input placeholder="Name (e.g. Consultation, Full blood count, Default)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input type="number" min={0} placeholder="Price ₦" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Math.max(0, Number(e.target.value)) }))} />
          <Button className="bg-[#1E4ED8] text-white" onClick={() => void save()}>{form.id ? 'Update' : 'Add price'}</Button>
          {form.id ? <Button variant="outline" onClick={() => setForm({ category: form.category, name: '', price: 0 })}>Cancel</Button> : <span />}
        </div>
      )}
      <div className="premium-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><th className="px-4 py-2">Category</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Price</th><th className="px-4 py-2 text-right">Actions</th></tr></thead>
          <tbody>
            {prices.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-gray-500">No prices yet. Start with a “Default” consultation price.</td></tr>}
            {prices.map((p) => (
              <tr key={p.id} className="border-b border-gray-50">
                <td className="px-4 py-2 capitalize">{p.category}</td>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{naira(p.price)}</td>
                <td className="px-4 py-2">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setForm({ id: p.id, category: p.category, name: p.name, price: p.price })}>Edit</Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => {
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
    </div>
  );
}
