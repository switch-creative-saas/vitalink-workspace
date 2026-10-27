import { useMemo, useState } from 'react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { mockFacilities } from '@/data/mockSentinelData';

export function FacilitiesPage() {
  const [open, setOpen] = useState(false);
  const linkedFacilities = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('sentinel_linked_facilities') ?? '[]') as Array<{ facilityId: string; linkedAt?: string; dataConsent?: boolean; vitaLinkConnected?: boolean }>; } catch { return []; }
  }, []);
  const linkedById = new Map(linkedFacilities.map((facility) => [facility.facilityId, facility]));
  const active = mockFacilities.filter((facility) => facility.isActive).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Reporting Network</h2><p className="text-sm text-slate-500 dark:text-slate-400">Register direct reporting sites without a hospital EMR dependency.</p></div><Button onClick={() => setOpen(true)}>Add Facility</Button></div>
      <div className="grid gap-4 md:grid-cols-4"><Card><p className="text-sm text-slate-500 dark:text-slate-400">Total registered</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{mockFacilities.length}</p></Card><Card><p className="text-sm text-slate-500 dark:text-slate-400">Active reporters</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{active}</p></Card><Card><p className="text-sm text-slate-500 dark:text-slate-400">Last 7 days</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">142</p></Card><Card><p className="text-sm text-slate-500 dark:text-slate-400">Reporting rate</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">79%</p></Card></div>
      <DataTable headers={['Facility', 'State', 'LGA', 'Type', 'Last Report', 'Frequency', 'Connection', 'Status', 'Actions']}>{mockFacilities.map((facility) => { const linked = linkedById.get(facility.id); return <tr key={facility.id}><td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{facility.name}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{facility.state}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{facility.lga}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{facility.type}</td><td className="px-4 py-3 text-slate-500 dark:text-slate-400">{facility.lastReport}</td><td className="px-4 py-3 text-slate-500 dark:text-slate-400">{facility.reportingFrequency}</td><td className="px-4 py-3">{linked ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">VitaLink connected · Auto-sync</span> : <span className="text-xs text-slate-500 dark:text-slate-400">Direct reporting</span>}</td><td className="px-4 py-3"><Badge tone={facility.isActive ? 'low' : 'moderate'}>{facility.isActive ? 'Active' : 'Inactive'}</Badge></td><td className="px-4 py-3"><Button className="px-3 py-1.5 text-xs">Edit</Button></td></tr>; })}</DataTable>
      <Modal title="Add Reporting Facility" open={open} onClose={() => setOpen(false)}><div className="grid gap-3 md:grid-cols-2"><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="Facility name" /><Select><option>Hospital</option><option>Clinic</option><option>PHC</option><option>Lab</option><option>Community</option></Select><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="State" /><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="LGA" /><input className="sentinel-input md:col-span-2 rounded-lg px-3 py-2 text-sm" placeholder="Address" /><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="Contact officer" /><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="Phone" /><input className="sentinel-input rounded-lg px-3 py-2 text-sm" placeholder="Email" /><Select><option>Daily</option><option>Weekly</option><option>Monthly</option></Select><Button className="md:col-span-2" onClick={() => setOpen(false)}>Register Facility</Button></div></Modal>
    </div>
  );
}

