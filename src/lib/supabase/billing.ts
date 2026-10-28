// Billing: invoices, payments, HMO claims and the price list. Visits, lab tests and dispensed drugs
// bill themselves onto the patient's running bill (an invoice in status 'draft') through database
// triggers; billing staff finalize it, take payment, or build a one-off invoice.
import { requireSupabase } from './client';

// Stored in kobo; the Billing page works in naira.
const toNaira = (kobo: number | null | undefined) => Number(kobo ?? 0) / 100;
const toKobo = (naira: number) => Math.round(Number(naira || 0) * 100);

type Person = { full_name: string; email: string } | null;

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' || error.code === 'PGRST116') {
    // Guard triggers raise readable 42501 messages; plain RLS denials don't.
    return new Error(/void it|already has payments/i.test(error.message) ? error.message : `Your role cannot ${action}.`);
  }
  return new Error(error.message);
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'void' | 'refunded';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'pos' | 'hmo' | 'nhis' | 'waiver' | 'paystack';
export type ClaimStatus = 'pending' | 'submitted' | 'approved' | 'rejected';
export type LineCategory = 'consultation' | 'lab' | 'pharmacy' | 'procedure' | 'room' | 'imaging' | 'supplies' | 'other';

export interface InvoiceLine {
  id: string;
  description: string;
  category: LineCategory;
  quantity: number;
  unitPrice: number;
  total: number;
  sourceType: 'appointment' | 'lab_result' | 'prescription' | 'manual';
  sourceId: string | null;
}

export interface BillingInvoice {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  patientSwitchId: string;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  overdue: boolean;
  appointmentId: string | null;
  updatedAt: string;
  paymentMethod: PaymentMethod | null;
  dueDate: string | null;
  createdAt: string;
  hmoProvider: string | null;
  hmoPolicyNumber: string | null;
  hmoCoveragePercent: number | null;
  hmoClaimed: number;
  hmoMicroFee: number;
  hmoClaimStatus: ClaimStatus | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  patient_id: string;
  total_amount_kobo: number;
  amount_paid_kobo: number;
  discount_kobo: number;
  status: InvoiceStatus;
  appointment_id: string | null;
  updated_at: string;
  payment_method: PaymentMethod | null;
  due_date: string | null;
  created_at: string;
  hmo_provider: string | null;
  hmo_policy_number: string | null;
  hmo_coverage_percent: number | null;
  hmo_claimed_kobo: number | null;
  hmo_micro_fee_kobo: number | null;
  hmo_claim_status: ClaimStatus | null;
  patient: { first_name: string; last_name: string; switch_id: string } | null;
  lines: Array<{ id: string; description: string; category: LineCategory | null; quantity: number; unit_price_kobo: number; total_kobo: number; source_type: InvoiceLine['sourceType']; source_id: string | null }>;
}

const INVOICE_SELECT = `*,
  patient:patients!invoices_patient_same_org_fkey(first_name, last_name, switch_id),
  lines:invoice_line_items(id, description, category, quantity, unit_price_kobo, total_kobo, source_type, source_id, created_at)`;

function invoiceFromRow(row: InvoiceRow): BillingInvoice {
  const lines = (row.lines ?? []).map((line) => ({
    id: line.id,
    description: line.description,
    category: line.category ?? 'other',
    quantity: line.quantity,
    unitPrice: toNaira(line.unit_price_kobo),
    total: toNaira(line.total_kobo),
    sourceType: line.source_type,
    sourceId: line.source_id,
  }));
  const total = toNaira(row.total_amount_kobo);
  const paid = toNaira(row.amount_paid_kobo);
  const balance = Math.max(0, total - paid);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: row.id,
    number: row.invoice_number,
    patientId: row.patient_id,
    patientName: row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient',
    patientSwitchId: row.patient?.switch_id ?? '',
    lines,
    subtotal: lines.reduce((sum, line) => sum + line.total, 0),
    discount: toNaira(row.discount_kobo),
    total,
    paid,
    balance,
    status: row.status,
    overdue: balance > 0 && row.status !== 'void' && row.status !== 'draft' && Boolean(row.due_date && row.due_date < today),
    appointmentId: row.appointment_id,
    updatedAt: row.updated_at,
    paymentMethod: row.payment_method,
    dueDate: row.due_date,
    createdAt: row.created_at,
    hmoProvider: row.hmo_provider,
    hmoPolicyNumber: row.hmo_policy_number,
    hmoCoveragePercent: row.hmo_coverage_percent,
    hmoClaimed: toNaira(row.hmo_claimed_kobo),
    hmoMicroFee: toNaira(row.hmo_micro_fee_kobo),
    hmoClaimStatus: row.hmo_claim_status,
  };
}

export async function listInvoices(organizationId: string): Promise<BillingInvoice[]> {
  const { data, error } = await requireSupabase()
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw friendly(error, 'view invoices');
  return (data as unknown as InvoiceRow[]).map(invoiceFromRow);
}

// ---------- building invoices ----------

export interface UnbilledItem {
  sourceType: 'appointment' | 'lab_result' | 'prescription';
  sourceId: string;
  description: string;
  category: LineCategory;
  quantity: number;
  unitPrice: number;
}

export async function previewUnbilled(patientId: string): Promise<UnbilledItem[]> {
  const { data, error } = await requireSupabase().rpc('preview_unbilled_items', { p_patient_id: patientId });
  if (error) throw friendly(error, 'prepare invoices');
  return (data as Array<{ source_type: UnbilledItem['sourceType']; source_id: string; description: string; category: LineCategory; quantity: number; unit_price_kobo: number }>).map((row) => ({
    sourceType: row.source_type,
    sourceId: row.source_id,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    unitPrice: toNaira(row.unit_price_kobo),
  }));
}

export interface ExtraLine {
  description: string;
  category: LineCategory;
  quantity: number;
  unitPrice: number;
}

export async function buildInvoice(
  patientId: string,
  options: { discount: number; dueDays: number; extras: ExtraLine[]; paymentMethod?: PaymentMethod | null; notes?: string },
): Promise<string> {
  const { data, error } = await requireSupabase().rpc('build_patient_invoice', {
    p_patient_id: patientId,
    p_discount_kobo: toKobo(options.discount),
    p_due_days: options.dueDays,
    p_extra_items: options.extras.map((line) => ({
      description: line.description,
      category: line.category,
      quantity: line.quantity,
      unit_price_kobo: toKobo(line.unitPrice),
    })),
    p_payment_method: options.paymentMethod ?? null,
    p_notes: options.notes ?? null,
  });
  if (error) throw friendly(error, 'create invoices');
  return (data as { invoice_number: string }).invoice_number;
}

/** Closes a running bill (draft → unpaid) so it can be chased and claimed like any invoice. */
export async function finalizeInvoice(invoiceId: string, dueDays = 7) {
  const { error } = await requireSupabase().rpc('billing_finalize_invoice', { p_invoice_id: invoiceId, p_due_days: dueDays });
  if (error) throw friendly(error, 'finalize bills');
}

export async function addManualLine(invoiceId: string, line: ExtraLine) {
  const { error } = await requireSupabase().from('invoice_line_items').insert({
    invoice_id: invoiceId, description: line.description.trim(), category: line.category,
    quantity: Math.max(1, Math.round(line.quantity)), unit_price_kobo: toKobo(line.unitPrice), source_type: 'manual',
  });
  if (error) throw friendly(error, 'add charges');
}

export async function removeLine(lineId: string) {
  const { error, count } = await requireSupabase().from('invoice_line_items').delete({ count: 'exact' }).eq('id', lineId);
  if (error) throw friendly(error, 'remove charges');
  if (!count) throw new Error('Only billing managers can remove charges.');
}

/** Re-runs onChange whenever an invoice changes (new charges, payments and finalizing all touch the invoice). */
export function subscribeToBilling(organizationId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`billing-${organizationId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `organization_id=eq.${organizationId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoice_payments', filter: `organization_id=eq.${organizationId}` }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

export async function setInvoiceDiscount(invoiceId: string, discount: number) {
  const { error } = await requireSupabase().from('invoices').update({ discount_kobo: toKobo(discount) }).eq('id', invoiceId).select('id').single();
  if (error) throw friendly(error, 'edit invoices');
}

export async function voidInvoice(invoiceId: string) {
  const { error } = await requireSupabase().from('invoices').update({ status: 'void' }).eq('id', invoiceId).select('id').single();
  if (error) throw friendly(error, 'void invoices');
}

export async function deleteInvoice(invoiceId: string) {
  const { error, count } = await requireSupabase().from('invoices').delete({ count: 'exact' }).eq('id', invoiceId);
  if (error) throw friendly(error, 'delete invoices');
  if (!count) throw new Error('Only workspace admins can delete invoices.');
}

// ---------- payments ----------

export interface BillingPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  note: string;
  receivedBy: string;
  receivedAt: string;
}

export async function listPayments(organizationId: string): Promise<BillingPayment[]> {
  const { data, error } = await requireSupabase()
    .from('invoice_payments')
    .select(`*, invoice:invoices(invoice_number, patient:patients!invoices_patient_same_org_fkey(first_name, last_name)),
      receiver:profiles!invoice_payments_received_by_fkey(full_name, email)`)
    .eq('organization_id', organizationId)
    .order('received_at', { ascending: false })
    .limit(500);
  if (error) throw friendly(error, 'view payments');
  return (data as unknown as Array<{
    id: string; invoice_id: string; amount_kobo: number; method: PaymentMethod; reference: string | null; note: string | null; received_at: string;
    invoice: { invoice_number: string; patient: { first_name: string; last_name: string } | null } | null;
    receiver: Person;
  }>).map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice?.invoice_number ?? '',
    patientName: row.invoice?.patient ? `${row.invoice.patient.first_name} ${row.invoice.patient.last_name}` : '',
    amount: toNaira(row.amount_kobo),
    method: row.method,
    reference: row.reference ?? '',
    note: row.note ?? '',
    receivedBy: row.receiver?.full_name || row.receiver?.email || '—',
    receivedAt: row.received_at,
  }));
}

export async function recordPayment(invoiceId: string, amount: number, method: PaymentMethod, reference?: string) {
  const { error } = await requireSupabase().from('invoice_payments').insert({
    invoice_id: invoiceId,
    amount_kobo: toKobo(amount),
    method,
    reference: reference?.trim() || null,
  });
  if (error) throw friendly(error, 'record payments');
}

// ---------- HMO claims ----------

export async function submitClaim(invoiceId: string, provider: string, policyNumber: string, coveragePercent: number) {
  const { error } = await requireSupabase().rpc('submit_hmo_claim', {
    p_invoice_id: invoiceId,
    p_provider: provider,
    p_policy_number: policyNumber,
    p_coverage_percent: Math.round(coveragePercent),
  });
  if (error) throw friendly(error, 'submit HMO claims');
}

export async function resolveClaim(invoiceId: string, approved: boolean, approvedAmount?: number) {
  const { error } = await requireSupabase().rpc('resolve_hmo_claim', {
    p_invoice_id: invoiceId,
    p_approved: approved,
    p_approved_amount_kobo: approvedAmount === undefined ? null : toKobo(approvedAmount),
  });
  if (error) throw friendly(error, 'resolve HMO claims');
}

// ---------- price list ----------

export type PriceCategory = Exclude<LineCategory, 'pharmacy'>;

export interface ServicePrice {
  id: string;
  category: PriceCategory;
  name: string;
  code: string;
  unit: string;
  price: number;
  isActive: boolean;
}

export async function listPrices(organizationId: string): Promise<ServicePrice[]> {
  const { data, error } = await requireSupabase()
    .from('service_prices')
    .select('id, category, name, code, unit, price_kobo, is_active')
    .eq('organization_id', organizationId)
    .order('category')
    .order('name');
  if (error) throw friendly(error, 'view prices');
  return (data as Array<{ id: string; category: PriceCategory; name: string; code: string | null; unit: string | null; price_kobo: number; is_active: boolean }>).map((row) => ({
    id: row.id, category: row.category, name: row.name, code: row.code ?? '', unit: row.unit ?? 'each', price: toNaira(row.price_kobo), isActive: row.is_active,
  }));
}

export type PriceInput = Omit<ServicePrice, 'id' | 'isActive'> & { id?: string; isActive?: boolean };

export async function savePrice(organizationId: string, price: PriceInput) {
  const db = requireSupabase();
  const fields = {
    category: price.category, name: price.name.trim(), price_kobo: toKobo(price.price),
    code: price.code.trim().toUpperCase() || null, unit: price.unit.trim() || 'each',
    ...(price.isActive === undefined ? {} : { is_active: price.isActive }),
  };
  const { error } = price.id
    ? await db.from('service_prices').update(fields).eq('id', price.id).select('id').single()
    : await db.from('service_prices').insert({ ...fields, organization_id: organizationId });
  if (error) {
    if (error.code === '23505') throw new Error(`"${price.code || price.name}" is already on your price list.`);
    throw friendly(error, 'manage prices');
  }
}

export async function setPriceActive(id: string, isActive: boolean) {
  const { error } = await requireSupabase().from('service_prices').update({ is_active: isActive }).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'manage prices');
}

export async function deletePrice(id: string) {
  const { error } = await requireSupabase().from('service_prices').delete().eq('id', id);
  if (error) throw friendly(error, 'manage prices');
}

/** CSV rows (code, name, category, price, unit) → added / updated / skipped. Matches on code, else category + name. */
export async function importPrices(organizationId: string, rows: Array<Omit<PriceInput, 'id'>>, existing: ServicePrice[]) {
  const result = { added: 0, updated: 0, skipped: [] as string[] };
  for (const row of rows) {
    const match = existing.find((p) => (row.code && p.code && p.code.toUpperCase() === row.code.trim().toUpperCase())
      || (p.category === row.category && p.name.toLowerCase() === row.name.trim().toLowerCase()));
    try {
      await savePrice(organizationId, { ...row, id: match?.id, isActive: true });
      if (match) result.updated += 1; else result.added += 1;
    } catch (error) {
      result.skipped.push(`${row.name}: ${error instanceof Error ? error.message : 'could not save'}`);
    }
  }
  return result;
}

export interface DrugPrice { id: string; name: string; strength: string; unit: string; inStock: number; price: number }

/** Drug selling prices live on pharmacy stock (drug_inventory.unit_price_kobo). */
export async function listDrugPrices(organizationId: string): Promise<DrugPrice[]> {
  const { data, error } = await requireSupabase()
    .from('drug_inventory')
    .select('id, drug_name, strength, unit_of_measure, quantity_in_stock, unit_price_kobo')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('drug_name');
  if (error) throw friendly(error, 'view drug prices');
  return (data as Array<{ id: string; drug_name: string; strength: string | null; unit_of_measure: string | null; quantity_in_stock: number; unit_price_kobo: number | null }>).map((row) => ({
    id: row.id, name: row.drug_name, strength: row.strength ?? '', unit: row.unit_of_measure ?? 'unit', inStock: row.quantity_in_stock, price: toNaira(row.unit_price_kobo),
  }));
}

export async function saveDrugPrice(id: string, price: number) {
  const { error } = await requireSupabase().from('drug_inventory').update({ unit_price_kobo: toKobo(price) }).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'change drug prices');
}

export interface UnpricedItem { description: string; category: LineCategory; count: number; lastBilled: string }

/** Charges billed at ₦0 in the last `days` days, so the price list gaps can be filled. */
export async function listUnpriced(organizationId: string, days = 30): Promise<UnpricedItem[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await requireSupabase()
    .from('invoice_line_items')
    .select('description, category, created_at, invoice:invoices!inner(organization_id)')
    .eq('invoice.organization_id', organizationId)
    .eq('unit_price_kobo', 0)
    .neq('source_type', 'manual')
    .gte('created_at', since)
    .limit(500);
  if (error) throw friendly(error, 'view prices');
  const grouped = new Map<string, UnpricedItem>();
  for (const row of data as Array<{ description: string; category: LineCategory | null; created_at: string }>) {
    // "Malaria RDT (no price set)" and "Consultation — OPD" → the name the price list matches on.
    // Invoices built by hand also carry the date: "Lipid Panel (17 Oct 2026)".
    const description = row.description.replace(/ \(no price set\)$/, '').replace(/ \(\d{1,2} [A-Za-z]{3} \d{4}\)$/, '')
      .replace(/ — .*$/, '').replace(/ · batch .*$/, '');
    const category = row.category ?? 'other';
    const key = `${category}:${description.toLowerCase()}`;
    const item = grouped.get(key);
    if (item) { item.count += 1; if (row.created_at > item.lastBilled) item.lastBilled = row.created_at; }
    else grouped.set(key, { description, category, count: 1, lastBilled: row.created_at });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}
