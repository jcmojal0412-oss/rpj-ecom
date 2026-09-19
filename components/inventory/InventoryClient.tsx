'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, FileSpreadsheet, ClipboardList, Wrench, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import ImportModal from '@/components/products/ImportModal';
import BulkCountImportModal from './BulkCountImportModal';
import StockForm from './StockForm';
import MovementLog from './MovementLog';
import NegativeStockPanel from './NegativeStockPanel';
import SlowMovingPanel from './SlowMovingPanel';
import PhysicalCountModal from './PhysicalCountModal';
import CountHistoryPanel from './CountHistoryPanel';
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
  const [countingItem, setCountingItem] = useState<InventoryItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showBulkCount, setShowBulkCount] = useState(false);
  const [movementRefreshKey, setMovementRefreshKey] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [bugAffectedCount, setBugAffectedCount] = useState(0);
  const [bugMissedUnits, setBugMissedUnits] = useState(0);
  const [fixingBug, setFixingBug] = useState(false);
  const [checkingBug, setCheckingBug] = useState(false);
  const [bugChecked, setBugChecked] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/inventory').then(r => r.json());
    setItems(data);
    setLoading(false);
    // Every action that refetches inventory (Stock IN/OUT, Count Stock,
    // Bulk Import) can also have just written a stock_movements row — bump
    // this so the Movement Log below picks it up without a manual reload.
    setMovementRefreshKey(k => k + 1);
  }, []);

  // Owner-only: recomputes every product's true quantity from the full
  // stock_movements ledger and flags any that drift from the stored
  // inventory.quantity (see app/api/inventory/fix-pos-deduction-bug) — safe
  // to run any number of times since it always lands on the same correct
  // absolute number, not a relative adjustment.
  const fetchBugStatus = useCallback(async () => {
    setCheckingBug(true);
    try {
      const d = await fetch('/api/inventory/fix-pos-deduction-bug').then(r => r.ok ? r.json() : null);
      if (!d) return;
      const affected = Array.isArray(d.affected) ? d.affected : [];
      setBugAffectedCount(affected.length);
      setBugMissedUnits(affected.reduce((s: number, r: { current_stock: number; true_quantity: number }) => s + Math.abs(r.true_quantity - r.current_stock), 0));
      setBugChecked(true);
    } finally {
      setCheckingBug(false);
    }
  }, []);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);
  useEffect(() => {
    // Deliberately NOT auto-running fetchBugStatus here — it recomputes
    // every product's true quantity from its FULL stock_movements history
    // (no date bound is possible without losing correctness), which got
    // noticeably heavier as more sales history piled up. It was worth
    // paying that cost on every page load while the underlying checkout
    // bug was still fresh and drift could reappear; now that it's fixed,
    // ongoing drift shouldn't happen, so this is a manual "Check for stock
    // drift" action instead (see the button below) rather than a standing
    // tax on every single Inventory page visit.
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => setIsOwner(u?.role === 'owner'));
  }, []);

  const runFixBug = async () => {
    setFixingBug(true);
    try {
      const res = await fetch('/api/inventory/fix-pos-deduction-bug', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'Failed to correct stock', 'error'); return; }
      showToast(`Corrected stock for ${d.corrected} product${d.corrected === 1 ? '' : 's'}!`);
      await fetchInventory();
      await fetchBugStatus();
    } finally {
      setFixingBug(false);
    }
  };

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

  const statusBadge = (qty: number, reorder: number) => {
    // Physically impossible — flagged distinctly from a plain "Out of
    // Stock" 0 so it doesn't get mistaken for a normal restock-needed item.
    if (qty < 0) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">Negative</span>;
    if (qty === 0) return <span className="badge-red">Out of Stock</span>;
    if (qty <= reorder) return <span className="badge-amber">Low Stock</span>;
    return <span className="badge-green">OK</span>;
  };

  // Stock is changed only through the Count Stock dialog (expected vs counted,
  // reason, who) — never edited inline — so every correction leaves a record.
  const stockCell = (item: InventoryItem) => <span className="font-semibold">{item.quantity}</span>;

  const reorderCell = (item: InventoryItem, align: 'start' | 'end') => (
    editingReorder === item.id ? (
      <div className={`flex items-center gap-1 ${align === 'end' ? 'justify-end' : ''}`}>
        <input
          type="number"
          className="w-16 form-input py-1 text-xs"
          value={reorderVal}
          onChange={e => setReorderVal(e.target.value)}
          autoFocus
        />
        <button onClick={() => saveReorder(item.id)} className="px-1.5 py-2 md:p-0 text-orange-500 hover:text-orange-700 text-xs font-medium">Save</button>
        <button onClick={() => setEditingReorder(null)} className="px-1.5 py-2 md:p-0 text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
    ) : <>{item.reorder_point}</>
  );

  const rowActions = (item: InventoryItem, big: boolean) => {
    const pad = big ? 'py-2.5 pr-2' : '';
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCountingItem(item)}
          className={`${pad} text-xs text-orange-600 hover:text-orange-800 font-medium`}
        >
          Count Stock
        </button>
        <button
          onClick={() => { setEditingReorder(item.id); setReorderVal(String(item.reorder_point)); }}
          className={`${pad} text-xs text-blue-600 hover:text-blue-800 font-medium`}
        >
          Edit Reorder
        </button>
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">Manage stock levels and movements</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && !bugChecked && (
            <button onClick={fetchBugStatus} disabled={checkingBug} className="btn-secondary text-xs min-h-[44px] sm:min-h-0 disabled:opacity-50">
              {checkingBug ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
              {checkingBug ? 'Checking...' : 'Check for stock drift'}
            </button>
          )}
          <button onClick={() => setShowBulkCount(true)} className="btn-secondary min-h-[44px] sm:min-h-0">
            <ClipboardList size={16} /> Bulk Stock Count
          </button>
          <button onClick={() => setShowImport(true)} className="btn-secondary min-h-[44px] sm:min-h-0">
            <FileSpreadsheet size={16} /> Bulk Import (Excel)
          </button>
        </div>
      </div>

      {isOwner && bugChecked && bugAffectedCount === 0 && (
        <p className="text-xs text-gray-400">✓ No stock drift found — every product matches its movement history.</p>
      )}

      {isOwner && bugAffectedCount > 0 && (
        <div className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-2 border-red-200 bg-red-50">
          <div className="flex items-center gap-2.5">
            <Wrench className="text-red-600 shrink-0" size={18} />
            <p className="text-sm text-red-800">
              <strong>{bugAffectedCount} product{bugAffectedCount === 1 ? '' : 's'}</strong> ({bugMissedUnits} unit{bugMissedUnits === 1 ? '' : 's'} total difference)
              don&apos;t match their true stock movement history (from the Aug 29–Sep 7 checkout bug, and any leftover drift from correcting it).
              This resets each one to exactly what its movement log says — safe to run again if needed, and doesn&apos;t touch any sale record.
            </p>
          </div>
          <button onClick={runFixBug} disabled={fixingBug} className="btn-primary text-xs py-2.5 sm:py-1.5 justify-center shrink-0 disabled:opacity-50 bg-red-600 hover:bg-red-700">
            {fixingBug ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
            {fixingBug ? 'Correcting...' : 'Correct Stock Now'}
          </button>
        </div>
      )}

      {/* Negative Stock — physically impossible, needs a real recount */}
      <NegativeStockPanel refreshKey={movementRefreshKey} />

      {/* Slow Moving / Dead Stock — what to prioritize pushing to move */}
      <SlowMovingPanel refreshKey={movementRefreshKey} />

      {/* Stock In / Stock Out Form */}
      <StockForm products={items} onSuccess={fetchInventory} />

      {/* Inventory Table */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
          <h2 className="text-base font-semibold text-gray-900 shrink-0">Inventory Table</h2>
          <div className="relative flex-1 w-full sm:max-w-xs">
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
            <div className="hidden md:block overflow-x-auto">
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
                      <td className="table-cell text-right">{stockCell(item)}</td>
                      <td className="table-cell text-right">{reorderCell(item, 'start')}</td>
                      <td className="table-cell">{statusBadge(item.quantity, item.reorder_point)}</td>
                      <td className="table-cell">{rowActions(item, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: the 9-column table can't fit, so each product becomes a
                card with the same Count Stock / Edit Reorder controls. */}
            <div className="md:hidden space-y-2.5">
              {paged.length === 0 ? (
                <p className="text-center py-10 text-gray-400 text-sm">No products found.</p>
              ) : paged.map(item => (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-gray-500">{item.sku}</p>
                      <p className="text-sm font-semibold text-gray-900 break-words">{item.name}</p>
                      {item.category && <p className="text-xs text-gray-500">{item.category}</p>}
                    </div>
                    <div className="shrink-0">{statusBadge(item.quantity, item.reorder_point)}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                    <span>COGS <span className="font-medium text-gray-800">{formatCurrency(item.cogs)}</span></span>
                    <span>SRP <span className="font-medium text-gray-800">{formatCurrency(item.srp)}</span></span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">Stock</p>
                      <div className="text-sm">{stockCell(item)}</div>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">Reorder Pt.</p>
                      <div className="text-sm">{reorderCell(item, 'start')}</div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100">{rowActions(item, true)}</div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-2.5 lg:p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm px-2">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-2.5 lg:p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Count history — expected vs counted, accuracy, repeat offenders */}
      <CountHistoryPanel refreshKey={movementRefreshKey} />

      {/* Movement Log */}
      <MovementLog refreshKey={movementRefreshKey} onVoided={() => { showToast('Entry voided — stock updated'); fetchInventory(); }} />

      {/* Count Stock Modal */}
      {countingItem && (
        <Modal open onClose={() => setCountingItem(null)} title="Count Stock" size="sm">
          <PhysicalCountModal
            item={countingItem}
            onCancel={() => setCountingItem(null)}
            onSaved={({ variance }) => {
              setCountingItem(null);
              showToast(variance === 0 ? 'Count recorded — matches the system' : `Count recorded — stock adjusted by ${variance > 0 ? '+' : '−'}${Math.abs(variance)}`);
              fetchInventory();
            }}
          />
        </Modal>
      )}

      {/* Bulk Import Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Bulk Import Products via Excel" size="md">
        <ImportModal
          onSuccess={() => { showToast('Products imported successfully!'); fetchInventory(); }}
          onClose={() => setShowImport(false)}
        />
      </Modal>

      {/* Bulk Stock Count Modal */}
      <Modal open={showBulkCount} onClose={() => setShowBulkCount(false)} title="Bulk Stock Count" size="md">
        <BulkCountImportModal
          onSuccess={() => { showToast('Stock counts updated!'); fetchInventory(); }}
          onClose={() => setShowBulkCount(false)}
        />
      </Modal>
    </div>
  );
}
