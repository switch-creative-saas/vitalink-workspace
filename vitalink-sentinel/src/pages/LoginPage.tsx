import { useState } from 'react';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { useSentinelStore } from '@/store/useSentinelStore';

export function LoginPage() {
  const { organizations, login } = useSentinelStore();
  const [organizationId, setOrganizationId] = useState(organizations[0].id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const disabled = !email.trim() || !password.trim();
  const registerUrl = import.meta.env.VITE_VITALINK_REGISTER_URL ?? 'http://127.0.0.1:5175/register';

  return (
    <main className="grid min-h-screen place-items-center bg-[#F7F8FA] p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <img src="/sentinel-logo.svg" alt="" className="mx-auto h-16 w-16 rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800" />
        <h1 className="mt-5 text-center text-3xl font-bold">VitaLink Sentinel</h1>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">Public Health Intelligence Platform</p>
        <div className="mt-8 space-y-4">
          <Select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="w-full">
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.fullName}</option>)}
          </Select>
          <input className="sentinel-input h-11 w-full rounded-xl px-3 text-sm" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <input className="sentinel-input h-11 w-full rounded-xl px-3 text-sm" type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <Button className="h-11 w-full" disabled={disabled} onClick={() => login(organizationId)}>Sign In</Button>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Registering a new organization?{' '}
          <button className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200" onClick={() => { window.location.href = registerUrl; }}>
            Create Workspace
          </button>
        </p>
        <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">Powered by VitaLink</p>
      </div>
    </main>
  );
}

