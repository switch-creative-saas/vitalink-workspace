import { Check } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  recommended?: boolean;
}

const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 'Free',
    period: 'forever',
    features: ['Up to 5 Users', 'Basic EMR', 'Standard Support'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '$299',
    period: '/mo',
    recommended: true,
    features: ['Unlimited Users', 'Full EMR & Billing', 'Priority Support', 'API Access'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'annual',
    features: ['Dedicated Instance', 'Custom Integrations', '24/7 SLA', 'On-Premise Option'],
  }
];

export function EnterpriseSubscription({ onSelect }: { onSelect: (planId: string) => void }) {
  return (
    <div className="flex flex-col md:flex-row gap-3 animate-[auth-form-slide-up_0.5s_ease-out_both] w-full">
      {plans.map((plan) => (
        <div 
          key={plan.id}
          className={`relative flex-1 min-w-0 p-3 rounded-xl border flex flex-col justify-between cursor-pointer transition-all hover:-translate-y-0.5 ${
            plan.recommended 
              ? 'bg-[var(--auth-accent)]/15 border-[var(--auth-accent)]/45 shadow-[0_0_16px_rgba(123,77,255,0.15)]' 
              : 'bg-[var(--auth-input-bg)] border-[var(--auth-border)] hover:border-[var(--auth-accent)]/30'
          }`}
          onClick={() => onSelect(plan.id)}
        >
          {plan.recommended && (
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[var(--auth-accent)] text-white text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
              Recommended
            </div>
          )}
          <div>
            <h3 className="text-xs font-semibold text-[var(--auth-text-primary)]">{plan.name}</h3>
            <div className="mt-0.5 mb-2 flex items-baseline gap-0.5">
              <span className="text-lg font-bold text-[var(--auth-text-primary)]">{plan.price}</span>
              <span className="text-[9px] text-[var(--auth-text-secondary)]">{plan.period}</span>
            </div>
            <ul className="space-y-1 mb-3">
              {plan.features.map((feature, i) => (
                <li key={i} className="text-[10px] text-[var(--auth-text-secondary)] flex items-start gap-1">
                  <Check className="w-3 h-3 text-[var(--auth-accent)] mt-0.5 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            className={`w-full h-8 rounded-full text-xs font-semibold transition-colors mt-auto ${
              plan.recommended 
                ? 'bg-[var(--auth-accent)] hover:bg-[var(--auth-accent-hover)] text-white' 
                : 'bg-[var(--auth-border)] hover:bg-[var(--auth-accent)]/20 text-[var(--auth-text-primary)]'
            }`}
          >
            Select
          </button>
        </div>
      ))}
    </div>
  );
}
