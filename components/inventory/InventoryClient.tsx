'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import StockForm from './StockForm';
import MovementLog from './MovementLog';
import Spinner from '@/components/ui/Spinner';

interface InventoryItem {
  id: number; sku: string; name: string; category: string;
  cogs: number; srp: number; quantity: number; reorder_point: number;
  last_updated: string;
}

const PAGE_SIZE = 20;

export default function InventoryClient() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filtered, setFiltered] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editingReorder, setEditingReorder] = useState<number | null>(null);
  const [reorderVal, setReorderVal] = useState('');
  const [editingStock, setEditingStock] = useState<number | null>(null);
  const [stockVal, setStockVal] = useState('');
  const { toast, showToast, clearToast } = useToast();

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/inventory').then(r => r.json());
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(items.filter(i =>
      i.sku.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q) ||
      (i.category ?? '').toLowerCase().includes(q)
    ));
    setPage(1);
  }, [search, items]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const saveReorder = async (id: number) => {
    await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder_point: parseInt(reorderVal) }),
    });
    setEditingReorder(null);
    showToast('Reorder point updated');
    fetchInventory();
  };

  const saveStock = async (id: number) => {
    const quantity = parseInt(stockVal);
    if (isNaN(quantity) || quantity < 0) return;
    await fetch('/api/inventory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: id, quantity }),
    });
    setEditingStock(null);
    showToast('Stock updated');
    fetchInventory();
  };

  const statusBadge = (qty: number, reorder: number) => {
    if (qty === 0) return <span className="badge-red">Out of Stock</span>;
    if (qty <= reorder) return <span className="badge-amber">Low Stock</span>;
    return <span className="badge-green">OK</span>;
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <p className="text-sm text-gray-500 mt-1">Manage stock levels and movements</p>
      </div>

      {/* Stock In / Stock Out Form */}
      <StockForm products={items} onSuccess={() => { fetchInventory(); showToast('Stock movement saved!'); }} />

      {/* Inventory Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="text-base font-semibold text-gray-900 shrink-0">Inventory Table</h2>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
            <input
              className="form-input pl-9"
              placeholder="Search SKU, name, category..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['SKU','Product Name','Category','COGS','SRP','Stock','Reorder Pt.','Status','Actions'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-gray-400 text-sm">
                        No products found.
                      </td>
                    </tr>
                  ) : paged.map((item, i) => (
                    <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="table-cell font-mono text-xs font-semibold text-gray-600">{item.sku}</td>
                      <td className="table-cell font-medium">{item.name}</td>
                      <td className="table-cell text-gray-500">{item.category}</td>
                      <td className="table-cell">{formatCurrency(item.cogs)}</td>
                      <td className="table-cell">{formatCurrency(item.srp)}</td>
                      <td className="table-cell text-right">
                        {editingStock === item.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min={0}
                              className="w-20 form-input py-1 text-xs"
                              value={stockVal}
                              onChange={e => setStockVal(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => saveStock(item.id)} className="text-orange-500 hover:text-orange-700 text-xs font-medium">Save</button>
                            <button onClick={() => setEditingStock(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                          </div>
                        ) : <span className="font-semibold">{item.quantity}</span>}
                      </td>
                      <td className="table-cell text-right">
                        {editingReorder === item.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              className="w-16 form-input py-1 text-xs"
                              value={reorderVal}
                              onChange={e => setReorderVal(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => saveReorder(item.id)} className="text-orange-500 hover:text-orange-700 text-xs font-medium">Save</button>
                            <button onClick={() => setEditingReorder(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                          </div>
                        ) : item.reorder_point}
                      </td>
                      <td className="table-cell">{statusBadge(item.quantity, item.reorder_point)}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingStock(item.id); setStockVal(String(item.quantity)); }}
                            className="text-xs text-orange-600 hover:text-orange-800 font-medium"
                          >
                            Edit Stock
                          </button>
                          <button
                            onClick={() => { setEditingReorder(item.id); setReorderVal(String(item.reorder_point)); }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Edit Reorder
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm px-2">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Movement Log */}
      <MovementLog />
    </div>
  );
}
