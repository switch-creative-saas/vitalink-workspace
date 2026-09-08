import { useMemo, useState } from 'react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { diseaseLibrary, type DiseaseGroup } from '@/data/mockSentinelData';

export function DiseasesPage() {
  const [category, setCategory] = useState<'All' | DiseaseGroup>('All');
  const [query, setQuery] = useState('');
  const diseases = useMemo(() => diseaseLibrary.filter((disease) => (category === 'All' || disease.group === category) && disease.name.toLowerCase().includes(query.toLowerCase())), [category, query]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Disease Intelligence</h2><p className="text-sm text-slate-500 dark:text-slate-400">Clinical features, reporting triggers, and Nigeria status.</p></div><input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Search diseases" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="flex flex-wrap gap-2">{(['All', 'Communicable', 'NTD', 'Vector-borne', 'Respiratory', 'Waterborne'] as const).map((item) => <Button key={item} className={category === item ? '' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'} onClick={() => setCategory(item)}>{item}</Button>)}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {diseases.map((disease) => (
          <Card key={disease.name}>
            <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-bold text-slate-950 dark:text-slate-50">{disease.name}</h3><Badge tone={disease.risk as 'critical' | 'high' | 'moderate' | 'low'}>{disease.group}</Badge></div>
            <p className="mt-3 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{disease.description}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400"><span>Cases <strong className="block text-slate-950 dark:text-slate-50">{disease.cases}</strong></span><span>Outbreaks <strong className="block text-slate-950 dark:text-slate-50">{disease.outbreaks}</strong></span><span>CFR <strong className="block text-slate-950 dark:text-slate-50">{disease.cfr}</strong></span></div>
            <Button className="mt-4">View Intelligence</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

