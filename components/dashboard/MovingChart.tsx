'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  title: string;
  data: { sku: string; name: string; total_out: number }[];
  color: string;
}

export default function MovingChart({ title, data, color }: Props) {
  const chartData = data.map(d => ({
    label: d.name.length > 14 ? d.name.slice(0, 14) + '…' : d.name,
    fullName: d.name,
    sku: d.sku,
    value: d.total_out,
  }));

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">{title}</h2>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data available</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
            <Tooltip
              formatter={(val: number) => [`${val} units`, 'Stock Out']}
              labelFormatter={(label: string) => {
                const item = chartData.find(d => d.label === label);
                return item ? `${item.fullName} (${item.sku})` : label;
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
