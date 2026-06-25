'use client';

import { useState } from 'react';
import type { ResearchItem, ResearchStatus } from './ProductResearchClient';
import type { ResearchStatusRecord } from './StatusManager';

const OBJECTIVES = ['Webcake', 'Messaging', 'Both', 'Other'];

interface Props {
  initial?: ResearchItem;
  defaultStatus?: ResearchStatus;
  statuses: ResearchStatusRecord[];
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ResearchForm({ initial, defaultStatus, statuses, onSuccess, onCancel }: Props) {
  const [name,             setName]            = useState(initial?.product_name ?? '');
  const [imageReady,       setImageReady]       = useState(!!initial?.image_ready);
  const [googleLink,       setGoogleLink]       = useState(initial?.google_link ?? '');
  const [driveLink,        setDriveLink]        = useState(initial?.drive_link ?? '');
  const [cogs,             setCogs]             = useState(initial?.cogs ? String(initial.cogs) : '');
  const [srp,              setSrp]              = useState(initial?.srp ? String(initial.srp) : '');
  const [fbPage,           setFbPage]           = useState(initial?.fb_page_name ?? '');
  const [fbAdmin,          setFbAdmin]          = useState(initial?.fb_page_admin ?? '');
  const [supplierDetails,  setSupplierDetails]  = useState(initial?.supplier_details ?? '');
  const [objectives,        setObjectives]        = useState(initial?.objectives ?? '');
  const [promo,             setPromo]             = useState(initial?.promo ?? '');
  const [webcakeWarehouse,  setWebcakeWarehouse]  = useState(!!initial?.webcake_warehouse);
  const [addToWarehouse,    setAddToWarehouse]    = useState(!!initial?.add_to_warehouse);
  const [gsheetMonitoring,  setGsheetMonitoring]  = useState(!!initial?.gsheet_monitoring);
  const [status,            setStatus]            = useState<ResearchStatus>(initial?.status ?? defaultStatus ?? 'For Research');
  const [submitting,       setSubmitting]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const body = {
      product_name:     name,
      image_ready:      imageReady,
      google_link:      googleLink || null,
      drive_link:       driveLink || null,
      cogs:             cogs ? parseFloat(cogs) : null,
      srp:              srp ? parseFloat(srp) : null,
      fb_page_name:     fbPage || null,
      fb_page_admin:    fbAdmin || null,
      supplier_details:  supplierDetails || null,
      objectives:        objectives || null,
      promo:             promo || null,
      webcake_warehouse: webcakeWarehouse,
      add_to_warehouse:  addToWarehouse,
      gsheet_monitoring: gsheetMonitoring,
      status,
    };
    try {
      if (initial) {
        await fetch(`/api/product-research/${initial.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/product-research', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">

        {/* Product Name */}
        <div className="col-span-2">
          <label className="form-label">Product Name *</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)}
            required placeholder="e.g. LED Strip Lights RGB" />
        </div>

        {/* COGS & SRP */}
        <div>
          <label className="form-label">COGS (₱)</label>
          <input type="number" step="0.01" className="form-input" value={cogs}
            onChange={e => setCogs(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="form-label">SRP (₱)</label>
          <input type="number" step="0.01" className="form-input" value={srp}
            onChange={e => setSrp(e.target.value)} placeholder="0.00" />
        </div>

        {/* Google Drive Link */}
        <div className="col-span-2">
          <label className="form-label">Google Drive Link</label>
          <input type="url" className="form-input" value={driveLink}
            onChange={e => setDriveLink(e.target.value)} placeholder="https://drive.google.com/..." />
        </div>

        {/* Google Research Link (keep for backward compat) */}
        <div className="col-span-2">
          <label className="form-label">Google Research Link</label>
          <input type="url" className="form-input" value={googleLink}
            onChange={e => setGoogleLink(e.target.value)} placeholder="https://google.com/search?q=..." />
        </div>

        {/* Supplier Details */}
        <div className="col-span-2">
          <label className="form-label">Supplier Link / Details</label>
          <textarea className="form-input" rows={2} value={supplierDetails}
            onChange={e => setSupplierDetails(e.target.value)}
            placeholder="Supplier name, contact, link, or notes..." />
        </div>

        {/* Objectives */}
        <div>
          <label className="form-label">Objectives</label>
          <select className="form-input" value={objectives} onChange={e => setObjectives(e.target.value)}>
            <option value="">— Select —</option>
            {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Promo */}
        <div>
          <label className="form-label">Promo</label>
          <input
            className="form-input"
            placeholder="e.g. SAVE20, BUY2GET1, 50OFF"
            value={promo}
            onChange={e => setPromo(e.target.value)}
          />
        </div>

        {/* Status */}
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>

        {/* FB Page */}
        <div>
          <label className="form-label">FB Page Name</label>
          <input className="form-input" value={fbPage} onChange={e => setFbPage(e.target.value)}
            placeholder="Page name" />
        </div>
        <div>
          <label className="form-label">FB Page Admin</label>
          <input className="form-input" value={fbAdmin} onChange={e => setFbAdmin(e.target.value)}
            placeholder="Admin name" />
        </div>

        {/* Checklist section */}
        <div className="col-span-2">
          <p className="form-label mb-2">Checklist</p>
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            {[
              { id: 'imageReady',       label: 'Image Ready',               checked: imageReady,       onChange: setImageReady },
              { id: 'webcakeWarehouse', label: 'Change Webcake Warehouse',   checked: webcakeWarehouse, onChange: setWebcakeWarehouse },
              { id: 'addToWarehouse',   label: 'Add to Warehouse',           checked: addToWarehouse,   onChange: setAddToWarehouse },
              { id: 'gsheetMonitor',    label: 'Add to GSheet Monitoring',   checked: gsheetMonitoring, onChange: setGsheetMonitoring },
            ].map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={item.id}
                  checked={item.checked}
                  onChange={e => item.onChange(e.target.checked)}
                  className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-400"
                />
                <label htmlFor={item.id} className={`text-sm font-medium transition-colors ${item.checked ? 'text-green-600 line-through' : 'text-gray-700'}`}>
                  {item.checked ? '✓ ' : ''}{item.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Product' : 'Add Product'}
        </button>
      </div>
    </form>
  );
}
