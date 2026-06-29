'use client';
import GrossSales from '@/components/partners/GrossSales';

export default function GrossSalesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gross Sales per Partner</h1>
        <p className="text-sm text-gray-500 mt-1">Monitor partner sales performance by period</p>
      </div>
      <div className="card">
        <GrossSales />
      </div>
    </div>
  );
}
