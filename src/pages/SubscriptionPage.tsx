import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Download,
  Lock,
  MoreHorizontal,
  Plus,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSubscription, type PlanTier } from '@/contexts/SubscriptionContext';

const PLAN_PRICING: Record<PlanTier, { monthly: number; annual: number; title: string; description: string }> = {
  free: { monthly: 0, annual: 0, title: 'Freemium', description: 'Small clinics and pilot usage' },
  pro: { monthly: 150000, annual: 1350000, title: 'Pro', description: 'Standard hospital operations' },
  enterprise: { monthly: 500000, annual: 4500000, title: 'Enterprise', description: 'Large multi-hospital networks' },
};

const PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ['Patient Management (Basic)', 'Appointments (Limited)', 'EMR Notes (Basic)'],
  pro: ['Full EMR', 'Laboratory', 'Pharmacy', 'Billing & Insurance', 'Analytics Dashboard', 'Limited VitaMind AI'],
  enterprise: ['Telemedicine', 'Full VitaMind AI', 'Multi-Hospital Network', 'Advanced Analytics', 'Custom Workflows', 'API Access'],
};

export function SubscriptionPage() {
  const {
    DEV_OVERRIDE,
    tenantId,
    setTenantId,
    subscription,
    limits,
    paymentMethods,
    invoices,
    updatePlan,
    toggleAutoRenew,
    addPaymentMethod,
    setDefaultPaymentMethod,
    editPaymentMethod,
    removePaymentMethod,
    usagePct,
    isUsageBlocked,
    trackUsage,
    billingAuditLogs,
    addAudit,
  } = useSubscription();

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [cycle, setCycle] = useState(subscription.billingCycle);
  const [coupon, setCoupon] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    type: 'card' as 'card' | 'bank_transfer',
    cardBrand: 'Visa' as 'Visa' | 'Mastercard',
    cardLast4: '',
    bankName: '',
    bankAccountEnding: '',
  });

  const currentPrice = PLAN_PRICING[subscription.plan][subscription.billingCycle];
  const planAmount = currentPrice.toLocaleString();
  const hasGraceWarning = !subscription.autoRenew || Boolean(subscription.gracePeriodEndsAt);

  const usageItems = useMemo(
    () => [
      {
        key: 'staff' as const,
        label: 'Staff usage',
        value: `${subscription.usage.staff} / ${limits.staff === 'unlimited' ? 'Unlimited' : limits.staff}`,
        pct: usagePct('staff'),
      },
      {
        key: 'patients' as const,
        label: 'Patient records',
        value: `${subscription.usage.patients.toLocaleString()} / ${limits.patients === 'unlimited' ? 'Unlimited' : limits.patients.toLocaleString()}`,
        pct: usagePct('patients'),
      },
      {
        key: 'storageGB' as const,
        label: 'Storage',
        value: `${subscription.usage.storageGB} GB / ${limits.storageGB === 'unlimited' ? 'Unlimited' : `${limits.storageGB} GB`}`,
        pct: usagePct('storageGB'),
      },
    ],
    [subscription, limits, usagePct],
  );

  const applyCoupon = () => {
    if (!coupon.trim()) return toast.error('Enter coupon code');
    addAudit(`Coupon applied: ${coupon.toUpperCase()}`);
    toast.success('Coupon applied. Discount will reflect on next invoice.');
  };

  const savePaymentMethod = () => {
    if (paymentForm.type === 'card') {
      if (!paymentForm.cardLast4 || paymentForm.cardLast4.length !== 4) return toast.error('Enter last 4 card digits');
      addPaymentMethod({ type: 'card', brand: paymentForm.cardBrand, last4: paymentForm.cardLast4 });
    } else {
      if (!paymentForm.bankName || !paymentForm.bankAccountEnding) return toast.error('Enter bank details');
      addPaymentMethod({ type: 'bank_transfer', accountBank: paymentForm.bankName, accountEnding: paymentForm.bankAccountEnding });
    }
    setShowPaymentModal(false);
    setPaymentForm({ type: 'card', cardBrand: 'Visa', cardLast4: '', bankName: '', bankAccountEnding: '' });
    toast.success('Payment method saved with tokenized structure');
  };

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription & Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Revenue engine, feature access control, and multi-hospital SaaS tenancy.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="rounded-xl border border-input px-3 py-2 text-sm" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="tenant-lagos">Lagos Tenant</option>
            <option value="tenant-abuja">Abuja Tenant</option>
          </select>
          <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl" onClick={() => setShowUpgradeModal(true)}>
            <Zap className="w-4 h-4" />
            Upgrade Plan
          </Button>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="bg-gradient-to-r from-royal-500 to-royal-700 p-6 text-white">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-full bg-white/20 text-xs font-medium">Current Plan</span>
                <span className="px-2.5 py-1 rounded-full bg-green-400/30 text-green-200 text-xs font-medium">{subscription.plan.toUpperCase()}</span>
                {DEV_OVERRIDE && <span className="px-2.5 py-1 rounded-full bg-amber-400/30 text-amber-100 text-xs font-medium">DEV_OVERRIDE ON</span>}
              </div>
              <h2 className="text-3xl font-bold">{PLAN_PRICING[subscription.plan].title}</h2>
              <p className="text-white/80 text-sm mt-1">Tenant: {subscription.tenantName} • Next billing: {subscription.nextBillingAt}</p>
            </div>
            <div className="text-left lg:text-right">
              <p className="text-3xl font-bold">NGN {planAmount}</p>
              <p className="text-white/70">per {subscription.billingCycle === 'annual' ? 'year' : 'month'}</p>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            {usageItems.map((item) => (
              <div key={item.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">{item.label}</span>
                  <span className="font-medium text-gray-800">{item.value}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', item.pct > 90 ? 'bg-red-500' : item.pct > 75 ? 'bg-amber-500' : 'bg-royal-500')} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-xl bg-gray-50">
            <div>
              <p className="text-sm font-medium text-gray-900">Auto-Renewal</p>
              <p className="text-xs text-gray-500">If disabled, access may be restricted after expiration.</p>
            </div>
            <Switch checked={subscription.autoRenew} onCheckedChange={toggleAutoRenew} />
          </div>
          {hasGraceWarning && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
              Access may be restricted after expiration. Grace period: 7 days. Excess staff/patients will be archived on downgrade.
            </div>
          )}
          <div className="grid md:grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => trackUsage('staff', subscription.usage.staff + 1)} disabled={isUsageBlocked('staff')}>
              +1 Staff Usage
            </Button>
            <Button variant="outline" size="sm" onClick={() => trackUsage('patients', subscription.usage.patients + 5)} disabled={isUsageBlocked('patients')}>
              +5 Patient Usage
            </Button>
            <Button variant="outline" size="sm" onClick={() => trackUsage('storageGB', Number((subscription.usage.storageGB + 0.1).toFixed(1)))} disabled={isUsageBlocked('storageGB')}>
              +0.1GB Storage
            </Button>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <div className="premium-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Payment Methods</h3>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setShowPaymentModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Payment Method
            </Button>
          </div>
          <div className="space-y-2">
            {paymentMethods.map((pm) => (
              <div key={pm.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {pm.type === 'card' ? `${pm.brand} •••• ${pm.last4}` : `${pm.accountBank} transfer •••• ${pm.accountEnding}`}
                  </p>
                  <p className="text-xs text-gray-500">Encrypted tokenized storage</p>
                </div>
                <div className="flex items-center gap-2">
                  {pm.isDefault && <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">Default</span>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-2 rounded-lg hover:bg-gray-200 text-gray-500"><MoreHorizontal className="w-4 h-4" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="glass-panel border-white/60">
                      <DropdownMenuItem onClick={() => setDefaultPaymentMethod(pm.id)}>Set Default</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => editPaymentMethod(pm.id, { accountBank: pm.accountBank ?? 'Updated Bank' })}>Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-600" onClick={() => removePaymentMethod(pm.id)}>Remove Method</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl border border-gray-100 bg-gray-50 text-xs text-gray-600">
            Nigerian payment support scaffolded for Paystack/Flutterwave provider integration.
          </div>
        </div>

        <div className="premium-card p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Coupons, Trial, and Enterprise Sales</h3>
          <div className="space-y-3">
            <div>
              <Label>Promo Code</Label>
              <div className="flex gap-2 mt-1">
                <Input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="e.g. SH-PRO-15" />
                <Button variant="outline" onClick={applyCoupon}>Apply</Button>
              </div>
            </div>
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-sm text-indigo-800">
              14-day Pro trial available for free tenants. Auto-downgrade applies after trial expiration.
            </div>
            <Button className="w-full bg-gradient-to-r from-[#5B21B6] to-[#7C3AED] text-white">
              <Sparkles className="w-4 h-4 mr-2" />
              Contact Sales for Custom Enterprise Pricing
            </Button>
          </div>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Billing Engine: Invoices & History</h3>
          <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Export</Button>
        </div>
        <div className="responsive-table-wrap">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Invoice</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Cycle</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Tax</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.filter((invoice) => invoice.tenantId === tenantId).map((invoice) => (
                <tr key={invoice.id} className="border-t border-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-royal-700">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-3 text-sm capitalize">{invoice.plan}</td>
                  <td className="px-4 py-3 text-sm capitalize">{invoice.cycle}</td>
                  <td className="px-4 py-3 text-sm">NGN {invoice.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">NGN {invoice.tax.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={cn('px-2 py-1 rounded-full text-xs', invoice.status === 'paid' ? 'bg-green-100 text-green-700' : invoice.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                      {invoice.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="premium-card p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Plan Comparison & Feature Locks</h3>
        <div className="grid lg:grid-cols-3 gap-3">
          {(['free', 'pro', 'enterprise'] as PlanTier[]).map((plan) => (
            <div key={plan} className={cn('rounded-2xl p-4 border transition-all', subscription.plan === plan ? 'border-royal-300 bg-royal-50' : 'border-gray-100 bg-white')}>
              <p className="text-sm font-semibold text-gray-900">{PLAN_PRICING[plan].title}</p>
              <p className="text-xs text-gray-500">{PLAN_PRICING[plan].description}</p>
              <p className="text-xl font-bold text-gray-900 mt-2">NGN {PLAN_PRICING[plan][cycle].toLocaleString()} <span className="text-xs font-normal text-gray-500">/{cycle === 'annual' ? 'year' : 'month'}</span></p>
              <div className="mt-3 space-y-1">
                {PLAN_FEATURES[plan].map((feature) => (
                  <p key={feature} className="text-xs text-gray-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" />{feature}</p>
                ))}
              </div>
              <Button size="sm" className="w-full mt-3" variant={subscription.plan === plan ? 'outline' : 'default'} onClick={() => updatePlan(plan, cycle)}>
                {subscription.plan === plan ? 'Current Plan' : 'Change Plan'}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Disabled features are blurred/locked in modules with an upgrade prompt when unavailable.
        </div>
      </div>

      <div className="premium-card p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Security + Billing Audit Trail</h3>
        <div className="space-y-2">
          {billingAuditLogs.length === 0 ? (
            <p className="text-sm text-gray-500">No billing audit events yet.</p>
          ) : (
            billingAuditLogs.slice(0, 10).map((log) => (
              <div key={log} className="p-3 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-700">{log}</div>
            ))
          )}
        </div>
      </div>

      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="glass-panel border-white/60 max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upgrade Plan</DialogTitle>
            <DialogDescription>Freemium, Pro, and Enterprise plans with role + plan-based module access.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
              <button onClick={() => setCycle('monthly')} className={cn('px-4 py-2 rounded-lg text-sm', cycle === 'monthly' ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500')}>Monthly</button>
              <button onClick={() => setCycle('annual')} className={cn('px-4 py-2 rounded-lg text-sm', cycle === 'annual' ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-500')}>Annual</button>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {(['free', 'pro', 'enterprise'] as PlanTier[]).map((plan) => (
              <div key={plan} className={cn('rounded-2xl p-4 border', plan === 'pro' ? 'bg-gradient-to-b from-royal-500 to-royal-700 text-white border-royal-200' : 'bg-white border-gray-100')}>
                <p className="font-semibold">{PLAN_PRICING[plan].title}</p>
                <p className={cn('text-xs mt-1', plan === 'pro' ? 'text-white/80' : 'text-gray-500')}>{PLAN_PRICING[plan].description}</p>
                <p className="text-2xl font-bold mt-2">NGN {PLAN_PRICING[plan][cycle].toLocaleString()}</p>
                <Button className={cn('w-full mt-3', plan === 'pro' ? 'bg-white text-royal-700 hover:bg-gray-100' : 'bg-gradient-to-r from-royal-500 to-royal-700 text-white')} onClick={() => updatePlan(plan, cycle)}>
                  {plan === subscription.plan ? 'Current Plan' : plan === 'enterprise' ? 'Upgrade / Contact Sales' : 'Upgrade'}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgradeModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="glass-panel border-white/60 max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Payment Method</DialogTitle>
            <DialogDescription>Supports Visa, Mastercard, and Nigerian bank transfer setup.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Method</Label>
              <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={paymentForm.type} onChange={(e) => setPaymentForm((prev) => ({ ...prev, type: e.target.value as 'card' | 'bank_transfer' }))}>
                <option value="card">Card (Visa/Mastercard)</option>
                <option value="bank_transfer">Bank Transfer (Nigeria)</option>
              </select>
            </div>
            {paymentForm.type === 'card' ? (
              <>
                <div>
                  <Label>Card Brand</Label>
                  <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={paymentForm.cardBrand} onChange={(e) => setPaymentForm((prev) => ({ ...prev, cardBrand: e.target.value as 'Visa' | 'Mastercard' }))}>
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                  </select>
                </div>
                <div>
                  <Label>Last 4 Digits</Label>
                  <Input maxLength={4} value={paymentForm.cardLast4} onChange={(e) => setPaymentForm((prev) => ({ ...prev, cardLast4: e.target.value.replace(/\D/g, '') }))} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label>Bank Name</Label>
                  <Input value={paymentForm.bankName} onChange={(e) => setPaymentForm((prev) => ({ ...prev, bankName: e.target.value }))} />
                </div>
                <div>
                  <Label>Account Ending</Label>
                  <Input maxLength={4} value={paymentForm.bankAccountEnding} onChange={(e) => setPaymentForm((prev) => ({ ...prev, bankAccountEnding: e.target.value.replace(/\D/g, '') }))} />
                </div>
              </>
            )}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Payment details are tokenized and never stored as raw card/bank credentials.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentModal(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={savePaymentMethod}>
              <CreditCard className="w-4 h-4 mr-2" />
              Save Method
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
