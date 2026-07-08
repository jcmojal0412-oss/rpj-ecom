'use client';

import { useState } from 'react';
import type { Product } from './ProductsClient';

interface Props {
  initial?: Product;
  suggestedSku?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const CATEGORIES = ['General Merchandise', 'Electronics', 'Apparel', 'Home Goods', 'Beauty', 'Food & Beverage', 'Toys', 'Sports', 'Other'];

export default function ProductForm({ initial, suggestedSku, onSuccess, onCancel }: Props) {
  const [sku, setSku] = useState(initial?.sku ?? suggestedSku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [customCategory, setCustomCategory] = useState('');
  const [cogs, setCogs] = useState(initial?.cogs ? String(initial.cogs) : '');
  const [srp, setSrp] = useState(initial?.srp ? String(initial.srp) : '');
  const [reorderPoint, setReorderPoint] = useState(initial?.reorder_point ? String(initial.reorder_point) : '10');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isCustomCategory = category === '__custom__';
  const finalCategory = isCustomCategory ? customCategory : category;

  const margin = srp && cogs && parseFloat(srp) > 0
    ? ((parseFloat(srp) - parseFloat(cogs)) / parseFloat(srp) * 100).toFixed(1)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!sku.trim() || !name.trim()) return;
    setSubmitting(true);
    try {
      const body = {
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        category: finalCategory || null,
        cogs: cogs ? parseFloat(cogs) : 0,
        srp: srp ? parseFloat(srp) : 0,
        reorder_point: parseInt(reorderPoint) || 10,
      };

      const url = initial ? `/api/products/${initial.id}` : '/api/products';
      const method = initial ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">SKU *</label>
          <input
            className="form-input uppercase"
            placeholder="e.g. ELEC-006"
            value={sku}
            onChange={e => setSku(e.target.value)}
            required
            disabled={!!initial}
          />
          {initial && <p className="text-xs text-gray-400 mt-1">SKU cannot be changed after creation.</p>}
        </div>

        <div>
          <label className="form-label">Category</label>
          <select
            className="form-input"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="">— Select category —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__custom__">+ Custom...</option>
          </select>
        </div>

        {isCustomCategory && (
          <div className="col-span-2">
            <label className="form-label">Custom Category Name</label>
            <input
              className="form-input"
              placeholder="Enter category name"
              value={customCategory}
              onChange={e => setCustomCategory(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="col-span-2">
          <label className="form-label">Product Name *</label>
          <input
            className="form-input"
            placeholder="e.g. Wireless Earbuds Pro"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="form-label">COGS — Cost of Goods (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="form-input"
            placeholder="0.00"
            value={cogs}
            onChange={e => setCogs(e.target.value)}
          />
        </div>

        <div>
          <label className="form-label">SRP — Selling Price (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="form-input"
            placeholder="0.00"
            value={srp}
            onChange={e => setSrp(e.target.value)}
          />
        </div>

        {margin !== null && (
          <div className="col-span-2 bg-gray-50 rounded-lg px-4 py-2 flex items-center justify-between text-sm">
            <span className="text-gray-600">Gross Margin</span>
            <span className={`font-bold text-lg ${parseFloat(margin) >= 30 ? 'text-blue-700' : parseFloat(margin) >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
              {margin}%
            </span>
          </div>
        )}

        <div>
          <label className="form-label">Reorder Point (units)</label>
          <input
            type="number"
            min="0"
            className="form-input"
            placeholder="10"
            value={reorderPoint}
            onChange={e => setReorderPoint(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">Alert triggers when stock reaches this level.</p>
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
