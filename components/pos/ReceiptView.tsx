'use client';

import { formatCurrency, formatDate } from '@/lib/utils';
import { displayReceiptNo, derivePaymentStatus, type Sale, type SaleItem, type Refund } from './constants';
import Row from './ReceiptRow';

interface PaymentLeg { method: string; amount: number; reference_no: string | null; }

interface Props {
  sale: Sale;
  items: SaleItem[];
  refunds?: Refund[];
  payments?: PaymentLeg[];
  children?: React.ReactNode;
}

export default function ReceiptView({ sale, items, refunds, payments, children }: Props) {
  // Only meaningfully different from the plain Cash/Online display below
  // once there are 2+ distinct tenders — a single-row `payments` (or none
  // at all) is exactly what cash_amount/online_amount already describe.
  const multiPayment = (payments ?? []).length > 1;
  const totalRefunded = (refunds ?? []).reduce((s, r) => s + r.total_refund, 0);
  // Cashback Redeemed and Downpayment Applied are deductions against what's
  // owed, not discounts — sale.total for a normal sale stays the true gross
  // Net Sale value (the downpayment was genuinely collected earlier, in a
  // separate transaction, so it isn't netted out anywhere upstream), and
  // Amount Due below is what was actually collected today.
  //
  // Exchange Credit Applied works differently: the exchange route already
  // stores sale.total net of it (amountToPay, not the replacement item's
  // full price) — the credited value is the returned item's price, which
  // is already being subtracted out via that item's own linked Refund
  // record (total_refund), so leaving total at the gross replacement price
  // would double-count it in every report that sums sale totals. Not
  // subtracting exchangeCredit again here keeps this receipt's own math
  // consistent with what's actually stored.
  const exchangeCredit = sale.exchange_credit_applied ?? 0;
  const hasAdjustments = sale.cashback_amount > 0 || sale.downpayment_applied > 0 || exchangeCredit > 0;
  const amountDue = Math.max(0, sale.total - sale.cashback_amount - sale.downpayment_applied);
  const freebieCount = items.filter(it => it.is_freebie).length;

  const transactionType =
    sale.linked_sale_id ? 'Exchange / Upgrade' :
    sale.financing_provider ? 'Financing' :
    items.length > 0 && items.every(it => it.product_id == null) ? 'Service / Repair' :
    'Sale';

  // "Cash + GCash" → "GCash"; a bare "GCash" or "Credit Card" passes
  // through as-is. Falls back to the generic word only when nothing usable
  // was recorded.
  const onlineLabel = (() => {
    if (!sale.payment_method) return 'Online';
    const leg = sale.payment_method.split('+').map(s => s.trim()).find(s => s.toLowerCase() !== 'cash');
    return leg || 'Online';
  })();

  const downpaymentCollected = sale.cash_amount + sale.online_amount;

  // customer_name is only ever set on a FOR PICKUP sale (see
  // app/api/pos/sales/route.ts) — still present after release, so this
  // correctly identifies "was/is a pickup order" in both states, unlike
  // fulfillment_status alone (which reads 'RELEASED' for a completed
  // pickup exactly the same as it does for an ordinary immediate sale).
  const isPickupOrder = !!sale.customer_name;
  const paymentStatus = derivePaymentStatus(sale);

  return (
    <div className="max-w-sm mx-auto">
      <div id="pos-receipt" className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 print:p-6 space-y-4">
        <div className="text-center">
          <p className="font-bold text-gray-900">{sale.business_name || 'RPJ ECOM'}</p>
          <p className="text-xs font-semibold text-gray-600 mt-1">Receipt No: {displayReceiptNo(sale).replace(/^Sale #/, '')}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatDate(sale.created_at)}</p>
          <p className="text-xs text-gray-400">Cashier: {sale.cashier_name || '—'}</p>
          <p className="text-xs text-gray-400">Transaction Type: {transactionType}</p>
          {sale.status === 'Voided' && (
            <span className="inline-block mt-2 text-[11px] font-bold uppercase tracking-wide bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Voided</span>
          )}
          {totalRefunded > 0 && (
            <span className="inline-block mt-2 ml-1 text-[11px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Partially Refunded</span>
          )}
        </div>

        {isPickupOrder && (
          <div className={`border-2 rounded-lg px-3 py-2 text-center ${sale.fulfillment_status === 'FOR_PICKUP' ? 'border-blue-400 bg-blue-50' : 'border-green-300 bg-green-50'}`}>
            {sale.fulfillment_status === 'FOR_PICKUP' ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-800">For Pickup</p>
                <p className="text-[11px] font-semibold text-blue-700">Item Not Yet Released</p>
              </>
            ) : (
              <p className="text-xs font-bold uppercase tracking-wide text-green-700">Item Released</p>
            )}
          </div>
        )}

        {isPickupOrder && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1">
            <Row label="Customer Name" value={sale.customer_name || '—'} small />
            <Row label="Mobile Number" value={sale.customer_mobile || '—'} small />
            {sale.expected_pickup_date && <Row label="Expected Pickup" value={sale.expected_pickup_date} small muted />}
            <Row label="Payment Status" value={paymentStatus} small />
            <Row label="Fulfillment Status" value={sale.fulfillment_status === 'FOR_PICKUP' ? 'FOR PICKUP' : 'RELEASED'} small />
            <Row label="Item Released" value={sale.fulfillment_status === 'RELEASED' ? 'YES' : 'NO'} small />
            {sale.pickup_notes && <Row label="Notes" value={sale.pickup_notes} small muted />}
            {sale.fulfillment_status === 'RELEASED' && sale.released_at && (
              <Row label="Released" value={`${sale.released_by_name || '—'} · ${formatDate(sale.released_at)}`} small muted />
            )}
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-2">
          {items.map(it => {
            const unitPrice = it.is_freebie ? (it.original_price ?? 0) : it.unit_price;
            return (
              <div key={it.id}>
                <div className="flex items-center gap-1.5 text-sm text-gray-800">
                  <span className="font-medium">{it.product_name}</span>
                  {!!it.is_freebie && <span className="text-[9px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded shrink-0">Freebie</span>}
                </div>
                <Row
                  label={`${it.quantity} × ${formatCurrency(unitPrice)}`}
                  value={it.is_freebie ? 'FREE' : formatCurrency(it.line_total)}
                  small muted={!it.is_freebie}
                  colorClass={it.is_freebie ? 'text-orange-600' : undefined}
                />
                {it.serial_number && <Row label="Serial No." value={it.serial_number} small muted />}
                {it.imei_1 && <Row label="IMEI 1" value={it.imei_1} small muted />}
                {it.imei_2 && <Row label="IMEI 2" value={it.imei_2} small muted />}
              </div>
            );
          })}
          {freebieCount > 0 && (
            <p className="text-xs text-gray-400 pt-0.5">Promo Freebies: {freebieCount} item{freebieCount === 1 ? '' : 's'}</p>
          )}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
          <Row label="Subtotal" value={formatCurrency(sale.subtotal)} muted />
          {sale.discount > 0 && <Row label="Discount" value={`-${formatCurrency(sale.discount)}`} muted />}
          {sale.additional_fee > 0 && <Row label="Additional Fee" value={formatCurrency(sale.additional_fee)} muted />}
          {sale.cashback_amount > 0 && <Row label="Cashback Redeemed" value={`-${formatCurrency(sale.cashback_amount)}`} muted />}
          {sale.downpayment_applied > 0 && <Row label="Downpayment Applied" value={`-${formatCurrency(sale.downpayment_applied)}`} muted />}
          {exchangeCredit > 0 && <Row label="Exchange Credit Applied" value={`-${formatCurrency(exchangeCredit)}`} muted />}
          {sale.tax_amount > 0 && <Row label={`Tax (${sale.tax_percent}%)`} value={formatCurrency(sale.tax_amount)} muted />}
          {sale.service_charge > 0 && <Row label="Service Charge" value={formatCurrency(sale.service_charge)} muted />}
          {sale.delivery_fee > 0 && <Row label="Delivery Fee" value={formatCurrency(sale.delivery_fee)} muted />}
          {hasAdjustments ? (
            <>
              <Row label="Net Sale" value={formatCurrency(sale.total)} muted />
              <div className="pt-1"><Row label="Amount Due" value={formatCurrency(amountDue)} bold /></div>
            </>
          ) : (
            <div className="pt-1"><Row label="Amount Due" value={formatCurrency(sale.total)} bold /></div>
          )}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 mb-1">Payment Breakdown</p>
          {sale.financing_provider ? (
            <>
              {downpaymentCollected > 0 && multiPayment ? (
                payments!.map((p, i) => (
                  <Row key={i} label={p.method} value={formatCurrency(p.amount)} small={i > 0} />
                ))
              ) : (
                <>
                  {downpaymentCollected > 0 && sale.payment_method && <Row label="DP Method" value={sale.payment_method} muted small />}
                  {downpaymentCollected > 0 && (
                    <Row label={`Downpayment to ${sale.business_name || 'Store'}`} value={formatCurrency(downpaymentCollected)} />
                  )}
                </>
              )}
              <Row label={`${sale.financing_provider} Financing`} value={formatCurrency(sale.financing_amount)} bold />
              {sale.financing_reference && <Row label="Financing Ref. No." value={sale.financing_reference} muted small />}
              {sale.financing_status && <Row label="Status" value={sale.financing_status} muted small />}
            </>
          ) : multiPayment ? (
            <>
              {payments!.map((p, i) => (
                <Row key={i} label={p.reference_no ? `${p.method} (${p.reference_no})` : p.method} value={formatCurrency(p.amount)} />
              ))}
              <Row label="Change" value={formatCurrency(sale.change_due)} bold />
            </>
          ) : (
            <>
              {sale.cash_amount > 0 && (
                <Row label={sale.change_due > 0 ? 'Cash Tendered' : 'Cash'} value={formatCurrency(sale.cash_amount)} />
              )}
              {sale.online_amount > 0 && <Row label={onlineLabel} value={formatCurrency(sale.online_amount)} />}
              {sale.cash_amount === 0 && sale.online_amount === 0 && sale.payment_method && (
                <Row label="Payment Method" value={sale.payment_method} />
              )}
              <Row label="Change" value={formatCurrency(sale.change_due)} bold />
              {sale.change_due > 0 && (
                <Row label="Cash Applied" value={formatCurrency(Math.max(0, sale.cash_amount - sale.change_due))} small muted />
              )}
            </>
          )}
          {sale.reference_no && <Row label="Reference No." value={sale.reference_no} muted small />}
        </div>

        {totalRefunded > 0 && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 mb-1">Refund</p>
            {(refunds ?? []).filter(r => r.total_refund > 0).map(r => (
              <Row key={r.id} label={r.refund_method ? `Refund via ${r.refund_method}` : 'Refund'} value={`-${formatCurrency(r.total_refund)}`} colorClass="text-amber-700" />
            ))}
            <div className="pt-1"><Row label="Net" value={formatCurrency(sale.total - totalRefunded)} bold /></div>
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-3 text-center space-y-1">
          {sale.notes && <p className="text-xs text-gray-400">{sale.notes}</p>}
          <p className="text-xs text-gray-500">Thank you for shopping at {sale.business_name || 'us'}!</p>
          <p className="text-[11px] text-gray-400">Please keep this receipt for warranty, return, or exchange.</p>
        </div>
      </div>

      {children && <div className="mt-4 flex flex-wrap justify-center gap-2 sm:gap-3 print:hidden max-sm:[&>*]:flex-1 max-sm:[&>*]:basis-[45%] max-sm:[&>*]:justify-center max-sm:[&>*]:py-2.5">{children}</div>}
    </div>
  );
}
