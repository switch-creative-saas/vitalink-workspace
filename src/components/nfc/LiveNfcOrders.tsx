// VitaCard ordering for a live (Supabase) workspace: prices and delivery terms
// come from the database, orders are paid by card (Paystack) or bank transfer,
// and VitaLink platform admins fulfil them from the Fulfilment tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Minus, Package, Plus, Settings2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { amIPlatformAdmin } from '@/lib/supabase/auth';
import {
  cancelOrder, getOrderingTerms, getPlatformSettings, listOrders, listPlatformOrders, placeOrder, savePlatformSettings,
  setOrderPaymentMethod, startOrderPayment, updatePlatformOrder, verifyOrderPayment,
  type DeliveryOption, type NfcOrder, type NfcOrderStatus, type NfcPaymentMethod, type OrderingTerms, type PlatformOrder, type PlatformSettings,
} from '@/lib/supabase/nfcOrders';

const ADMIN_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];
const naira = (value: number) => `₦${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const cardDetails = ['NFC chip (ISO 14443A)', 'VitaLink ID encoded', 'Emergency profile accessible without login', 'PIN-protected full record access', 'QR code on reverse', 'VitaLink branding'];

const STATUS: Record<NfcOrderStatus, { label: string; tone: string }> = {
  processing: { label: 'Awaiting payment', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' },
  confirmed: { label: 'Confirmed', tone: 'bg-blue-100 text-blue-800' },
  paid: { label: 'Paid · preparing', tone: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200' },
  dispatched: { label: 'Dispatched', tone: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200' },
  delivered: { label: 'Delivered', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

function addBusinessDays(from: Date, days: number) {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added += 1;
  }
  return date;
}

export function LiveNfcOrders() {
  const { currentRole, organization } = useAuth();
  const { plan } = usePlan();
  const planId = plan?.tierId === 'trial' ? 'growth' : plan?.tierId ?? 'free';
  const canOrder = ADMIN_ROLES.includes(currentRole);
  const [isPlatform, setIsPlatform] = useState(false);
  const [terms, setTerms] = useState<OrderingTerms | null>(null);
  const [orders, setOrders] = useState<NfcOrder[] | null>(null);

  const reload = useCallback(() => {
    listOrders(organization.id).then(setOrders).catch((error) => { toast.error(errorText(error, 'Could not load orders')); setOrders([]); });
  }, [organization.id]);

  useEffect(() => {
    getOrderingTerms(planId).then(setTerms).catch((error) => toast.error(errorText(error, 'Could not load card pricing')));
    reload();
    amIPlatformAdmin().then(setIsPlatform).catch(() => setIsPlatform(false));
  }, [planId, reload]);

  // Back from Paystack: /nfc-cards?reference=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') ?? params.get('trxref');
    if (!reference) return;
    window.history.replaceState({}, '', window.location.pathname);
    verifyOrderPayment(reference)
      .then((result) => {
        if (result.outcome === 'paid' || result.outcome === 'already_applied') toast.success('Payment received', { description: 'Your VitaCards are being prepared for dispatch.' });
        else toast.error('Payment was not completed', { description: 'You can try again from your order history.' });
        reload();
      })
      .catch((error) => toast.error(errorText(error, 'Could not confirm the payment')));
  }, [reload]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 page-transition">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Order NFC VitaCards</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">NFC-enabled VitaCards for patient identity, emergency profiles and linked VitaLink records.</p>
        </div>
        {isPlatform && (
          <Button variant="outline" size="sm" onClick={() => window.open('/console/orders', '_blank', 'noopener')}>
            Fulfil orders in the VitaLink Console
          </Button>
        )}
      </div>

      {(
        <>
          {terms ? (
            canOrder ? <OrderForm terms={terms} organizationName={organization.name} onPlaced={reload} />
              : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900">Only workspace admins can order VitaCards. You can follow existing orders below.</p>
          ) : <p className="text-sm text-slate-500">Loading pricing...</p>}
          <OrderHistory orders={orders} terms={terms} canOrder={canOrder} onChanged={reload} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OrderForm({ terms, organizationName, onPlaced }: { terms: OrderingTerms; organizationName: string; onPlaced: () => void }) {
  const { userName, organization } = useAuth();
  const pack = terms.minPack;
  const [quantity, setQuantity] = useState(pack);
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>('delivery');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState(userName);
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<NfcPaymentMethod>('paystack');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [placed, setPlaced] = useState<NfcOrder | null>(null);

  const pickupAvailable = Boolean(terms.pickupAddress);
  const option = pickupAvailable ? deliveryOption : 'delivery';
  const deliveryFee = option === 'delivery' ? terms.deliveryFee : 0;
  const subtotal = quantity * terms.cardPrice;
  const total = subtotal + deliveryFee;
  const packOptions = [1, 2, 5, 10].map((multiplier) => pack * multiplier);
  const normalize = (value: number) => Math.max(pack, Math.round(value / pack) * pack);
  const dispatchBy = useMemo(() => addBusinessDays(new Date(), terms.dispatchDays).toLocaleDateString('en-NG', { day: 'numeric', month: 'long' }), [terms.dispatchDays]);
  const valid = (option === 'pickup' || address.trim().length > 5) && contactPhone.trim().length >= 7 && (paymentMethod === 'paystack' || terms.bank);

  const submit = async () => {
    setSaving(true);
    try {
      const order = await placeOrder(organization.id, {
        quantity, deliveryOption: option, deliveryAddress: address, contactName, contactPhone, paymentMethod, notes,
      });
      setConfirming(false);
      onPlaced();
      if (paymentMethod === 'paystack') {
        try {
          const { authorizationUrl } = await startOrderPayment(order.id);
          window.location.assign(authorizationUrl);
          return;
        } catch (error) {
          toast.error(errorText(error, 'Card payment could not start'), { description: 'Your order is saved: pay later from the order history, or switch it to bank transfer.' });
        }
      }
      setPlaced(order);
    } catch (error) {
      toast.error(errorText(error, 'Could not place the order'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Card quantity</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Cards come in packs of {pack} at {naira(terms.cardPrice)} each on your plan.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {packOptions.map((value) => (
              <button key={value} type="button" onClick={() => setQuantity(value)}
                className={cn('rounded-lg border p-3 text-center text-sm font-semibold transition-colors', quantity === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'border-slate-200 text-slate-700 hover:border-indigo-300 dark:border-slate-700 dark:text-slate-200')}>
                {value} cards<span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">{naira(value * terms.cardPrice)}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600 dark:text-slate-400">Custom quantity</span>
            <button type="button" aria-label="Fewer cards" onClick={() => setQuantity(normalize(quantity - pack))} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"><Minus className="h-4 w-4" /></button>
            <input type="number" value={quantity} min={pack} step={pack} onChange={(e) => setQuantity(normalize(Number(e.target.value) || 0))}
              className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50" />
            <button type="button" aria-label="More cards" onClick={() => setQuantity(quantity + pack)} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"><Plus className="h-4 w-4" /></button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Delivery</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { id: 'delivery' as const, label: 'Doorstep delivery', description: 'Delivered to your facility', fee: terms.deliveryFee ? `+${naira(terms.deliveryFee)}` : 'Free', disabled: false },
              { id: 'pickup' as const, label: 'Pick up', description: pickupAvailable ? terms.pickupAddress : 'Not offered at the moment', fee: 'Free', disabled: !pickupAvailable },
            ].map((item) => (
              <button key={item.id} type="button" disabled={item.disabled} onClick={() => setDeliveryOption(item.id)}
                className={cn('rounded-lg border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50', option === item.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 dark:border-slate-700')}>
                <div className="flex justify-between"><span className="font-semibold text-slate-900 dark:text-slate-50">{item.label}</span><span className="text-sm text-indigo-600 dark:text-indigo-300">{item.fee}</span></div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{item.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {option === 'delivery' && (
              <label className="sm:col-span-2 block text-sm text-slate-700 dark:text-slate-200">Delivery address
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`Full address of ${organizationName}`} className="mt-1.5" />
              </label>
            )}
            <label className="block text-sm text-slate-700 dark:text-slate-200">Contact person<Input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1.5" /></label>
            <label className="block text-sm text-slate-700 dark:text-slate-200">Contact phone<Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="For the courier" className="mt-1.5" /></label>
            <label className="sm:col-span-2 block text-sm text-slate-700 dark:text-slate-200">Notes (optional)<Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. deliver to the records office" className="mt-1.5" /></label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">What is on each card</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{cardDetails.map((detail) => <div key={detail} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300"><CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />{detail}</div>)}</div>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-indigo-600 dark:text-indigo-300" /><h2 className="font-semibold text-slate-900 dark:text-slate-50">Order summary</h2></div>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4 text-slate-600 dark:text-slate-400"><dt>{quantity} cards × {naira(terms.cardPrice)}</dt><dd>{naira(subtotal)}</dd></div>
          {deliveryFee > 0 && <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Delivery</dt><dd>{naira(deliveryFee)}</dd></div>}
          <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-50"><dt>Total</dt><dd>{naira(total)}</dd></div>
        </dl>
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Pay with</p>
          {[
            { id: 'paystack' as const, label: 'Card / bank app (Paystack)', icon: CreditCard, disabled: false, note: 'Pay now; the order is confirmed instantly.' },
            { id: 'bank_transfer' as const, label: 'Bank transfer', icon: Banknote, disabled: !terms.bank, note: terms.bank ? 'Transfer, then VitaLink confirms the payment.' : 'Not available yet.' },
          ].map((item) => (
            <button key={item.id} type="button" disabled={item.disabled} onClick={() => setPaymentMethod(item.id)}
              className={cn('w-full rounded-lg border p-3 text-left disabled:opacity-50', paymentMethod === item.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 dark:border-slate-700')}>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-50"><item.icon className="h-4 w-4" />{item.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{item.note}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Cards dispatch within {terms.dispatchDays} business day{terms.dispatchDays === 1 ? '' : 's'} of payment (by {dispatchBy} if paid today).</p>
        <button type="button" disabled={!valid} onClick={() => setConfirming(true)}
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
          Place order
        </button>
        {!valid && <p className="text-[11px] text-slate-500">Add {option === 'delivery' && address.trim().length <= 5 ? 'the delivery address and ' : ''}a contact phone to continue.</p>}
      </aside>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Confirm order</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {quantity} NFC VitaCards for {naira(total)}, {option === 'delivery' ? 'delivered' : 'for pickup'}.
              {paymentMethod === 'paystack' ? ' You will be taken to Paystack to pay.' : ' You will see the bank details next.'}
            </p>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">Back</button>
              <button type="button" disabled={saving} onClick={() => void submit()} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Placing...' : 'Confirm order'}</button>
            </div>
          </div>
        </div>
      )}
      {placed && <BankTransferDialog order={placed} terms={terms} onClose={() => setPlaced(null)} />}
    </div>
  );
}

function BankTransferDialog({ order, terms, onClose }: { order: NfcOrder; terms: OrderingTerms; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="status" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h2 className="mt-3 text-center text-lg font-bold text-slate-900 dark:text-slate-50">Order {order.number} placed</h2>
        {order.paymentMethod === 'bank_transfer' && terms.bank ? (
          <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <p>Transfer <b>{naira(order.total)}</b> to:</p>
            <p>{terms.bank.name} · {terms.bank.accountNumber}</p>
            <p>{terms.bank.accountName}</p>
            <p className="pt-1 text-xs text-slate-500">Use <b>{order.number}</b> as the transfer reference. VitaLink marks the order paid once the money arrives{terms.supportEmail ? `; send the receipt to ${terms.supportEmail} to speed this up` : ''}.</p>
          </div>
        ) : (
          <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">It is saved as awaiting payment. Pay from your order history when you're ready.</p>
        )}
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white">Done</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OrderHistory({ orders, terms, canOrder, onChanged }: { orders: NfcOrder[] | null; terms: OrderingTerms | null; canOrder: boolean; onChanged: () => void }) {
  const [bankFor, setBankFor] = useState<NfcOrder | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!orders) return <p className="text-sm text-slate-500">Loading orders...</p>;
  if (orders.length === 0) return null;

  const pay = async (order: NfcOrder) => {
    setBusy(order.id);
    try {
      if (order.paymentMethod !== 'paystack') await setOrderPaymentMethod(order.id, 'paystack');
      const { authorizationUrl } = await startOrderPayment(order.id);
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(errorText(error, 'Card payment could not start'));
      setBusy(null);
    }
  };
  const payByTransfer = async (order: NfcOrder) => {
    try {
      if (order.paymentMethod !== 'bank_transfer') await setOrderPaymentMethod(order.id, 'bank_transfer');
      setBankFor({ ...order, paymentMethod: 'bank_transfer' });
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not switch to bank transfer'));
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-lg font-bold text-slate-900 dark:text-slate-50">Order history</h2>
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">
                  {order.number} <span className={cn('ml-2 rounded-full px-2 py-0.5 text-xs', STATUS[order.status].tone)}>{STATUS[order.status].label}</span>
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {order.quantity} cards · {naira(order.total)} · ordered {new Date(order.orderedAt).toLocaleDateString('en-NG')} · {order.deliveryOption === 'delivery' ? `to ${order.deliveryAddress}` : 'pickup'}
                </p>
                {order.status === 'dispatched' && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300">
                    <Truck className="h-3.5 w-3.5" />{order.courier || 'Courier'}{order.trackingNumber ? ` · tracking ${order.trackingNumber}` : ''}{order.estimatedDelivery ? ` · arriving ${new Date(order.estimatedDelivery).toLocaleDateString('en-NG')}` : ''}
                  </p>
                )}
                {order.status === 'delivered' && order.deliveredAt && <p className="mt-1 text-xs text-emerald-700">Delivered {new Date(order.deliveredAt).toLocaleDateString('en-NG')}</p>}
                {order.status === 'paid' && terms && <p className="mt-1 text-xs text-slate-500">Paid {order.paidAt ? new Date(order.paidAt).toLocaleDateString('en-NG') : ''}; dispatch within {terms.dispatchDays} business days.</p>}
              </div>
              {canOrder && order.status === 'processing' && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy === order.id} onClick={() => void pay(order)}><CreditCard className="mr-1 h-3.5 w-3.5" />{busy === order.id ? 'Opening...' : 'Pay by card'}</Button>
                  {terms?.bank && <Button size="sm" variant="outline" onClick={() => void payByTransfer(order)}><Banknote className="mr-1 h-3.5 w-3.5" />Bank transfer</Button>}
                  <Button size="sm" variant="ghost" onClick={() => void cancelOrder(order.id).then(() => { toast.success('Order cancelled'); onChanged(); }).catch((error) => toast.error(errorText(error, 'Could not cancel')))}><X className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {bankFor && terms && <BankTransferDialog order={bankFor} terms={terms} onClose={() => setBankFor(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function FulfilmentPanel({ onChanged }: { onChanged: () => void }) {
  const [orders, setOrders] = useState<PlatformOrder[] | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dispatching, setDispatching] = useState<PlatformOrder | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [eta, setEta] = useState('');

  const reload = useCallback(() => {
    listPlatformOrders().then(setOrders).catch((error) => { toast.error(errorText(error, 'Could not load the fulfilment queue')); setOrders([]); });
  }, []);
  useEffect(() => {
    reload();
    getPlatformSettings().then(setSettings).catch(() => undefined);
  }, [reload]);

  const act = async (order: PlatformOrder, patch: Parameters<typeof updatePlatformOrder>[1], message: string) => {
    try {
      await updatePlatformOrder(order.id, patch);
      toast.success(message);
      reload();
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not update the order'));
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await savePlatformSettings(settings);
      toast.success('Ordering settings saved');
      setShowSettings(false);
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not save settings'));
    }
  };

  const open = orders?.filter((order) => ['processing', 'paid', 'dispatched'].includes(order.status)) ?? [];
  const closed = orders?.filter((order) => !['processing', 'paid', 'dispatched'].includes(order.status)) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">VitaCard orders from every workspace. Confirm bank transfers, then dispatch and deliver.</p>
        <Button size="sm" variant="outline" onClick={() => setShowSettings((value) => !value)}><Settings2 className="mr-1 h-4 w-4" />Ordering settings</Button>
      </div>

      {showSettings && settings && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900">
          <label className="text-sm">Delivery fee (₦)<Input type="number" min={0} value={settings.deliveryFee} onChange={(e) => setSettings({ ...settings, deliveryFee: Number(e.target.value) || 0 })} className="mt-1" /></label>
          <label className="text-sm">Dispatch within (business days)<Input type="number" min={0} max={60} value={settings.dispatchDays} onChange={(e) => setSettings({ ...settings, dispatchDays: Number(e.target.value) || 0 })} className="mt-1" /></label>
          <label className="text-sm sm:col-span-2">Pickup address (leave empty to offer delivery only)<Input value={settings.pickupAddress} onChange={(e) => setSettings({ ...settings, pickupAddress: e.target.value })} className="mt-1" /></label>
          <label className="text-sm">Bank<Input value={settings.bankName} onChange={(e) => setSettings({ ...settings, bankName: e.target.value })} className="mt-1" /></label>
          <label className="text-sm">Account number<Input value={settings.bankAccountNumber} onChange={(e) => setSettings({ ...settings, bankAccountNumber: e.target.value })} className="mt-1" /></label>
          <label className="text-sm">Account name<Input value={settings.bankAccountName} onChange={(e) => setSettings({ ...settings, bankAccountName: e.target.value })} className="mt-1" /></label>
          <label className="text-sm">Support email (for receipts)<Input value={settings.supportEmail} onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })} className="mt-1" /></label>
          <p className="text-xs text-slate-500 sm:col-span-2">Bank transfer is offered to workspaces only when bank, account number and account name are all filled. Card price and pack size are set per plan.</p>
          <div className="sm:col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowSettings(false)}>Close</Button><Button onClick={() => void saveSettings()}>Save settings</Button></div>
        </div>
      )}

      {orders === null && <p className="text-sm text-slate-500">Loading...</p>}
      {orders?.length === 0 && <p className="text-sm text-slate-500">No VitaCard orders yet.</p>}
      {[...open, ...closed].map((order) => (
        <div key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-slate-50">
                {order.number} · {order.organizationName}
                <span className={cn('ml-2 rounded-full px-2 py-0.5 text-xs', STATUS[order.status].tone)}>{STATUS[order.status].label}</span>
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {order.quantity} cards · {naira(order.total)} · {order.paymentMethod === 'paystack' ? 'Paystack' : 'bank transfer'} · ordered {new Date(order.orderedAt).toLocaleString('en-NG')}
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                <Package className="mr-1 inline h-3.5 w-3.5" />
                {order.deliveryOption === 'delivery' ? order.deliveryAddress : 'Pickup'} · {order.contactName || '—'} {order.contactPhone} · {order.orderedByEmail}
              </p>
              {order.notes && <p className="mt-1 text-xs text-slate-500">Note: {order.notes}</p>}
              {order.status === 'dispatched' && <p className="mt-1 text-xs text-indigo-700">{order.courier} {order.trackingNumber}{order.estimatedDelivery ? ` · ETA ${order.estimatedDelivery}` : ''}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {order.status === 'processing' && <Button size="sm" onClick={() => void act(order, { status: 'paid' }, `${order.number} marked paid`)}>Mark paid</Button>}
              {order.status === 'paid' && <Button size="sm" onClick={() => { setDispatching(order); setCourier(''); setTracking(''); setEta(''); }}><Truck className="mr-1 h-3.5 w-3.5" />Dispatch</Button>}
              {order.status === 'dispatched' && <Button size="sm" onClick={() => void act(order, { status: 'delivered' }, `${order.number} delivered`)}>Mark delivered</Button>}
              {['processing', 'paid'].includes(order.status) && <Button size="sm" variant="ghost" onClick={() => void act(order, { status: 'cancelled' }, `${order.number} cancelled`)}>Cancel</Button>}
            </div>
          </div>
          {dispatching?.id === order.id && (
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <Input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier" />
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" />
              <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!courier.trim()} onClick={() => void act(order, { status: 'dispatched', courier, trackingNumber: tracking, estimatedDelivery: eta || null }, `${order.number} dispatched`).then(() => setDispatching(null))}>Confirm</Button>
                <Button size="sm" variant="ghost" onClick={() => setDispatching(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
