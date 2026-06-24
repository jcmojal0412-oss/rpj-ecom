'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Search, FileSpreadsheet } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import ProductForm from './ProductForm';
import ImportModal from './ImportModal';
import Spinner from '@/components/ui/Spinner';

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  cogs: number;
  srp: number;
  reorder_point: number;
  created_at: string;
}

export default function ProductsClient() {
  const [products, setProducts]     = useState<Product[]>([]);
  const [filtered, setFiltered]     = useState<Product[]>([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd]       = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing]       = useState<Product | null>(null);
  const [deleting, setDeleting]     = useState<Product | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/products').then(r => r.json());
    setProducts(data);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(products.filter(p =>
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    ));
    setSelected(new Set());
  }, [search, products]);

  // ── Selection helpers ─────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  };

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Delete single ─────────────────────────────────────────────────────
  const handleDelete = async (product: Product) => {
    await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
    setDeleting(null);
    showToast(`${product.name} deleted`);
    fetchProducts();
  };

  // ── Bulk delete ───────────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    const ids = [...selected];
    await fetch('/api/products/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    setBulkConfirm(false);
    showToast(`${ids.length} product${ids.length !== 1 ? 's' : ''} deleted`);
    fetchProducts();
  };

  // ── Category chips ────────────────────────────────────────────────────
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
  const categoryCounts = categories.map(cat => ({
    cat,
    count: products.filter(p => p.category === cat).length,
  }));

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your product catalog</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            <FileSpreadsheet size={16} /> Import Excel
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      {/* Category chips */}
      {categoryCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSearch('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !search ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({products.length})
          </button>
          {categoryCounts.map(({ cat, count }) => (
            <button
              key={cat}
              onClick={() => setSearch(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                search === cat ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                className="form-input pl-9 w-64"
                placeholder="Search SKU, name, category..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <span className="text-xs text-gray-500 shrink-0">
              {filtered.length} product{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Bulk action bar */}
          {someSelected && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              <span className="text-sm font-medium text-red-700">
                {selected.size} selected
              </span>
              <button
                onClick={() => setBulkConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                <Trash2 size={13} /> Delete Selected
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">
              {search ? `No products matching "${search}"` : 'No products yet.'}
            </p>
            {!search && (
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">
                <Plus size={16} /> Add First Product
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {/* Select-all checkbox */}
                  <th className="table-header w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400 cursor-pointer"
                    />
                  </th>
                  {['SKU','Product Name','Category','COGS','SRP','Margin','Reorder Pt.','Created','Actions'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const isSelected = selected.has(p.id);
                  const margin = p.srp > 0 ? ((p.srp - p.cogs) / p.srp * 100).toFixed(1) : null;
                  return (
                    <tr
                      key={p.id}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-blue-50'
                          : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      <td className="table-cell">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(p.id)}
                          className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400 cursor-pointer"
                        />
                      </td>
                      <td className="table-cell font-mono text-xs font-semibold text-gray-600">{p.sku}</td>
                      <td className="table-cell font-medium">{p.name}</td>
                      <td className="table-cell">
                        <span className="badge-gray">{p.category ?? '—'}</span>
                      </td>
                      <td className="table-cell">{formatCurrency(p.cogs)}</td>
                      <td className="table-cell">{formatCurrency(p.srp)}</td>
                      <td className="table-cell">
                        {margin !== null ? (
                          <span className={`font-semibold ${parseFloat(margin) >= 30 ? 'text-blue-700' : 'text-amber-600'}`}>
                            {margin}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="table-cell text-right">{p.reorder_point}</td>
                      <td className="table-cell text-gray-500 text-xs">
                        {p.created_at
                          ? new Date(p.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditing(p)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleting(p)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Bulk Import Products via Excel" size="md">
        <ImportModal
          onSuccess={() => { showToast('Products imported successfully!'); fetchProducts(); }}
          onClose={() => setShowImport(false)}
        />
      </Modal>

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Product" size="md">
        <ProductForm
          onSuccess={() => { setShowAdd(false); showToast('Product added!'); fetchProducts(); }}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Modal */}
      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Product" size="md">
          <ProductForm
            initial={editing}
            onSuccess={() => { setEditing(null); showToast('Product updated!'); fetchProducts(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* Single delete confirm */}
      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete Product" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sure ka bang i-delete ang <span className="font-semibold">{deleting.name}</span>?
              <br />
              <span className="text-red-600 text-xs mt-1 block">
                Matatanggal rin ang inventory record nito.
              </span>
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleDelete(deleting)} className="btn-danger">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk delete confirm */}
      {bulkConfirm && (
        <Modal open={bulkConfirm} onClose={() => setBulkConfirm(false)} title="Delete Selected Products" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sure ka bang i-delete ang{' '}
              <span className="font-bold text-red-700">{selected.size} product{selected.size !== 1 ? 's' : ''}</span>?
              <br />
              <span className="text-red-600 text-xs mt-1 block">
                Hindi na mabbalik ang mga ito. Inventory records din matatanggal.
              </span>
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setBulkConfirm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleBulkDelete} className="btn-danger">
                <Trash2 size={14} /> Delete {selected.size} Products
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
