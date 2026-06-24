'use client';

import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

interface Product { id: number; sku: string; name: string; }

interface Props {
  products: Product[];
  onSuccess: () => void;
}

type TabType = 'IN' | 'OUT';

export default function StockForm({ products, onSuccess }: Props) {
  const [tab, setTab] = useState<TabType>('IN');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedProduct = products.find(p => String(p.id) === productId);
  const filteredProducts = products.filter(p =>
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !qty) return;
    setSubmitting(true);
    try {
      await fetch('/api/stock-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: parseInt(productId),
          type: tab,
          quantity: parseInt(qty),
          note,
          moved_at: date ? `${date}T${new Date().toTimeString().slice(0, 8)}` : undefined,
        }),
      });
      setProductId(''); setQty(''); setNote(''); setSearch('');
      setDate(new Date().toISOString().slice(0, 10));
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Stock Entry</h2>
      <div className="flex gap-2 mb-5">
        {(['IN', 'OUT'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? t === 'IN' ? 'bg-orange-500 text-white' : 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'IN' ? <ArrowDownCircle size={15} /> : <ArrowUpCircle size={15} />}
            Stock {t}
          </button>
        ))}
      </div>

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
        </div>

        <div>
          <label className="form-label">Quantity *</label>
          <input type="number" min="1" className="form-input" placeholder="Enter qty" value={qty}
            onChange={e => setQty(e.target.value)} required />
        </div>

        <div>
          <label className="form-label">Note</label>
          <input className="form-input" placeholder="Optional note" value={note}
            onChange={e => setNote(e.target.value)} />
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
            className={`btn-primary ${tab === 'OUT' ? '!bg-red-600 hover:!bg-red-700' : '!bg-orange-500 hover:!bg-orange-600'} disabled:opacity-50`}
          >
            {submitting ? 'Saving...' : `Save Stock ${tab}`}
          </button>
        </div>
      </form>
    </div>
  );
}
