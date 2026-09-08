import { useState } from 'react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { Modal } from '@/components/ui/Modal';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { mockAlerts, diseaseLibrary } from '@/data/mockSentinelData';

export function AlertsPage() {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const visible = mockAlerts.filter((alert) => filter === 'all' || (filter === 'unacknowledged' ? !alert.acknowledged : alert.severity === filter));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Alert Management</h2><p className="text-sm text-slate-500 dark:text-slate-400">{mockAlerts.filter((a) => !a.acknowledged).length} unacknowledged alerts.</p></div><Button onClick={() => setOpen(true)}>Create Alert</Button></div>
      <div className="flex flex-wrap gap-2">{['all', 'critical', 'high', 'moderate', 'unacknowledged'].map((item) => <Button key={item} className={filter === item ? '' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'} onClick={() => setFilter(item)}>{item}</Button>)}</div>
      <div className="space-y-3">{visible.map((alert) => <Card key={alert.id} className="border-l-4 border-l-red-500"><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge tone={alert.severity}>{alert.severity}</Badge><h3 className="mt-2 font-bold text-slate-950 dark:text-slate-50">{alert.title}</h3><p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{alert.message}</p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{alert.disease} · {alert.state}</p></div><div className="flex gap-2"><Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{alert.acknowledged ? 'Acknowledged' : 'Acknowledge'}</Button><Button>Create Response</Button></div></div></Card>)}</div>
      <Modal title="Create Alert" open={open} onClose={() => setOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2"><Select><option>Outbreak threshold</option><option>Mortality spike</option></Select><Select><option>Critical</option><option>High</option><option>Moderate</option></Select><Select>{diseaseLibrary.map((disease) => <option key={disease.name}>{disease.name}</option>)}</Select><input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="State" /><input className="sentinel-input md:col-span-2 rounded-xl px-3 py-2 text-sm" placeholder="Title" /><textarea className="sentinel-input md:col-span-2 min-h-28 rounded-xl p-3 text-sm" placeholder="Message" /><Button className="md:col-span-2" onClick={() => setOpen(false)}>Send Alert</Button></div>
      </Modal>
    </div>
  );
}

