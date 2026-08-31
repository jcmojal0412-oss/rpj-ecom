'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Receipt } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function PayslipsClient() {
  const router = useRouter();
  const [payslips, setPayslips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/payslips').then(r => r.json()).then(d => { setPayslips(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payslips</h1>
        <p className="text-sm text-gray-500 mt-1">View and print payslips.</p>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : payslips.length === 0 ? (
          <div className="text-center py-16">
            <Receipt className="mx-auto text-gray-300 mb-3" size={32} />
            <p className="text-sm text-gray-400">No payslips available yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Period</th>
                  <th className="table-header">Pay Date</th>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Net Pay</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payslips.map((p: any) => (
                  <tr key={p.id} onClick={() => router.push(`/payslips/${p.id}`)} className="hover:bg-gray-50/60 cursor-pointer">
                    <td className="table-cell">{p.period_label}</td>
                    <td className="table-cell text-gray-500">{formatDate(p.pay_date || p.to_date)}</td>
                    <td className="table-cell font-medium text-gray-900">{p.employee_name_snapshot}</td>
                    <td className="table-cell font-semibold">{formatCurrency(p.net_pay)}</td>
                    <td className="table-cell text-orange-600 text-xs font-medium">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
