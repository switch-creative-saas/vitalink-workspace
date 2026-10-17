import { requireSupabase } from './client';

// Amounts are stored in kobo; the Pharmacy page works in naira.
const toNaira = (kobo: number | null) => (kobo == null ? 0 : Number(kobo) / 100);
const toKobo = (naira: number) => Math.round(Number(naira || 0) * 100);

type Person = { full_name: string; email: string } | null;
const nameOf = (person: Person, fallback = '—') => person?.full_name || person?.email || fallback;

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' || error.code === 'PGRST116') return new Error(`Your role cannot ${action}.`);
  if (error.code === '23514') return new Error('Stock cannot go below zero.');
  // RPCs raise readable messages (e.g. "Only 3 in stock for ..."); pass them through.
  return new Error(error.message);
}

// ---------- inventory ----------

export interface StockItem {
  id: string;
  name: string;
  genericName: string;
  category: string;
  formulation: string;
  strength: string;
  stock: number;
  unitPrice: number;
  unitCost: number;
  expiryDate: string;
  batchNo: string;
  supplier: string;
  reorderThreshold: number;
  isControlled: boolean;
  isActive: boolean;
}

interface InventoryRow {
  id: string;
  drug_name: string;
  generic_name: string | null;
  category: string | null;
  formulation: string | null;
  strength: string | null;
  quantity_in_stock: number;
  unit_price_kobo: number | null;
  unit_cost_kobo: number | null;
  expiry_date: string | null;
  batch_number: string | null;
  supplier: string | null;
  reorder_level: number;
  is_controlled: boolean;
  is_active: boolean;
}

const stockFromRow = (row: InventoryRow): StockItem => ({
  id: row.id,
  name: row.drug_name,
  genericName: row.generic_name ?? '',
  category: row.category ?? 'Uncategorised',
  formulation: row.formulation ?? '',
  strength: row.strength ?? '',
  stock: row.quantity_in_stock,
  unitPrice: toNaira(row.unit_price_kobo),
  unitCost: toNaira(row.unit_cost_kobo),
  expiryDate: row.expiry_date ?? '',
  batchNo: row.batch_number ?? '',
  supplier: row.supplier ?? '',
  reorderThreshold: row.reorder_level,
  isControlled: row.is_controlled,
  isActive: row.is_active,
});

export async function listInventory(organizationId: string): Promise<StockItem[]> {
  const { data, error } = await requireSupabase()
    .from('drug_inventory')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('drug_name');
  if (error) throw friendly(error, 'view pharmacy stock');
  return (data as InventoryRow[]).map(stockFromRow);
}

export interface NewStock {
  name: string;
  category: string;
  batchNo: string;
  supplier: string;
  quantity: number;
  unitPrice: number;
  expiryDate: string;
  reorderThreshold: number;
}

/** Adds to an existing batch (same drug + batch number) or creates a new stock line. */
export async function receiveStock(organizationId: string, input: NewStock): Promise<StockItem> {
  const db = requireSupabase();
  const { data: existing, error: findError } = await db
    .from('drug_inventory')
    .select('*')
    .eq('organization_id', organizationId)
    .ilike('drug_name', input.name.trim())
    .eq('batch_number', input.batchNo.trim())
    .eq('is_active', true)
    .maybeSingle();
  if (findError) throw friendly(findError, 'add stock');
  const fields = {
    category: input.category,
    supplier: input.supplier.trim() || null,
    unit_price_kobo: toKobo(input.unitPrice),
    expiry_date: input.expiryDate || null,
    reorder_level: Math.max(0, Number(input.reorderThreshold) || 0),
  };
  const query = existing
    ? db.from('drug_inventory').update({ ...fields, quantity_in_stock: (existing as InventoryRow).quantity_in_stock + Number(input.quantity) }).eq('id', (existing as InventoryRow).id)
    : db.from('drug_inventory').insert({
        ...fields,
        organization_id: organizationId,
        drug_name: input.name.trim(),
        batch_number: input.batchNo.trim() || null,
        quantity_in_stock: Number(input.quantity),
      });
  const { data, error } = await query.select('*').single();
  if (error) throw friendly(error, 'add stock');
  return stockFromRow(data as InventoryRow);
}

export async function updateStock(id: string, patch: Partial<Pick<StockItem, 'stock' | 'unitPrice' | 'expiryDate' | 'reorderThreshold' | 'supplier'>>): Promise<StockItem> {
  const update: Record<string, unknown> = {};
  if (patch.stock !== undefined) update.quantity_in_stock = Math.max(0, Math.round(patch.stock));
  if (patch.unitPrice !== undefined) update.unit_price_kobo = toKobo(patch.unitPrice);
  if (patch.expiryDate !== undefined) update.expiry_date = patch.expiryDate || null;
  if (patch.reorderThreshold !== undefined) update.reorder_level = Math.max(0, Math.round(patch.reorderThreshold));
  if (patch.supplier !== undefined) update.supplier = patch.supplier || null;
  const { data, error } = await requireSupabase().from('drug_inventory').update(update).eq('id', id).select('*').single();
  if (error) throw friendly(error, 'edit stock');
  return stockFromRow(data as InventoryRow);
}

export async function deleteStock(id: string) {
  const { error, count } = await requireSupabase().from('drug_inventory').delete({ count: 'exact' }).eq('id', id);
  if (error) throw friendly(error, 'delete stock');
  if (!count) throw new Error('Only workspace admins can delete stock lines.');
}

// ---------- prescriptions ----------

export interface PrescriptionItem {
  id: string;
  patientId: string;
  patientName: string;
  patientSwitchId: string;
  /** Free-text allergies from the patient record, for the dispensing check. */
  patientAllergies: string;
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: number | null;
  instructions: string;
  status: 'active' | 'dispensed' | 'cancelled' | 'expired';
  prescriberName: string;
  prescribedAt: string;
  dispensedAt: string | null;
  dispensedQuantity: number | null;
  dispenserName: string;
  dispensedFrom: string;
}

interface PrescriptionRow {
  id: string;
  patient_id: string;
  drug_name: string;
  dosage: string;
  frequency: string;
  duration: string | null;
  quantity: number | null;
  instructions: string | null;
  status: PrescriptionItem['status'];
  created_at: string;
  dispensed_at: string | null;
  dispensed_quantity: number | null;
  patient: { first_name: string; last_name: string; switch_id: string; allergies: string | null } | null;
  prescriber: Person;
  dispenser: Person;
  stock: { drug_name: string; batch_number: string | null } | null;
}

const PRESCRIPTION_SELECT = `*,
  patient:patients!prescriptions_patient_same_org_fkey(first_name, last_name, switch_id, allergies),
  prescriber:profiles!prescriptions_prescriber_profile_fk(full_name, email),
  dispenser:profiles!prescriptions_dispenser_profile_fk(full_name, email),
  stock:drug_inventory!prescriptions_inventory_same_org_fkey(drug_name, batch_number)`;

const prescriptionFromRow = (row: PrescriptionRow): PrescriptionItem => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient',
  patientSwitchId: row.patient?.switch_id ?? '',
  patientAllergies: row.patient?.allergies ?? '',
  drugName: row.drug_name,
  dosage: row.dosage,
  frequency: row.frequency,
  duration: row.duration ?? '',
  quantity: row.quantity,
  instructions: row.instructions ?? '',
  status: row.status,
  prescriberName: nameOf(row.prescriber),
  prescribedAt: row.created_at,
  dispensedAt: row.dispensed_at,
  dispensedQuantity: row.dispensed_quantity,
  dispenserName: nameOf(row.dispenser),
  dispensedFrom: row.stock ? `${row.stock.drug_name}${row.stock.batch_number ? ` · ${row.stock.batch_number}` : ''}` : '',
});

/** Active prescriptions plus the last 90 days of dispensing. */
export async function listPrescriptions(organizationId: string): Promise<PrescriptionItem[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await requireSupabase()
    .from('prescriptions')
    .select(PRESCRIPTION_SELECT)
    .eq('organization_id', organizationId)
    .or(`status.eq.active,dispensed_at.gte.${since}`)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'view prescriptions');
  return (data as unknown as PrescriptionRow[]).map(prescriptionFromRow);
}

export async function listPatientPrescriptions(organizationId: string, patientId: string): Promise<PrescriptionItem[]> {
  const { data, error } = await requireSupabase()
    .from('prescriptions')
    .select(PRESCRIPTION_SELECT)
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'view prescriptions');
  return (data as unknown as PrescriptionRow[]).map(prescriptionFromRow);
}

/** "Amoxicillin 500mg TDS x 7 days" -> one prescription per line of the SOAP plan. */
export function parsePrescriptionLines(text: string): string[] {
  return text.split(/\r?\n|;/).map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);
}

export async function createPrescriptions(organizationId: string, patientId: string, lines: string[], noteId?: string): Promise<number> {
  if (lines.length === 0) return 0;
  const { error } = await requireSupabase().from('prescriptions').insert(
    lines.map((line) => ({
      organization_id: organizationId,
      patient_id: patientId,
      note_id: noteId ?? null,
      drug_name: line,
      // Only an explicit count ("qty 21", "#21"); "x7 days" is a duration, not a quantity.
      quantity: Number(line.match(/(?:\bqty|\bquantity|#)\s*:?\s*(\d+)\b/i)?.[1]) || null,
    })),
  );
  if (error) throw friendly(error, 'write prescriptions');
  return lines.length;
}

export async function dispensePrescription(prescriptionId: string, inventoryId: string, quantity: number) {
  const { error } = await requireSupabase().rpc('dispense_prescription', {
    p_prescription_id: prescriptionId,
    p_inventory_id: inventoryId,
    p_quantity: quantity,
  });
  if (error) throw friendly(error, 'dispense');
}

export async function cancelPrescription(id: string) {
  const { error } = await requireSupabase().from('prescriptions').update({ status: 'cancelled' }).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'cancel prescriptions');
}

// ---------- purchase orders ----------

export interface PurchaseOrderItem {
  id: string;
  poNumber: string;
  supplier: string;
  items: { inventoryId: string; drugName: string; quantity: number }[];
  status: 'pending' | 'approved' | 'delivered' | 'cancelled';
  createdAt: string;
}

interface PurchaseOrderRow {
  id: string;
  po_number: string;
  supplier: string;
  items: { inventory_id: string; drug_name: string; quantity: number }[];
  status: PurchaseOrderItem['status'];
  created_at: string;
}

const poFromRow = (row: PurchaseOrderRow): PurchaseOrderItem => ({
  id: row.id,
  poNumber: row.po_number,
  supplier: row.supplier,
  items: row.items.map((item) => ({ inventoryId: item.inventory_id, drugName: item.drug_name, quantity: Number(item.quantity) })),
  status: row.status,
  createdAt: row.created_at,
});

export async function listPurchaseOrders(organizationId: string): Promise<PurchaseOrderItem[]> {
  const { data, error } = await requireSupabase()
    .from('purchase_orders')
    .select('id, po_number, supplier, items, status, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'view purchase orders');
  return (data as PurchaseOrderRow[]).map(poFromRow);
}

export async function createPurchaseOrder(organizationId: string, supplier: string, items: { inventoryId: string; drugName: string; quantity: number }[]) {
  const { error } = await requireSupabase().from('purchase_orders').insert({
    organization_id: organizationId,
    supplier: supplier.trim(),
    items: items.map((item) => ({ inventory_id: item.inventoryId, drug_name: item.drugName, quantity: item.quantity })),
  });
  if (error) throw friendly(error, 'raise purchase orders');
}

export async function setPurchaseOrderStatus(id: string, status: 'approved' | 'delivered' | 'cancelled') {
  const { error } = await requireSupabase().rpc('set_purchase_order_status', { p_purchase_order_id: id, p_status: status });
  if (error) throw friendly(error, `mark purchase orders ${status}`);
}
