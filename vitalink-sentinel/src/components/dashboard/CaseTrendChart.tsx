import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mockWeeklyTrend } from '@/data/mockSentinelData';

const MOCK_SERIES = [
  { key: 'cholera', color: '#06B6D4' }, { key: 'malaria', color: '#22C55E' }, { key: 'tb', color: '#3B82F6' },
  { key: 'lassaFever', color: '#EF4444' }, { key: 'diphtheria', color: '#F59E0B' },
];

/** Without props it shows the demo trend; live callers pass their own rows and one series per disease. */
export function CaseTrendChart({ data = mockWeeklyTrend, series = MOCK_SERIES, xKey = 'week' }: {
  data?: Array<Record<string, number | string>>; series?: Array<{ key: string; color: string }>; xKey?: string;
} = {}) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#E8EAF0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis allowDecimals={false} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={12} width={42} />
          <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8EAF0', borderRadius: 12, color: '#0F172A', boxShadow: '0 12px 32px rgba(15,23,42,.08)' }} />
          <Legend />
          {series.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={2} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
