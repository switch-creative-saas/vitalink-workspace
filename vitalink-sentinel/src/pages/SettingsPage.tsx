import { SCard as Card } from '@/components/standalone/SCard';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { useSentinelStore } from '@/store/useSentinelStore';

export function SettingsPage() {
  const { activeOrganization, theme } = useSentinelStore();
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><h2 className="font-bold text-slate-950 dark:text-slate-50">Organization</h2><div className="mt-4 space-y-3 text-sm text-slate-500 dark:text-slate-400"><p><strong className="text-slate-900 dark:text-slate-100">Name:</strong> {activeOrganization?.fullName}</p><p><strong className="text-slate-900 dark:text-slate-100">Scope:</strong> {activeOrganization?.state}</p><p><strong className="text-slate-900 dark:text-slate-100">Type:</strong> {activeOrganization?.type}</p></div></Card>
      <Card><h2 className="font-bold text-slate-950 dark:text-slate-50">Preferences</h2><div className="mt-4 grid gap-3"><Select value={theme} disabled><option value="dark">Dark</option><option value="light">Light</option></Select><Select><option>Notify NCDC + State MoH</option><option>Notify organization only</option></Select></div></Card>
    </div>
  );
}

