'use client';

import { formatCurrency } from '@/lib/utils';
import Row from './ReceiptRow';

export interface ReturnedItem {
  name: string;
  quantity: number;
  unitPrice: number;
  condition?: 'Sellable' | 'Defective' | null;
}

interface Props {
  kind: 'refund' | 'exchange';
  businessName: string;
  cashierName: string;
  date: string;
  // pos_refunds.id — the one number this whole slip is built from. A plain
  // return shows it as "RTN-######"; an exchange (same row, since an
  // exchange's return leg IS a pos_refunds row) shows it as "EXC-######".
  // No new counter or column needed.
  refundId: number;
  originalReceiptNo: string;
  returnedItems: ReturnedItem[];
  reason?: string;
  hasFreebiesOnOriginal: boolean;
  freebiesReturned?: 'YES' | 'NO' | null;

  // Refund only
  refundMethod?: string;
  refundAmount?: number;
  refundReference?: string;
  // Names of the original sale's freebie lines, for context next to the
  // Freebies Returned Y/N flag — the system tracks a single transaction-
  // level flag, not per-item return status, so this is a reference list,
  // not a per-item "returned" claim.
  freebieNames?: string[];

  // Exchange only
  newItemName?: string;
  newItemPrice?: number;
  amountPaid?: number;
  paymentMethod?: string;
  refundDifference?: number;
  excessRefundMethod?: string;
}

const conditionLabel = (c?: 'Sellable' | 'Defective' | null) =>
  c === 'Defective' ? 'Defective / For Inspection' : c === 'Sellable' ? 'Sellable' : null;

export default function ReturnExchangeReceipt({
  kind, businessName, cashierName, date, refundId, originalReceiptNo, returnedItems,
  reason, hasFreebiesOnOriginal, freebiesReturned, freebieNames,
  refundMethod, refundAmount, refundReference,
  newItemName, newItemPrice, amountPaid, paymentMethod, refundDifference, excessRefundMethod,
}: Props) {
  const txnNo = kind === 'refund' ? `RTN-${String(refundId).padStart(6, '0')}` : `EXC-${String(refundId).padStart(6, '0')}`;
  const isUpgrade = kind === 'exchange' && (amountPaid ?? 0) > 0;
  const title = kind === 'refund' ? 'REFUND RECEIPT' : isUpgrade ? 'EXCHANGE / UPGRADE RECEIPT' : 'EXCHANGE RECEIPT';
  const status = kind === 'refund' ? 'REFUND COMPLETED' : isUpgrade ? 'UPGRADE COMPLETED' : 'EXCHANGE COMPLETED';
  const returnValueTotal = returnedItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

  return (
    <div className="max-w-sm mx-auto">
      <div id="pos-receipt" className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center">
          <p className="font-bold text-gray-900">{businessName}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mt-1">{title}</p>
          <p className="text-sm font-bold text-gray-800 mt-1.5">
            {kind === 'refund' ? 'Refund No: ' : 'Exchange No: '}{txnNo}
          </p>
          <p className="text-xs text-gray-400 mt-1">Original Receipt: <span className="font-medium text-gray-600">{originalReceiptNo}</span></p>
          <p className="text-xs text-gray-400">{kind === 'refund' ? 'Refund Date: ' : 'Exchange Date: '}{date}</p>
          <p className="text-xs text-gray-400">Cashier: {cashierName}</p>
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">RETURNED ITEM{returnedItems.length > 1 ? 'S' : ''}</p>
          {returnedItems.map((it, i) => (
            <div key={i} className="space-y-1">
              <p className="text-sm font-medium text-gray-800">{it.name}</p>
              <Row label="Qty" value={String(it.quantity)} small muted />
              <Row label="Return Value" value={formatCurrency(it.unitPrice * it.quantity)} small />
              {it.condition && <Row label="Condition" value={conditionLabel(it.condition) ?? ''} small muted />}
            </div>
          ))}
        </div>

        {kind === 'exchange' && newItemName && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500">{isUpgrade ? 'NEW UNIT' : 'REPLACEMENT ITEM'}</p>
            <p className="text-sm font-medium text-gray-800">{newItemName}</p>
            <Row label={isUpgrade ? 'Price' : 'Selling Price'} value={formatCurrency(newItemPrice ?? 0)} small />
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
          {reason && <Row label="Reason" value={reason} muted small />}

          {kind === 'refund' ? (
            <>
              {returnedItems.length > 1 && <Row label="Return Value" value={formatCurrency(returnValueTotal)} muted />}
              {refundMethod && <Row label="Refund Via" value={refundMethod} muted />}
              {refundReference && <Row label="Reference No" value={refundReference} muted small />}
              <div className="pt-1"><Row label="REFUND AMOUNT" value={formatCurrency(refundAmount ?? returnValueTotal)} bold /></div>
            </>
          ) : (
            <>
              <Row label="Return Credit" value={`-${formatCurrency(returnValueTotal)}`} muted />
              {newItemPrice != null && <Row label="New Unit" value={formatCurrency(newItemPrice)} muted />}
              {(refundDifference ?? 0) > 0 ? (
                <>
                  <div className="pt-1"><Row label="REFUND DIFFERENCE" value={formatCurrency(refundDifference ?? 0)} bold /></div>
                  {excessRefundMethod && <Row label="Refund Via" value={excessRefundMethod} muted small />}
                </>
              ) : (
                <>
                  <div className="pt-1"><Row label="AMOUNT PAID" value={formatCurrency(amountPaid ?? 0)} bold /></div>
                  {(amountPaid ?? 0) > 0 && paymentMethod && <Row label="Payment Method" value={paymentMethod} muted small />}
                </>
              )}
            </>
          )}
        </div>

        {hasFreebiesOnOriginal && (
          <div className="border-t border-dashed border-gray-200 pt-3">
            <Row label="Freebies Returned" value={freebiesReturned ?? '—'} small muted />
            {freebieNames && freebieNames.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1">Included: {freebieNames.join(', ')}</p>
            )}
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-3 text-center space-y-1">
          <p className="text-xs font-semibold text-gray-600">Status: {status}</p>
          <p className="text-xs text-gray-500">Thank you.</p>
          <p className="text-[11px] text-gray-400">
            Please keep this receipt for {kind === 'refund' ? 'reference' : 'warranty/reference'}.
          </p>
        </div>
      </div>
    </div>
  );
}
