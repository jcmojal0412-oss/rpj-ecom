'use client';

import { useState } from 'react';
import { formatCurrency, todayISO } from '@/lib/utils';
import { computeSplit, REPAIR_STATUSES } from '@/lib/service-center';
import type { Repair } from './types';

interface Props {
  initial?: Repair;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RepairForm({ initial, onSuccess, onCancel }: Props) {
  const [repairDate,     setRepairDate]     = useState(initial?.repair_date?.slice(0, 10) ?? todayISO());
  const [customerName,   setCustomerName]   = useState(initial?.customer_name ?? '');
  const [contactNumber,  setContactNumber]  = useState(initial?.contact_number ?? '');
  const [unitModel,      setUnitModel]      = useState(initial?.unit_model ?? '');
  const [repairDetails,  setRepairDetails]  = useState(initial?.repair_details ?? '');
  const [orderNo,        setOrderNo]        = useState(initial?.order_no ?? '');
  const [receiptNo,      setReceiptNo]      = useState(initial?.receipt_no ?? '');
  const [technicianName, setTechnicianName] = useState(initial?.technician_name ?? 'Gerald');
  const [repairAmount,   setRepairAmount]   = useState(initial?.repair_amount ? String(initial.repair_amount) : '');
  const [cogs,           setCogs]           = useState(initial?.cogs ? String(initial.cogs) : '');
  const [dp,             setDp]             = useState('');
  const [repairStatus,   setRepairStatus]   = useState(initial?.repair_status ?? 'Received');
  const [notes,          setNotes]          = useState(initial?.notes ?? '');
  const [submitting,     setSubmitting]     = useState(false);

  const csNum = parseFloat(repairAmount) || 0;
  const cogsNum = parseFloat(cogs) || 0;
  const { labor, bns, tech } = computeSplit(csNum, cogsNum);
  const hasValues = repairAmount !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairDate) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        repair_date: repairDate,
        customer_name: customerName.trim() || null,
        contact_number: contactNumber.trim() || null,
        unit_model: unitModel.trim() || null,
        repair_details: repairDetails.trim() || null,
        order_no: orderNo.trim() || null,
        receipt_no: receiptNo.trim() || null,
        technician_name: technicianName.trim() || null,
        repair_amount: csNum,
        cogs: cogsNum,
        repair_status: repairStatus,
        notes: notes.trim() || null,
      };
      if (!initial) body.dp = dp ? parseFloat(dp) : 0;

      const url = initial ? `/api/service-repairs/${initial.id}` : '/api/service-repairs';
      const method = initial ? 'PUT' : 'POST';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Date *</label>
          <input type="date" className="form-input" value={repairDate} onChange={e => setRepairDate(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Unit / Model</label>
          <input className="form-input" placeholder="e.g. IPHONE 13" value={unitModel} onChange={e => setUnitModel(e.target.value)} />
        </div>

        <div>
          <label className="form-label">Customer Name</label>
          <input className="form-input" placeholder="e.g. Juan Dela Cruz" value={customerName} onChange={e => setCustomerName(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Contact Number</label>
          <input className="form-input" placeholder="e.g. 0917 123 4567" value={contactNumber} onChange={e => setContactNumber(e.target.value)} />
        </div>

        <div className="col-span-2">
          <label className="form-label">Repair Details</label>
          <input className="form-input" placeholder="e.g. ORDER LCD, FUSE PROBLEM..." value={repairDetails} onChange={e => setRepairDetails(e.target.value)} />
        </div>

        <div>
          <label className="form-label">Order No.</label>
          <input className="form-input" placeholder="e.g. ORD-1024" value={orderNo} onChange={e => setOrderNo(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Receipt No.</label>
          <input className="form-input" placeholder="e.g. OR-00231" value={receiptNo} onChange={e => setReceiptNo(e.target.value)} />
        </div>

        <div className="col-span-2">
          <label className="form-label">Technician</label>
          <input className="form-input" placeholder="e.g. Gerald" value={technicianName} onChange={e => setTechnicianName(e.target.value)} />
        </div>

        <div>
          <label className="form-label">Repair Amount (₱)</label>
          <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={repairAmount} onChange={e => setRepairAmount(e.target.value)} />
        </div>
        <div>
          <label className="form-label">COGS — Parts Cost (₱)</label>
          <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={cogs} onChange={e => setCogs(e.target.value)} />
        </div>

        {/* Auto-computed split preview */}
        <div className="col-span-2 bg-gray-50 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Labor Amount (Repair Amount − COGS)</span>
            <span className="font-bold text-gray-900">{hasValues ? formatCurrency(labor) : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-600">BNS Earnings (60%)</span>
            <span className="font-bold text-blue-700">{hasValues ? formatCurrency(bns) : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-amber-600">Technician Earnings (40%)</span>
            <span className="font-bold text-amber-700">{hasValues ? formatCurrency(tech) : '—'}</span>
          </div>
        </div>

        {!initial && (
          <div>
            <label className="form-label">Down Payment (₱)</label>
            <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={dp} onChange={e => setDp(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">Recorded as an initial payment at intake, if any.</p>
          </div>
        )}
        <div className={initial ? 'col-span-2' : ''}>
          <label className="form-label">Repair Status</label>
          <select className="form-input" value={repairStatus} onChange={e => setRepairStatus(e.target.value as typeof repairStatus)}>
            {REPAIR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="col-span-2">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={2} placeholder="Optional notes / activity" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting || !repairDate} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Repair' : 'Add Repair'}
        </button>
      </div>
    </form>
  );
}
