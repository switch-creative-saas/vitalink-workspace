import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mockWeeklyTrend } from '@/data/mockSentinelData';

export function CaseTrendChart() {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={mockWeeklyTrend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#E8EAF0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={12} width={42} />
          <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8EAF0', borderRadius: 12, color: '#0F172A', boxShadow: '0 12px 32px rgba(15,23,42,.08)' }} />
          <Legend />
          <Line type="monotone" dataKey="cholera" stroke="#06B6D4" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="malaria" stroke="#22C55E" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="tb" stroke="#3B82F6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="lassaFever" stroke="#EF4444" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="diphtheria" stroke="#F59E0B" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
