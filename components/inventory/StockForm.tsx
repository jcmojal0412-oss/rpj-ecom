'use client';

import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2 } from 'lucide-react';
import { todayISO, formatCurrency } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { IN_REASONS, OUT_REASONS } from './constants';

interface Product { id: number; sku: string; name: string; quantity: number; cogs: number; }

interface Props {
  products: Product[];
  onSuccess: () => void;
}

type TabType = 'IN' | 'OUT';

interface SaveResult {
  product_name: string; type: TabType; reason: string;
  previous_stock: number; new_stock: number; quantity: number;
}

export default function StockForm({ products, onSuccess }: Props) {
  const [tab, setTab] = useState<TabType>('IN');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const [confirmCogs, setConfirmCogs] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const selectedProduct = products.find(p => String(p.id) === productId);
  const filteredProducts = products.filter(p =>
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 10);

  const switchTab = (t: TabType) => {
    setTab(t);
    setReason('');
    if (t === 'OUT') setUnitCost('');
  };

  const reset = () => {
    setProductId(''); setQty(''); setUnitCost(''); setReason(''); setNote(''); setSearch('');
    setDate(todayISO());
  };

  const save = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/stock-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: parseInt(productId),
          type: tab,
          quantity: parseInt(qty),
          reason,
          note,
          moved_at: date ? `${date}T${new Date().toTimeString().slice(0, 8)}` : undefined,
          unit_cost: tab === 'IN' && unitCost ? unitCost : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save stock movement'); return; }
      setResult(data);
      reset();
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!productId || !qty || !reason) return;
    const qtyNum = parseInt(qty, 10);
    if (!qtyNum || qtyNum <= 0) { setError('Quantity must be greater than 0'); return; }
    if (reason === 'Other' && !note.trim()) { setError('Note is required when Reason is Other'); return; }
    if (tab === 'OUT' && selectedProduct && qtyNum > selectedProduct.quantity) {
      setError(`Insufficient Stock. Available: ${selectedProduct.quantity} pcs, Requested Stock OUT: ${qtyNum} pcs.`);
      return;
    }
    if (tab === 'IN' && unitCost && selectedProduct && parseFloat(unitCost) !== selectedProduct.cogs) {
      setConfirmCogs(true);
      return;
    }
    save();
  };

  if (result) {
    return (
      <div className="card">
        <div className="max-w-xs mx-auto text-center space-y-3 py-2">
          <div className="flex items-center gap-2 justify-center text-green-600">
            <CheckCircle2 size={18} />
            <p className="text-sm font-bold">STOCK {result.type} SUCCESSFUL</p>
          </div>
          <p className="text-base font-semibold text-gray-900">{result.product_name}</p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm text-left">
            <div className="flex justify-between text-gray-500"><span>Previous Stock</span><span className="tabular-nums font-medium text-gray-800">{result.previous_stock}</span></div>
            <div className="flex justify-between text-gray-500"><span>{result.type === 'IN' ? 'Added' : 'Removed'}</span><span className="tabular-nums font-medium text-gray-800">{result.quantity}</span></div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5"><span>New Stock</span><span className="tabular-nums">{result.new_stock}</span></div>
            <div className="flex justify-between text-gray-500 pt-1"><span>Reason</span><span className="font-medium text-gray-800 text-right">{result.reason}</span></div>
          </div>
          <button onClick={() => setResult(null)} className="btn-primary">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Stock Entry</h2>
      <div className="flex gap-2 mb-5">
        {(['IN', 'OUT'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? t === 'IN' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'IN' ? <ArrowDownCircle size={15} /> : <ArrowUpCircle size={15} />}
            Stock {t}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative">
          <label className="form-label">Product *</label>
          <input
            className="form-input"
            placeholder="Search by SKU or name..."
            value={selectedProduct ? `${selectedProduct.sku} — ${selectedProduct.name}` : search}
            onChange={e => { setSearch(e.target.value); setProductId(''); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            required={!productId}
          />
          {showDropdown && search && !productId && filteredProducts.length > 0 && (
            <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {filteredProducts.map(p => (
                <li
                  key={p.id}
                  className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  onMouseDown={() => { setProductId(String(p.id)); setSearch(''); setShowDropdown(false); }}
                >
                  <span className="font-mono text-xs text-gray-500 mr-2">{p.sku}</span>{p.name}
                </li>
              ))}
            </ul>
          )}
          {selectedProduct && (
            <div className="mt-1.5 bg-gray-50 rounded-md px-2.5 py-1.5 text-xs text-gray-500 space-y-0.5">
              <p className="text-gray-400">Current Stock: <span className="font-semibold text-gray-700">{selectedProduct.quantity} pcs</span></p>
              <p className="text-gray-400">Current COGS: <span className="font-semibold text-gray-700">{formatCurrency(selectedProduct.cogs)}</span></p>
            </div>
          )}
        </div>

        <div>
          <label className="form-label">Quantity *</label>
          <input type="number" min="1" className="form-input" placeholder="Enter qty" value={qty}
            onChange={e => setQty(e.target.value)} required />
        </div>

        <div>
          <label className="form-label">Reason *</label>
          <select className="form-input" value={reason} onChange={e => setReason(e.target.value)} required>
            <option value="">Select Reason</option>
            {(tab === 'IN' ? IN_REASONS : OUT_REASONS).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {tab === 'IN' && (
          <div>
            <label className="form-label">Cost per Unit (Optional)</label>
            <input type="number" min="0" step="0.01" className="form-input" placeholder="₱0.00" value={unitCost}
              onChange={e => setUnitCost(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">
              {selectedProduct ? `Current COGS: ${formatCurrency(selectedProduct.cogs)}. ` : ''}Leave blank if unchanged.
            </p>
          </div>
        )}

        <div>
          <label className="form-label">Note{reason === 'Other' ? ' *' : ''}</label>
          <input className="form-input" placeholder={reason === 'Other' ? 'Required — describe the reason' : 'Optional note'} value={note}
            onChange={e => setNote(e.target.value)} required={reason === 'Other'} />
        </div>

        <div>
          <label className="form-label">Date</label>
          <input type="date" className="form-input" value={date}
            onChange={e => setDate(e.target.value)} />
        </div>

        <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
          <button
            type="submit"
            disabled={submitting || !productId}
            className={`btn-primary ${tab === 'OUT' ? '!bg-red-600 hover:!bg-red-700' : '!bg-green-600 hover:!bg-green-700'} disabled:opacity-50`}
          >
            {submitting ? 'Saving...' : `Save Stock ${tab}`}
          </button>
        </div>
      </form>

      {confirmCogs && selectedProduct && (
        <Modal open onClose={() => setConfirmCogs(false)} title="Update COGS?" size="sm">
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Current COGS</span>
                <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(selectedProduct.cogs)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">New Cost</span>
                <span className="font-bold text-green-700 tabular-nums">{formatCurrency(parseFloat(unitCost) || 0)}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmCogs(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => { setConfirmCogs(false); save(); }} className="btn-primary">Confirm</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
