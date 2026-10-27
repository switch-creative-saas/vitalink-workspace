import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { diseaseDistribution } from '@/data/mockSentinelData';

export function DiseaseDistributionChart({ data = diseaseDistribution }: { data?: Array<{ name: string; value: number; color: string }> } = {}) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={4}>
            {data.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
          </Pie>
          <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8EAF0', borderRadius: 12, color: '#0F172A', boxShadow: '0 12px 32px rgba(15,23,42,.08)' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
