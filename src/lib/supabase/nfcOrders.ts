import { requireSupabase, functionErrorMessage } from './client';

const toNaira = (kobo: unknown) => Number(kobo ?? 0) / 100;

export type NfcOrderStatus = 'processing' | 'confirmed' | 'paid' | 'dispatched' | 'delivered' | 'cancelled';
export type DeliveryOption = 'pickup' | 'delivery';
export type NfcPaymentMethod = 'paystack' | 'bank_transfer';

export interface OrderingTerms {
  cardPrice: number;
  minPack: number;
  deliveryFee: number;
  pickupAddress: string;
  dispatchDays: number;
  bank: { name: string; accountName: string; accountNumber: string } | null;
  supportEmail: string;
}

export interface NfcOrder {
  id: string;
  number: string;
  quantity: number;
  cardPrice: number;
  deliveryFee: number;
  total: number;
  deliveryOption: DeliveryOption;
  deliveryAddress: string;
  contactName: string;
  contactPhone: string;
  paymentMethod: NfcPaymentMethod;
  status: NfcOrderStatus;
  courier: string;
  trackingNumber: string;
  estimatedDelivery: string | null;
  notes: string;
  orderedAt: string;
  paidAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '23514' || error.code === '22023' || (error.code === '42501' && /VitaLink|support|already|changed/i.test(error.message))) return new Error(error.message);
  if (error.code === '42501' || error.code === 'PGRST116') return new Error(`Only workspace admins can ${action}.`);
  return new Error(error.message);
}

/** Card price / pack size for the workspace's plan, plus VitaLink's delivery and payment details. */
export async function getOrderingTerms(planId: string): Promise<OrderingTerms> {
  const db = requireSupabase();
  const [{ data: plan, error: planError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from('plans').select('nfc_card_price_kobo, nfc_min_pack').eq('id', planId).maybeSingle(),
    db.from('platform_settings').select('*').maybeSingle(),
  ]);
  if (planError) throw new Error(planError.message);
  if (settingsError) throw new Error(settingsError.message);
  const bankReady = Boolean(settings?.bank_name && settings?.bank_account_name && settings?.bank_account_number);
  return {
    cardPrice: toNaira(plan?.nfc_card_price_kobo ?? 0),
    minPack: Number(plan?.nfc_min_pack ?? 100),
    deliveryFee: toNaira(settings?.nfc_delivery_fee_kobo),
    pickupAddress: settings?.nfc_pickup_address ?? '',
    dispatchDays: Number(settings?.nfc_dispatch_days ?? 3),
    bank: bankReady ? { name: settings!.bank_name, accountName: settings!.bank_account_name, accountNumber: settings!.bank_account_number } : null,
    supportEmail: settings?.support_email ?? '',
  };
}

interface OrderRow {
  id: string; order_number: string; quantity: number; price_per_card_kobo: number; delivery_fee_kobo: number; total_kobo: number;
  delivery_option: DeliveryOption; delivery_address: string | null; delivery_contact_name: string | null; delivery_contact_phone: string | null;
  payment_method: NfcPaymentMethod; status: NfcOrderStatus; courier: string | null; tracking_number: string | null;
  estimated_delivery_date: string | null; notes: string | null; ordered_at: string; paid_at: string | null;
  dispatched_at: string | null; delivered_at: string | null; cancelled_at: string | null;
}

const fromRow = (row: OrderRow): NfcOrder => ({
  id: row.id,
  number: row.order_number,
  quantity: row.quantity,
  cardPrice: toNaira(row.price_per_card_kobo),
  deliveryFee: toNaira(row.delivery_fee_kobo),
  total: toNaira(row.total_kobo),
  deliveryOption: row.delivery_option,
  deliveryAddress: row.delivery_address ?? '',
  contactName: row.delivery_contact_name ?? '',
  contactPhone: row.delivery_contact_phone ?? '',
  paymentMethod: row.payment_method,
  status: row.status,
  courier: row.courier ?? '',
  trackingNumber: row.tracking_number ?? '',
  estimatedDelivery: row.estimated_delivery_date,
  notes: row.notes ?? '',
  orderedAt: row.ordered_at,
  paidAt: row.paid_at,
  dispatchedAt: row.dispatched_at,
  deliveredAt: row.delivered_at,
  cancelledAt: row.cancelled_at,
});

export async function listOrders(organizationId: string): Promise<NfcOrder[]> {
  const { data, error } = await requireSupabase()
    .from('nfc_card_orders')
    .select('*')
    .eq('organization_id', organizationId)
    .order('ordered_at', { ascending: false });
  if (error) throw friendly(error, 'view card orders');
  return (data as OrderRow[]).map(fromRow);
}

export async function placeOrder(organizationId: string, input: {
  quantity: number; deliveryOption: DeliveryOption; deliveryAddress: string; contactName: string; contactPhone: string;
  paymentMethod: NfcPaymentMethod; notes: string;
}): Promise<NfcOrder> {
  const { data, error } = await requireSupabase()
    .from('nfc_card_orders')
    .insert({
      organization_id: organizationId,
      quantity: input.quantity,
      delivery_option: input.deliveryOption,
      delivery_address: input.deliveryOption === 'delivery' ? input.deliveryAddress.trim() : null,
      delivery_contact_name: input.contactName.trim() || null,
      delivery_contact_phone: input.contactPhone.trim() || null,
      payment_method: input.paymentMethod,
      notes: input.notes.trim() || null,
    })
    .select('*')
    .single();
  if (error) throw friendly(error, 'order cards');
  return fromRow(data as OrderRow);
}

export async function cancelOrder(id: string) {
  const { error } = await requireSupabase().from('nfc_card_orders').update({ status: 'cancelled' }).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'cancel card orders');
}

export async function setOrderPaymentMethod(id: string, method: NfcPaymentMethod) {
  const { error } = await requireSupabase().from('nfc_card_orders').update({ payment_method: method }).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'change card orders');
}

async function invokeCheckout<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('paystack-checkout', { body });
  if (error) {
    throw new Error(await functionErrorMessage(error));
  }
  return data as T;
}

/** Returns the Paystack checkout URL for an unpaid order. */
export function startOrderPayment(orderId: string) {
  return invokeCheckout<{ authorizationUrl: string }>({ action: 'nfc-order', orderId, callbackUrl: `${window.location.origin}/nfc-cards` });
}

export function verifyOrderPayment(reference: string) {
  return invokeCheckout<{ outcome: 'paid' | 'already_applied' | 'not_successful' | 'unknown_reference' }>({ action: 'verify-nfc', reference });
}

// ---------- VitaLink platform admins ----------

export interface PlatformOrder extends Omit<NfcOrder, 'cardPrice' | 'deliveryFee' | 'cancelledAt'> {
  organizationName: string;
  organizationPhone: string;
  orderedByEmail: string;
}

export async function listPlatformOrders(): Promise<PlatformOrder[]> {
  const { data, error } = await requireSupabase().rpc('platform_nfc_orders');
  if (error) throw new Error(error.message);
  return (data as Array<Record<string, string | number | null>>).map((row) => ({
    id: String(row.id),
    number: String(row.order_number),
    quantity: Number(row.quantity),
    total: toNaira(row.total_kobo),
    deliveryOption: row.delivery_option as DeliveryOption,
    deliveryAddress: String(row.delivery_address ?? ''),
    contactName: String(row.delivery_contact_name ?? ''),
    contactPhone: String(row.delivery_contact_phone ?? ''),
    paymentMethod: row.payment_method as NfcPaymentMethod,
    status: row.status as NfcOrderStatus,
    courier: String(row.courier ?? ''),
    trackingNumber: String(row.tracking_number ?? ''),
    estimatedDelivery: (row.estimated_delivery_date as string | null) ?? null,
    notes: String(row.notes ?? ''),
    orderedAt: String(row.ordered_at),
    paidAt: (row.paid_at as string | null) ?? null,
    dispatchedAt: (row.dispatched_at as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    organizationName: String(row.organization_name ?? ''),
    organizationPhone: String(row.organization_phone ?? ''),
    orderedByEmail: String(row.ordered_by_email ?? ''),
  }));
}

export async function updatePlatformOrder(id: string, patch: {
  status?: NfcOrderStatus; courier?: string; trackingNumber?: string; estimatedDelivery?: string | null;
}) {
  const fields: Record<string, unknown> = {};
  if (patch.status) fields.status = patch.status;
  if (patch.courier !== undefined) fields.courier = patch.courier.trim() || null;
  if (patch.trackingNumber !== undefined) fields.tracking_number = patch.trackingNumber.trim() || null;
  if (patch.estimatedDelivery !== undefined) fields.estimated_delivery_date = patch.estimatedDelivery || null;
  const { error } = await requireSupabase().from('nfc_card_orders').update(fields).eq('id', id).select('id').single();
  if (error) throw new Error(error.message);
}

export interface PlatformSettings {
  deliveryFee: number;
  pickupAddress: string;
  dispatchDays: number;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  supportEmail: string;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const { data, error } = await requireSupabase().from('platform_settings').select('*').single();
  if (error) throw new Error(error.message);
  return {
    deliveryFee: toNaira(data.nfc_delivery_fee_kobo),
    pickupAddress: data.nfc_pickup_address,
    dispatchDays: data.nfc_dispatch_days,
    bankName: data.bank_name,
    bankAccountName: data.bank_account_name,
    bankAccountNumber: data.bank_account_number,
    supportEmail: data.support_email,
  };
}

export async function savePlatformSettings(settings: PlatformSettings) {
  const { error } = await requireSupabase()
    .from('platform_settings')
    .update({
      nfc_delivery_fee_kobo: Math.round(settings.deliveryFee * 100),
      nfc_pickup_address: settings.pickupAddress.trim(),
      nfc_dispatch_days: settings.dispatchDays,
      bank_name: settings.bankName.trim(),
      bank_account_name: settings.bankAccountName.trim(),
      bank_account_number: settings.bankAccountNumber.trim(),
      support_email: settings.supportEmail.trim(),
    })
    .eq('id', true)
    .select('id')
    .single();
  if (error) throw new Error(error.code === 'PGRST116' || error.code === '42501' ? 'Only VitaLink platform admins can change these settings.' : error.message);
}
