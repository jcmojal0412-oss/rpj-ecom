'use client';

import { Clock, ShoppingBag, Music2, LineChart } from 'lucide-react';

const ICONS = { shopee: ShoppingBag, tiktok: Music2, trends: LineChart } as const;

export default function ComingSoon({
  title, subtitle, icon, fields, buttonLabel,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof ICONS;
  fields: string[];
  buttonLabel: string;
}) {
  const Icon = ICONS[icon];
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-xl">
          <Icon className="text-orange-500" size={22} />
        </div>
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <span className="badge-amber ml-2">Coming Soon</span>
        </div>
      </div>

      <div className="card opacity-60 pointer-events-none select-none space-y-4 max-w-xl">
        {fields.map(f => (
          <div key={f}>
            <label className="form-label">{f}</label>
            <input className="form-input" disabled placeholder={f} />
          </div>
        ))}
        <button className="btn-primary justify-center w-full" disabled>{buttonLabel}</button>
      </div>

      <div className="card bg-blue-50 border-blue-100 flex items-center gap-3 max-w-xl">
        <Clock className="text-blue-500 shrink-0" size={20} />
        <p className="text-sm text-blue-700">Feature under development. This module will go live in a future phase.</p>
      </div>
    </div>
  );
}
