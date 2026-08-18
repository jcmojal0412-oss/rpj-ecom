'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Plus, Wallet } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import RecordPaymentModal from './RecordPaymentModal';
import type { Repair, Payment, Payout } from './types';
import { REPAIR_STATUS_COLOR, CUSTOMER_STATUS_COLOR, PAYOUT_STATUS_COLOR } from './types';

interface DetailResponse extends Repair {
  payments: Payment[];
  payouts: Payout[];
}

export default function RepairDetailsDrawer({ repairId, onClose, onChanged }: {
  repairId: number; onClose: () => void; onChanged: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [payingTech, setPayingTech] = useState(false);

  const fetchDetail = () => {
    setLoading(true);
    fetch(`/api/service-repairs/${repairId}`).then(r => r.json()).then(d => { setData(d); setLoading(false); });
  };

  useEffect(fetchDetail, [repairId]);

  const payTechnicianNow = async () => {
    if (!data || data.tech_payable <= 0) return;
    setPayingTech(true);
    try {
      await fetch('/api/service-repairs/tech-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repair_ids: [data.id], payment_date: todayISO(), payment_method: 'Cash', reference_notes: null }),
      });
      fetchDetail();
      onChanged();
    } finally {
      setPayingTech(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-[#E5EAF0] z-10">
          <h2 className="text-lg font-semibold text-[#16233B]">Repair Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
        </div>

        {loading || !data ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Repair Information */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66758A] mb-2">Repair Information</h3>
              <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-4 space-y-1.5 text-sm">
                <Row label="Date" value={formatDate(data.repair_date)} />
                <Row label="Customer" value={data.customer_name || '—'} />
                <Row label="Contact Number" value={data.contact_number || '—'} />
                <Row label="Unit / Model" value={data.unit_model || '—'} />
                <Row label="Problem" value={data.repair_details || '—'} />
                <Row label="Technician" value={data.technician_name || '—'} />
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[#66758A]">Repair Status</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${REPAIR_STATUS_COLOR[data.repair_status]}`}>{data.repair_status}</span>
                </div>
                {(data.order_no || data.receipt_no) && (
                  <>
                    {data.order_no && <Row label="Order No." value={data.order_no} />}
                    {data.receipt_no && <Row label="Receipt No." value={data.receipt_no} />}
                  </>
                )}
              </div>
            </section>

            {/* Financial Breakdown */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66758A] mb-2">Financial Breakdown</h3>
              <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-4 space-y-1.5 text-sm">
                <Row label="Repair Amount" value={formatCurrency(data.repair_amount)} bold />
                <Row label="COGS" value={formatCurrency(data.cogs)} />
                <Row label="Labor Amount" value={formatCurrency(data.labor_amount)} />
                <Row label="BNS Earnings" value={formatCurrency(data.bns_share)} className="text-blue-700" />
                <Row label="Technician Earnings" value={formatCurrency(data.tech_earnings)} className="text-amber-700" />
              </div>
            </section>

            {/* Customer Collection */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66758A]">Customer Collection</h3>
                <button onClick={() => setShowRecordPayment(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#233653] hover:bg-[#1b2941] px-2.5 py-1 rounded-lg">
                  <Plus size={12} /> Record Payment
                </button>
              </div>
              <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-4 space-y-1.5 text-sm mb-2">
                <Row label="Total Collected" value={formatCurrency(data.collected)} bold />
                <Row label="Remaining Balance" value={formatCurrency(data.balance)} bold />
                <div className="flex justify-between items-center">
                  <span className="text-[#66758A]">Payment Status</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CUSTOMER_STATUS_COLOR[data.customer_payment_status]}`}>{data.customer_payment_status}</span>
                </div>
              </div>
              {data.payments.length > 0 && (
                <div className="space-y-1.5">
                  {data.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs bg-white border border-[#E5EAF0] rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[#16233B] font-medium">{formatDate(p.payment_date)}</span>
                        <span className="text-[#94A2B4] ml-2">{p.payment_method || '—'}{p.reference_notes ? ` · ${p.reference_notes}` : ''}</span>
                      </div>
                      <span className="font-semibold text-green-700">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Technician Payout */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66758A]">Technician Payout</h3>
                {data.tech_payout_status === 'Due' && (
                  <button onClick={payTechnicianNow} disabled={payingTech} className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#B68B3C] hover:bg-[#9c7530] px-2.5 py-1 rounded-lg disabled:opacity-50">
                    {payingTech ? <Loader2 size={12} className="animate-spin" /> : <Wallet size={12} />}
                    Pay {formatCurrency(data.tech_payable)}
                  </button>
                )}
              </div>
              <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-4 space-y-1.5 text-sm mb-2">
                <Row label="Technician Earnings" value={formatCurrency(data.tech_earnings)} />
                <Row label="Amount Paid" value={formatCurrency(data.paid_out)} />
                <Row label="Remaining Payable" value={formatCurrency(data.tech_payable)} bold />
                <div className="flex justify-between items-center">
                  <span className="text-[#66758A]">Payout Status</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PAYOUT_STATUS_COLOR[data.tech_payout_status]}`}>{data.tech_payout_status}</span>
                </div>
              </div>
              {data.payouts.length > 0 && (
                <div className="space-y-1.5">
                  {data.payouts.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs bg-white border border-[#E5EAF0] rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[#16233B] font-medium">{formatDate(p.payment_date)}</span>
                        <span className="text-[#94A2B4] ml-2">{p.payment_method || '—'}{p.processed_by_name ? ` · by ${p.processed_by_name}` : ''}</span>
                      </div>
                      <span className="font-semibold text-amber-700">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Notes */}
            {data.notes && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66758A] mb-2">Notes</h3>
                <p className="text-sm text-[#16233B] bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-4 whitespace-pre-wrap">{data.notes}</p>
              </section>
            )}
          </div>
        )}
      </div>

      {showRecordPayment && data && (
        <Modal open={showRecordPayment} onClose={() => setShowRecordPayment(false)} title="Record Payment" size="md">
          <RecordPaymentModal
            repair={data}
            onCancel={() => setShowRecordPayment(false)}
            onSaved={() => { setShowRecordPayment(false); fetchDetail(); onChanged(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#66758A]">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} text-[#16233B] ${className || ''}`}>{value}</span>
    </div>
  );
}
