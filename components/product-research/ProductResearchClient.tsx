'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, LayoutGrid, Table, Settings } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import KanbanBoard from './KanbanBoard';
import ResearchTable from './ResearchTable';
import ResearchForm from './ResearchForm';
import StatusManager from './StatusManager';
import type { ResearchStatusRecord } from './StatusManager';

export type ResearchStatus = string;

export interface ResearchItem {
  id: number; product_name: string; image_ready: number;
  google_link: string | null; drive_link: string | null;
  cogs: number | null; srp: number | null;
  fb_page_name: string | null; fb_page_admin: string | null;
  supplier_details: string | null; objectives: string | null;
  webcake_warehouse: number; add_to_warehouse: number; gsheet_monitoring: number;
  promo: string | null;
  status: ResearchStatus; created_at: string;
}

export default function ProductResearchClient() {
  const [items, setItems]       = useState<ResearchItem[]>([]);
  const [statuses, setStatuses] = useState<ResearchStatusRecord[]>([]);
  const [view, setView]         = useState<'kanban' | 'table'>('kanban');
  const [showAdd, setShowAdd]   = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<ResearchStatus>('For Research');
  const [editing, setEditing]   = useState<ResearchItem | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchItems = useCallback(async () => {
    const data = await fetch('/api/product-research').then(r => r.json());
    setItems(data);
  }, []);

  const fetchStatuses = useCallback(async () => {
    const data = await fetch('/api/research-statuses').then(r => r.json());
    setStatuses(data);
  }, []);

  useEffect(() => {
    fetchItems();
    fetchStatuses();
  }, [fetchItems, fetchStatuses]);

  const handleDelete = async (id: number) => {
    await fetch(`/api/product-research/${id}`, { method: 'DELETE' });
    showToast('Product deleted');
    fetchItems();
  };

  const handleStatusChange = async (id: number, status: ResearchStatus) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    await fetch(`/api/product-research/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...item, status }),
    });
    fetchItems();
  };

  const firstStatus = statuses[0]?.name ?? 'For Research';

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Research</h1>
          <p className="text-sm text-gray-500 mt-1">Track products from research to launch</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-orange-500 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
            <button
              onClick={() => setView('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'table' ? 'bg-orange-500 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Table size={14} /> Table
            </button>
          </div>

          {/* Manage Statuses */}
          <button
            onClick={() => setShowManage(true)}
            className="btn-secondary text-xs"
            title="Manage statuses"
          >
            <Settings size={15} /> Statuses
          </button>

          {/* Add Product */}
          <button onClick={() => { setDefaultStatus(firstStatus); setShowAdd(true); }} className="btn-primary">
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <KanbanBoard
          items={items}
          statuses={statuses}
          onStatusChange={handleStatusChange}
          onEdit={setEditing}
          onDelete={handleDelete}
          onAddToColumn={(status) => { setDefaultStatus(status); setShowAdd(true); }}
          onRefresh={fetchItems}
        />
      ) : (
        <ResearchTable
          items={items}
          statuses={statuses}
          onEdit={setEditing}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* Manage Statuses Modal */}
      <Modal open={showManage} onClose={() => setShowManage(false)} title="Manage Statuses" size="md">
        <StatusManager onChanged={() => { fetchStatuses(); fetchItems(); }} />
      </Modal>

      {/* Add / Edit Modal */}
      <Modal
        open={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        title={editing ? 'Edit Product' : 'Add Product for Research'}
        size="lg"
      >
        <ResearchForm
          initial={editing ?? undefined}
          defaultStatus={!editing ? defaultStatus : undefined}
          statuses={statuses}
          onSuccess={() => {
            setShowAdd(false); setEditing(null);
            showToast(editing ? 'Product updated' : 'Product added');
            fetchItems();
          }}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
        />
      </Modal>
    </div>
  );
}
