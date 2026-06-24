'use client';

import { useState } from 'react';
import type { ResearchItem, ResearchStatus } from './ProductResearchClient';
import type { ResearchStatusRecord } from './StatusManager';

interface Props {
  initial?: ResearchItem;
  defaultStatus?: ResearchStatus;
  statuses: ResearchStatusRecord[];
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ResearchForm({ initial, defaultStatus, statuses, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(initial?.product_name ?? '');
  const [imageReady, setImageReady] = useState(!!initial?.image_ready);
  const [googleLink, setGoogleLink] = useState(initial?.google_link ?? '');
  const [cogs, setCogs] = useState(initial?.cogs ? String(initial.cogs) : '');
  const [srp, setSrp] = useState(initial?.srp ? String(initial.srp) : '');
  const [fbPage, setFbPage] = useState(initial?.fb_page_name ?? '');
  const [fbAdmin, setFbAdmin] = useState(initial?.fb_page_admin ?? '');
  const [status, setStatus] = useState<ResearchStatus>(initial?.status ?? defaultStatus ?? 'For Research');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const body = {
      product_name: name, image_ready: imageReady,
      google_link: googleLink || null,
      cogs: cogs ? parseFloat(cogs) : null,
      srp: srp ? parseFloat(srp) : null,
      fb_page_name: fbPage || null, fb_page_admin: fbAdmin || null, status,
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
        <div className="col-span-2">
          <label className="form-label">Product Name *</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. LED Strip Lights RGB" />
        </div>
        <div>
          <label className="form-label">COGS (₱)</label>
          <input type="number" step="0.01" className="form-input" value={cogs} onChange={e => setCogs(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="form-label">SRP (₱)</label>
          <input type="number" step="0.01" className="form-input" value={srp} onChange={e => setSrp(e.target.value)} placeholder="0.00" />
        </div>
        <div className="col-span-2">
          <label className="form-label">Google Research Link</label>
          <input type="url" className="form-input" value={googleLink} onChange={e => setGoogleLink(e.target.value)} placeholder="https://..." />
        </div>
        <div>
          <label className="form-label">FB Page Name</label>
          <input className="form-input" value={fbPage} onChange={e => setFbPage(e.target.value)} placeholder="Page name" />
        </div>
        <div>
          <label className="form-label">FB Page Admin</label>
          <input className="form-input" value={fbAdmin} onChange={e => setFbAdmin(e.target.value)} placeholder="Admin name" />
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <input
            type="checkbox" id="imageReady" checked={imageReady}
            onChange={e => setImageReady(e.target.checked)}
            className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
          />
          <label htmlFor="imageReady" className="text-sm font-medium text-gray-700">Image Ready</label>
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
