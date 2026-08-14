'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Megaphone } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { computeCAC, computeConversionRate, computeROAS, computeAvgSpendPerBuyer } from '@/lib/marketing-analytics';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';

interface Record {
  id: number;
  entry_date: string;
  marketing_spend: number;
  gross_sales: number;
  total_buyers: number;
  new_customers: number;
  store_visits: number;
  notes: string | null;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(2)}%`;
}
function money(n: number | null): string {
  return n == null ? '—' : formatCurrency(n);
}
function times(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(2)}x`;
}

export default function DailyRecordsClient() {
  const { toast, showToast, clearToast } = useToast();
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record | null>(null);
  const [deleting, setDeleting] = useState<Record | null>(null);

  const fetchRecords = () => {
    setLoading(true);
    fetch('/api/marketing-analytics/records').then(r => r.json()).then(d => {
      setRecords(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  useEffect(fetchRecords, []);

  const handleDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/marketing-analytics/records/${deleting.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Record deleted');
      setDeleting(null);
      fetchRecords();
    } else {
      showToast('Failed to delete', 'error');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#233653]">Daily Records</h1>
          <p className="text-sm text-gray-500 mt-1">Enter each day's marketing spend, sales, buyers, and store visits — CAC, conversion, and ROAS are calculated automatically.</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#233653] hover:bg-[#1b2941] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> Add Record
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : records.length === 0 ? (
          <div className="text-center py-16">
            <Megaphone className="mx-auto text-gray-200 mb-3" size={36} />
            <p className="text-sm text-gray-400">No marketing records yet. Add your first daily entry to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Marketing Spend</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Gross Sales</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Buyers</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">New Customers</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">CAC</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Visits</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Conversion</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">ROAS</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Notes</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatCurrency(r.marketing_spend)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(r.gross_sales)}</td>
                    <td className="px-4 py-3 text-gray-700">{r.total_buyers.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700">{r.new_customers.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{money(computeCAC(r.marketing_spend, r.new_customers))}</td>
                    <td className="px-4 py-3 text-gray-700">{r.store_visits.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{pct(computeConversionRate(r.total_buyers, r.store_visits))}</td>
                    <td className="px-4 py-3 text-[#B68B3C] font-semibold whitespace-nowrap">{times(computeROAS(r.gross_sales, r.marketing_spend))}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[180px] truncate">{r.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditing(r); setShowForm(true); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Daily Record' : 'Add Daily Record'} size="md">
          <RecordForm
            record={editing}
            existingDates={records.filter(r => r.id !== editing?.id).map(r => r.entry_date)}
            onCancel={() => setShowForm(false)}
            onSaved={() => { setShowForm(false); showToast(editing ? 'Record updated!' : 'Record saved!'); fetchRecords(); }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete Record" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Delete marketing record for {formatDate(deleting.entry_date)}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RecordForm({ record, existingDates, onCancel, onSaved }: {
  record: Record | null;
  existingDates: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [entryDate, setEntryDate] = useState(record?.entry_date ?? todayISO());
  const [marketingSpend, setMarketingSpend] = useState(record ? String(record.marketing_spend) : '');
  const [grossSales, setGrossSales] = useState(record ? String(record.gross_sales) : '');
  const [totalBuyers, setTotalBuyers] = useState(record ? String(record.total_buyers) : '');
  const [newCustomers, setNewCustomers] = useState(record ? String(record.new_customers) : '');
  const [storeVisits, setStoreVisits] = useState(record ? String(record.store_visits) : '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spend = parseFloat(marketingSpend) || 0;
  const sales = parseFloat(grossSales) || 0;
  const buyers = parseInt(totalBuyers, 10) || 0;
  const newCust = parseInt(newCustomers, 10) || 0;
  const visits = parseInt(storeVisits, 10) || 0;

  const newCustExceedsWarning = newCustomers !== '' && newCust > buyers;
  const dateAlreadyUsed = !record && existingDates.includes(entryDate);

  const canSave = marketingSpend !== '' && grossSales !== '' && totalBuyers !== '' && newCustomers !== '' && storeVisits !== ''
    && !newCustExceedsWarning && !dateAlreadyUsed;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        entry_date: entryDate,
        marketing_spend: spend,
        gross_sales: sales,
        total_buyers: buyers,
        new_customers: newCust,
        store_visits: visits,
        notes: notes || null,
      };
      const res = await fetch(
        record ? `/api/marketing-analytics/records/${record.id}` : '/api/marketing-analytics/records',
        {
          method: record ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (res.ok) {
        onSaved();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to save record.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input type="date" className="form-input" value={entryDate} max={todayISO()} onChange={e => setEntryDate(e.target.value)} />
          {dateAlreadyUsed && <p className="text-xs text-red-600 mt-1">A record for this date already exists — edit it instead.</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Marketing / Ads Spend (₱)</label>
          <input type="number" min={0} step="0.01" className="form-input" value={marketingSpend} onChange={e => setMarketingSpend(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Gross Sales (₱)</label>
          <input type="number" min={0} step="0.01" className="form-input" value={grossSales} onChange={e => setGrossSales(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Total Buyers</label>
          <input type="number" min={0} step="1" className="form-input" value={totalBuyers} onChange={e => setTotalBuyers(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">New Customers</label>
          <input type="number" min={0} step="1" className="form-input" value={newCustomers} onChange={e => setNewCustomers(e.target.value)} />
          {newCustExceedsWarning && <p className="text-xs text-red-600 mt-1">New customers cannot exceed total buyers.</p>}
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Store Visits</label>
          <input type="number" min={0} step="1" className="form-input" value={storeVisits} onChange={e => setStoreVisits(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
          <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Facebook campaign + walk-ins" />
        </div>
      </div>

      {/* Live-computed preview — these are never manually entered */}
      <div className="bg-[#FBF8F1] border border-[#E9DFC7] rounded-lg p-3 grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">CAC</span><span className="font-semibold text-gray-800">{money(computeCAC(spend, newCust))}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Conversion Rate</span><span className="font-semibold text-gray-800">{pct(computeConversionRate(buyers, visits))}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">ROAS</span><span className="font-semibold text-[#B68B3C]">{times(computeROAS(sales, spend))}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Avg. Spend / Buyer</span><span className="font-semibold text-gray-800">{money(computeAvgSpendPerBuyer(sales, buyers))}</span></div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
