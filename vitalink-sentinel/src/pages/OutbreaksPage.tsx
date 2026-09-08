import { useState } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { Modal } from '@/components/ui/Modal';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { mockActiveOutbreaks, diseaseLibrary, mockFacilities } from '@/data/mockSentinelData';

export function OutbreaksPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Active Outbreaks <Badge tone="critical">{mockActiveOutbreaks.length}</Badge></h2><p className="text-sm text-slate-500 dark:text-slate-400">National outbreak intelligence and response status.</p></div>
        <Button onClick={() => setOpen(true)}>Declare New Outbreak</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-5"><Select><option>All states</option></Select><Select><option>All diseases</option></Select><Select><option>All severities</option></Select><Select><option>Active / Monitoring</option></Select><input className="sentinel-input rounded-lg px-3 py-2 text-sm" type="date" /></div>
      <div className="grid gap-4 xl:grid-cols-2">
        {mockActiveOutbreaks.map((outbreak) => (
          <Card key={outbreak.id} className={outbreak.severity === 'critical' ? 'animate-pulse-critical' : ''}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-slate-950 dark:text-slate-50">{outbreak.disease}</h3><p className="text-sm text-slate-500 dark:text-slate-400">{outbreak.state} / {outbreak.lga} · {outbreak.coordinates.lat}, {outbreak.coordinates.lng}</p></div><Badge tone={outbreak.severity}>{outbreak.severity}</Badge></div>
            <div className="mt-4 grid grid-cols-4 gap-3 text-sm text-slate-500 dark:text-slate-400"><span>Confirmed <strong className="block text-slate-950 dark:text-slate-50">{outbreak.casesConfirmed}</strong></span><span>Suspected <strong className="block text-slate-950 dark:text-slate-50">{outbreak.casesSuspected}</strong></span><span>Deaths <strong className="block text-slate-950 dark:text-slate-50">{outbreak.deaths}</strong></span><span>CFR <strong className="block text-slate-950 dark:text-slate-50">{outbreak.cfr}%</strong></span></div>
            <div className="mt-4 h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(differenceInCalendarDays(new Date('2026-07-20'), new Date(outbreak.startDate)) * 2, 100)}%` }} /></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className={outbreak.responseTeamDeployed ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>{outbreak.responseTeamDeployed ? 'Response Team Deployed' : 'No Response Deployed'}</span><div className="flex gap-2"><Button>View Full Report</Button><Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Add Update</Button><Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Resolve</Button></div></div>
          </Card>
        ))}
      </div>
      <Modal title="Declare New Outbreak" open={open} onClose={() => setOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2">
          <Select>{diseaseLibrary.map((disease) => <option key={disease.name}>{disease.name}</option>)}</Select>
          <Select>{mockFacilities.map((facility) => <option key={facility.id}>{facility.state} / {facility.lga}</option>)}</Select>
          <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Initial confirmed count" />
          <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Suspected cases" />
          <input className="sentinel-input rounded-xl px-3 py-2 text-sm" type="date" />
          <Select><option>Critical</option><option>High</option><option>Moderate</option></Select>
          <textarea className="sentinel-input md:col-span-2 min-h-24 rounded-lg p-3 text-sm" placeholder="Description" />
          <Button className="md:col-span-2" onClick={() => setOpen(false)}>Save Outbreak</Button>
        </div>
      </Modal>
    </div>
  );
}

