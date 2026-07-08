'use client';

import { useState } from 'react';
import { formatCurrency, todayISO } from '@/lib/utils';
import type { Repair } from './ServiceCenterClient';

interface Props {
  initial?: Repair;
  onSuccess: () => void;
  onCancel: () => void;
}

const SPLIT_BNS = 0.6;
const SPLIT_GERALD = 0.4;

export default function RepairForm({ initial, onSuccess, onCancel }: Props) {
  const [repairDate,    setRepairDate]    = useState(initial?.repair_date?.slice(0, 10) ?? todayISO());
  const [repairDetails, setRepairDetails] = useState(initial?.repair_details ?? '');
  const [unitModel,     setUnitModel]     = useState(initial?.unit_model ?? '');
  const [csPayment,     setCsPayment]     = useState(initial?.cs_payment ? String(initial.cs_payment) : '');
  const [cogs,          setCogs]          = useState(initial?.cogs ? String(initial.cogs) : '');
  const [dp,            setDp]            = useState(initial?.dp ? String(initial.dp) : '');
  const [status,        setStatus]        = useState<Repair['status']>(initial?.status ?? 'ONGOING');
  const [paidToTech,    setPaidToTech]    = useState(!!initial?.paid_to_tech);
  const [techPaidDate,  setTechPaidDate]  = useState(initial?.tech_paid_date?.slice(0, 10) ?? '');
  const [submitting,    setSubmitting]    = useState(false);

  const csNum   = parseFloat(csPayment) || 0;
  const cogsNum = parseFloat(cogs) || 0;
  const labor   = csNum - cogsNum;
  const bns     = labor * SPLIT_BNS;
  const gerald  = labor * SPLIT_GERALD;
  const hasValues = csPayment !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairDate) return;
    setSubmitting(true);
    try {
      const body = {
        repair_date: repairDate,
        repair_details: repairDetails.trim() || null,
        unit_model: unitModel.trim() || null,
        cs_payment: csNum,
        cogs: cogsNum,
        dp: dp ? parseFloat(dp) : 0,
        status,
        paid_to_tech: paidToTech,
        tech_paid_date: paidToTech ? (techPaidDate || null) : null,
      };

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

        <div className="col-span-2">
          <label className="form-label">Repair Details</label>
          <input className="form-input" placeholder="e.g. ORDER LCD, FUSE PROBLEM..." value={repairDetails} onChange={e => setRepairDetails(e.target.value)} />
        </div>

        <div>
          <label className="form-label">CS Payment (₱)</label>
          <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={csPayment} onChange={e => setCsPayment(e.target.value)} />
        </div>
        <div>
          <label className="form-label">COGS — Parts Cost (₱)</label>
          <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={cogs} onChange={e => setCogs(e.target.value)} />
        </div>

        {/* Auto-computed split preview */}
        <div className="col-span-2 bg-gray-50 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Labor Amount (CS Payment − COGS)</span>
            <span className="font-bold text-gray-900">{hasValues ? formatCurrency(labor) : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-600">BNS Share (60%)</span>
            <span className="font-bold text-blue-700">{hasValues ? formatCurrency(bns) : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-amber-600">Technician Share (40%)</span>
            <span className="font-bold text-amber-700">{hasValues ? formatCurrency(gerald) : '—'}</span>
          </div>
        </div>

        <div>
          <label className="form-label">Down Payment (₱)</label>
          <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={dp} onChange={e => setDp(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value as Repair['status'])}>
            <option value="ONGOING">Ongoing</option>
            <option value="CUSTOMER PAID">Customer Paid</option>
          </select>
        </div>

        <div className="col-span-2 flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
          <input
            type="checkbox"
            id="paidToTech"
            checked={paidToTech}
            onChange={e => setPaidToTech(e.target.checked)}
            className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-400"
          />
          <label htmlFor="paidToTech" className="text-sm font-medium text-gray-700 flex-1">Paid to Technician</label>
          {paidToTech && (
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={techPaidDate}
              onChange={e => setTechPaidDate(e.target.value)} />
          )}
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
