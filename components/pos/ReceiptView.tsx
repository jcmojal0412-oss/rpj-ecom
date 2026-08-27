'use client';

import { formatCurrency, formatDate } from '@/lib/utils';
import type { Sale, SaleItem } from './constants';

interface Props {
  sale: Sale;
  items: SaleItem[];
  children?: React.ReactNode;
}

export default function ReceiptView({ sale, items, children }: Props) {
  return (
    <div className="max-w-sm mx-auto">
      <div id="pos-receipt" className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center">
          <p className="font-bold text-gray-900">{sale.business_name || 'RPJ ECOM'}</p>
          <p className="text-xs text-gray-400 mt-0.5">Sale #{String(sale.id).padStart(6, '0')}</p>
          <p className="text-xs text-gray-400">{formatDate(sale.created_at)}</p>
          <p className="text-xs text-gray-400">Cashier: {sale.cashier_name || '—'}</p>
          {sale.status === 'Voided' && (
            <span className="inline-block mt-2 text-[11px] font-bold uppercase tracking-wide bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Voided</span>
          )}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
          {items.map(it => (
            <div key={it.id} className="flex justify-between text-sm">
              <span className="text-gray-700">{it.product_name} <span className="text-gray-400">x{it.quantity}</span></span>
              <span className="font-medium text-gray-900 tabular-nums">{formatCurrency(it.line_total)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(sale.subtotal)}</span></div>
          {sale.discount > 0 && <div className="flex justify-between text-gray-500"><span>Discount</span><span className="tabular-nums">-{formatCurrency(sale.discount)}</span></div>}
          {sale.additional_fee > 0 && <div className="flex justify-between text-gray-500"><span>Additional Fee</span><span className="tabular-nums">{formatCurrency(sale.additional_fee)}</span></div>}
          <div className="flex justify-between text-base font-bold text-gray-900 pt-1"><span>Total</span><span className="tabular-nums">{formatCurrency(sale.total)}</span></div>
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          {sale.cash_amount > 0 && <div className="flex justify-between text-gray-500"><span>Cash</span><span className="tabular-nums">{formatCurrency(sale.cash_amount)}</span></div>}
          {sale.online_amount > 0 && <div className="flex justify-between text-gray-500"><span>Online</span><span className="tabular-nums">{formatCurrency(sale.online_amount)}</span></div>}
          <div className="flex justify-between font-semibold text-gray-900"><span>Change</span><span className="tabular-nums">{formatCurrency(sale.change_due)}</span></div>
        </div>

        {sale.notes && <p className="text-xs text-gray-400 border-t border-dashed border-gray-200 pt-3">{sale.notes}</p>}
      </div>

      {children && <div className="mt-4 flex justify-center gap-3 print:hidden">{children}</div>}
    </div>
  );
}
