'use client';

import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { todayISO, formatCurrency } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { IN_REASONS, OUT_REASONS } from './constants';

interface Product { id: number; sku: string; name: string; quantity: number; cogs: number; }

interface Props {
  products: Product[];
  onSuccess: () => void;
}

type TabType = 'IN' | 'OUT';
type EntryMode = 'single' | 'bulk';

interface SaveResult {
  product_name: string; type: TabType; reason: string;
  previous_stock: number; new_stock: number; quantity: number;
}

interface BulkRow { key: string; productId: string; search: string; qty: string; unitCost: string; }
interface BulkResultItem { sku: string; product_name: string; previous_stock: number; new_stock: number; quantity: number; }

let rowKeySeq = 0;
const newRow = (): BulkRow => ({ key: `r${++rowKeySeq}`, productId: '', search: '', qty: '', unitCost: '' });

export default function StockForm({ products, onSuccess }: Props) {
  const [entryMode, setEntryMode] = useState<EntryMode>('single');
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

  // Bulk mode state — Reason/Note/Date above are shared across the whole
  // batch (one delivery, one reason), only Product/Qty/Cost vary per row.
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => [newRow(), newRow()]);
  const [bulkOpenRow, setBulkOpenRow] = useState<string | null>(null);
  const [bulkConfirmCogs, setBulkConfirmCogs] = useState<{ sku: string; name: string; oldCogs: number; newCogs: number }[] | null>(null);
  const [bulkResult, setBulkResult] = useState<{ type: TabType; reason: string; items: BulkResultItem[] } | null>(null);

  const selectedProduct = products.find(p => String(p.id) === productId);
  const filteredProducts = products.filter(p =>
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 10);

  const switchTab = (t: TabType) => {
    setTab(t);
    setReason('');
    // Cost per Unit only applies to Stock IN — clear it (both single-item
    // and every bulk row) when switching to OUT, same as before. Product
    // and Quantity selections are tab-agnostic and are deliberately kept,
    // so a misclick between IN/OUT doesn't wipe out rows the cashier
    // already filled in.
    if (t === 'OUT') {
      setUnitCost('');
      setBulkRows(rows => rows.map(r => ({ ...r, unitCost: '' })));
    }
  };

  const reset = () => {
    setProductId(''); setQty(''); setUnitCost(''); setReason(''); setNote(''); setSearch('');
    setDate(todayISO());
  };

  const switchEntryMode = (m: EntryMode) => {
    setEntryMode(m);
    setError('');
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

  const updateRow = (key: string, patch: Partial<BulkRow>) => {
    setBulkRows(rows => rows.map(r => r.key === key ? { ...r, ...patch } : r));
  };
  const addBulkRow = () => setBulkRows(rows => [...rows, newRow()]);
  const removeBulkRow = (key: string) => setBulkRows(rows => rows.length > 1 ? rows.filter(r => r.key !== key) : rows);

  const activeBulkRows = bulkRows.filter(r => r.productId || r.qty);
  const duplicateProductIds = new Set<string>();
  {
    const counts = new Map<string, number>();
    for (const r of bulkRows) { if (r.productId) counts.set(r.productId, (counts.get(r.productId) ?? 0) + 1); }
    for (const [id, c] of counts) { if (c > 1) duplicateProductIds.add(id); }
  }

  const bulkSave = async (rows: BulkRow[]) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/stock-movements/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: tab,
          reason,
          note,
          moved_at: date ? `${date}T${new Date().toTimeString().slice(0, 8)}` : undefined,
          items: rows.map(r => ({
            product_id: parseInt(r.productId),
            quantity: parseInt(r.qty),
            unit_cost: tab === 'IN' && r.unitCost ? r.unitCost : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save stock movements'); return; }
      setBulkResult(data);
      setBulkRows([newRow(), newRow()]);
      setReason(''); setNote(''); setDate(todayISO());
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!reason) { setError('Reason is required'); return; }
    if (reason === 'Other' && !note.trim()) { setError('Note is required when Reason is Other'); return; }
    if (activeBulkRows.length === 0) { setError('Add at least one product row'); return; }

    for (const r of activeBulkRows) {
      if (!r.productId) { setError('Every row needs a product selected'); return; }
      const qtyNum = parseInt(r.qty, 10);
      if (!qtyNum || qtyNum <= 0) { setError('Every row needs a quantity greater than 0'); return; }
    }
    if (duplicateProductIds.size > 0) {
      setError('The same product is selected in more than one row — combine them into a single row.');
      return;
    }
    if (tab === 'OUT') {
      for (const r of activeBulkRows) {
        const p = products.find(p => String(p.id) === r.productId);
        const qtyNum = parseInt(r.qty, 10);
        if (p && qtyNum > p.quantity) {
          setError(`${p.sku} — Insufficient Stock. Available: ${p.quantity} pcs, Requested Stock OUT: ${qtyNum} pcs.`);
          return;
        }
      }
    }

    if (tab === 'IN') {
      const cogsChanges = activeBulkRows
        .map(r => {
          const p = products.find(p => String(p.id) === r.productId);
          const newCogs = r.unitCost ? parseFloat(r.unitCost) : NaN;
          if (!p || !r.unitCost || newCogs === p.cogs) return null;
          return { sku: p.sku, name: p.name, oldCogs: p.cogs, newCogs };
        })
        .filter((x): x is { sku: string; name: string; oldCogs: number; newCogs: number } => x !== null);
      if (cogsChanges.length > 0) {
        setBulkConfirmCogs(cogsChanges);
        return;
      }
    }

    bulkSave(activeBulkRows);
  };

  if (bulkResult) {
    return (
      <div className="card">
        <div className="max-w-md mx-auto text-center space-y-3 py-2">
          <div className="flex items-center gap-2 justify-center text-green-600">
            <CheckCircle2 size={18} />
            <p className="text-sm font-bold">STOCK {bulkResult.type} SUCCESSFUL — {bulkResult.items.length} product{bulkResult.items.length === 1 ? '' : 's'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-left divide-y divide-gray-200">
            {bulkResult.items.map((it, i) => (
              <div key={i} className="py-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{it.sku} — {it.product_name}</p>
                </div>
                <span className="shrink-0 tabular-nums text-gray-600">{it.previous_stock} → <span className="font-semibold text-gray-900">{it.new_stock}</span></span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">Reason: {bulkResult.reason}</p>
          <button onClick={() => setBulkResult(null)} className="btn-primary">Done</button>
        </div>
      </div>
    );
  }

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
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-base font-semibold text-gray-900">Stock Entry</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['single', 'bulk'] as EntryMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchEntryMode(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                entryMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'single' ? 'Single Item' : 'Multiple Items'}
            </button>
          ))}
        </div>
      </div>

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

      {entryMode === 'bulk' ? (
        <form onSubmit={handleBulkSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="form-label">Reason * <span className="text-gray-400 font-normal">(applies to all rows)</span></label>
              <select className="form-input" value={reason} onChange={e => setReason(e.target.value)} required>
                <option value="">Select Reason</option>
                {(tab === 'IN' ? IN_REASONS : OUT_REASONS).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Note{reason === 'Other' ? ' *' : ''}</label>
              <input className="form-input" placeholder={reason === 'Other' ? 'Required — describe the reason' : 'Optional note'} value={note}
                onChange={e => setNote(e.target.value)} required={reason === 'Other'} />
            </div>
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            {bulkRows.map((row, idx) => {
              const rowProduct = products.find(p => String(p.id) === row.productId);
              const rowFiltered = products.filter(p =>
                p.sku.toLowerCase().includes(row.search.toLowerCase()) ||
                p.name.toLowerCase().includes(row.search.toLowerCase())
              ).slice(0, 10);
              const isDup = row.productId && duplicateProductIds.has(row.productId);
              return (
                <div key={row.key} className={`grid grid-cols-1 sm:grid-cols-12 gap-2 items-start p-2 rounded-lg ${isDup ? 'bg-red-50' : ''}`}>
                  <div className="relative sm:col-span-5">
                    {idx === 0 && <label className="form-label sm:hidden">Product</label>}
                    <input
                      className={`form-input ${isDup ? '!border-red-300' : ''}`}
                      placeholder="Search by SKU or name..."
                      value={rowProduct ? `${rowProduct.sku} — ${rowProduct.name}` : row.search}
                      onChange={e => { updateRow(row.key, { search: e.target.value, productId: '' }); setBulkOpenRow(row.key); }}
                      onFocus={() => setBulkOpenRow(row.key)}
                      onBlur={() => setTimeout(() => setBulkOpenRow(o => o === row.key ? null : o), 200)}
                    />
                    {bulkOpenRow === row.key && row.search && !row.productId && rowFiltered.length > 0 && (
                      <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {rowFiltered.map(p => (
                          <li
                            key={p.id}
                            className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                            onMouseDown={() => updateRow(row.key, { productId: String(p.id), search: '' })}
                          >
                            <span className="font-mono text-xs text-gray-500 mr-2">{p.sku}</span>{p.name}
                          </li>
                        ))}
                      </ul>
                    )}
                    {rowProduct && (
                      <p className="mt-1 text-[11px] text-gray-400">
                        Stock: <span className="font-medium text-gray-600">{rowProduct.quantity}</span> · COGS: <span className="font-medium text-gray-600">{formatCurrency(rowProduct.cogs)}</span>
                      </p>
                    )}
                    {isDup && <p className="mt-1 text-[11px] text-red-600">Already added in another row</p>}
                  </div>
                  <div className="sm:col-span-2">
                    {idx === 0 && <label className="form-label sm:hidden">Qty</label>}
                    <input type="number" min="1" className="form-input" placeholder="Qty" value={row.qty}
                      onChange={e => updateRow(row.key, { qty: e.target.value })} />
                  </div>
                  {tab === 'IN' && (
                    <div className="sm:col-span-3">
                      {idx === 0 && <label className="form-label sm:hidden">Cost per Unit</label>}
                      <input type="number" min="0" step="0.01" className="form-input" placeholder="₱0.00 (optional)" value={row.unitCost}
                        onChange={e => updateRow(row.key, { unitCost: e.target.value })} />
                    </div>
                  )}
                  <div className={`${tab === 'IN' ? 'sm:col-span-2' : 'sm:col-span-5'} flex sm:justify-end`}>
                    <button type="button" onClick={() => removeBulkRow(row.key)} disabled={bulkRows.length === 1}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 p-2">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" onClick={addBulkRow} className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-800 font-medium">
            <Plus size={15} /> Add Row
          </button>

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={submitting}
              className={`btn-primary ${tab === 'OUT' ? '!bg-red-600 hover:!bg-red-700' : '!bg-green-600 hover:!bg-green-700'} disabled:opacity-50`}
            >
              {submitting ? 'Saving...' : `Save Stock ${tab} (${activeBulkRows.length || 0} item${activeBulkRows.length === 1 ? '' : 's'})`}
            </button>
          </div>
        </form>
      ) : (
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
      )}

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

      {bulkConfirmCogs && (
        <Modal open onClose={() => setBulkConfirmCogs(null)} title="Update COGS?" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {bulkConfirmCogs.length} product{bulkConfirmCogs.length === 1 ? '' : 's'} will have its COGS updated:
            </p>
            <div className="bg-gray-50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
              {bulkConfirmCogs.map((c, i) => (
                <div key={i} className="text-sm">
                  <p className="font-medium text-gray-800">{c.sku} — {c.name}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">{formatCurrency(c.oldCogs)}</span>
                    <span className="font-bold text-green-700 tabular-nums">→ {formatCurrency(c.newCogs)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkConfirmCogs(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => { setBulkConfirmCogs(null); bulkSave(activeBulkRows); }} className="btn-primary">Confirm</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
