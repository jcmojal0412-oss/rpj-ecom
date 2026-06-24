'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency, generatePONumber } from '@/lib/utils';

interface Product { id: number; sku: string; name: string; cogs: number; }
interface LineItem { product_id: string; quantity: string; unit_cost: string; productSearch: string; }

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function CreatePOForm({ onSuccess, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [poNumber, setPoNumber] = useState(generatePONumber());
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [orderedAt, setOrderedAt] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<LineItem[]>([
    { product_id: '', quantity: '', unit_cost: '', productSearch: '' }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(setProducts);
  }, []);

  const addItem = () => setItems(prev => [...prev, { product_id: '', quantity: '', unit_cost: '', productSearch: '' }]);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: keyof LineItem, value: string) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const selectProduct = (idx: number, product: Product) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? {
        ...item,
        product_id: String(product.id),
        unit_cost: String(product.cogs),
        productSearch: `${product.sku} — ${product.name}`,
      } : item
    ));
    setDropdownOpen(null);
  };

  const total = items.reduce((sum, item) => {
    const q = parseFloat(item.quantity) || 0;
    const c = parseFloat(item.unit_cost) || 0;
    return sum + q * c;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.product_id && i.quantity && i.unit_cost);
    if (validItems.length === 0) return;
    setSubmitting(true);
    try {
      await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          po_number: poNumber, supplier, notes, ordered_at: orderedAt, status,
          items: validItems.map(i => ({
            product_id: parseInt(i.product_id),
            quantity: parseInt(i.quantity),
            unit_cost: parseFloat(i.unit_cost),
          })),
        }),
      });
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">PO Number *</label>
          <input className="form-input" value={poNumber} onChange={e => setPoNumber(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Supplier *</label>
          <input className="form-input" placeholder="Supplier name" value={supplier}
            onChange={e => setSupplier(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Ordered Date</label>
          <input type="date" className="form-input" value={orderedAt} onChange={e => setOrderedAt(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
          <button type="button" onClick={addItem} className="btn-secondary text-xs py-1">
            <Plus size={13} /> Add Item
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => {
            const filteredProducts = products.filter(p =>
              p.sku.toLowerCase().includes(item.productSearch.toLowerCase()) ||
              p.name.toLowerCase().includes(item.productSearch.toLowerCase())
            ).slice(0, 8);
            const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-5 relative">
                  <input
                    className="form-input text-xs"
                    placeholder="Search product..."
                    value={item.product_id ? item.productSearch : item.productSearch}
                    onChange={e => { updateItem(idx, 'productSearch', e.target.value); updateItem(idx, 'product_id', ''); setDropdownOpen(idx); }}
                    onFocus={() => setDropdownOpen(idx)}
                    onBlur={() => setTimeout(() => setDropdownOpen(null), 200)}
                  />
                  {dropdownOpen === idx && item.productSearch && !item.product_id && filteredProducts.length > 0 && (
                    <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                      {filteredProducts.map(p => (
                        <li key={p.id} className="px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs"
                          onMouseDown={() => selectProduct(idx, p)}>
                          <span className="font-mono text-gray-500 mr-1">{p.sku}</span>{p.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="col-span-2">
                  <input type="number" min="1" className="form-input text-xs" placeholder="Qty"
                    value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.01" className="form-input text-xs" placeholder="Unit cost"
                    value={item.unit_cost} onChange={e => updateItem(idx, 'unit_cost', e.target.value)} />
                </div>
                <div className="col-span-2 pt-2 text-xs text-gray-600 font-medium text-right">
                  {formatCurrency(lineTotal)}
                </div>
                <div className="col-span-1 flex justify-end">
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)}
                      className="p-1.5 text-red-400 hover:text-red-600 mt-0.5">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-3 pt-3 border-t border-gray-100">
          <span className="text-sm font-semibold text-gray-900">Total: {formatCurrency(total)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : 'Create PO'}
        </button>
      </div>
    </form>
  );
}
