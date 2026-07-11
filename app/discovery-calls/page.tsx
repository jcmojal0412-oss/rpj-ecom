'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Pencil, Trash2, Phone, Calendar, MessageSquare } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import PartnerForm from '@/components/partners/PartnerForm';
import SendSmsModal from '@/components/partners/SendSmsModal';
import Spinner from '@/components/ui/Spinner';
import type { Partner } from '@/components/partners/PartnersClient';

const STATUS_FILTERS = ['ALL', 'DONE', 'PENDING', 'NO SHOW'];

const remarksBadge = (r: string | null) => {
  if (!r)              return <span className="badge-gray">—</span>;
  if (r === 'DONE')    return <span className="badge-green">✓ DONE</span>;
  if (r === 'NO SHOW') return <span className="badge-red">NO SHOW</span>;
  return <span className="badge-amber">⏳ PENDING</span>;
};

export default function DiscoveryCallsPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('ALL');
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<Partner | null>(null);
  const [deleting, setDeleting] = useState<Partner | null>(null);
  const [smsTarget, setSmsTarget] = useState<Partner | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (filter !== 'ALL') params.set('status', filter);
    params.set('type', 'discovery');
    const data = await fetch(`/api/partners?${params}`).then(r => r.json());
    // Filter: not yet fully onboarded
    const calls = (Array.isArray(data) ? data : []).filter(
      (p: Partner) => !p.onboarding || p.onboarding !== 'DONE'
    );
    setPartners(calls);
    setLoading(false);
  }, [search, filter]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  const handleDelete = async (p: Partner) => {
    await fetch(`/api/partners/${p.id}`, { method: 'DELETE' });
    setDeleting(null);
    showToast(`${p.name} removed`);
    fetchCalls();
  };

  const total   = partners.length;
  const done    = partners.filter(p => p.remarks === 'DONE').length;
  const pending = partners.filter(p => p.remarks === 'PENDING').length;
  const noShow  = partners.filter(p => p.remarks === 'NO SHOW').length;

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Discovery Calls</h1>
          <p className="text-sm text-gray-500 mt-1">Prospects and scheduled discovery calls</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{total}</p>
          <p className="text-xs text-gray-500">Total Leads</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-700">{done}</p>
          <p className="text-xs text-gray-500">Call Done</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-amber-600">{pending}</p>
          <p className="text-xs text-gray-500">Pending</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600">{noShow}</p>
          <p className="text-xs text-gray-500">No Show</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
          <input className="form-input pl-9" placeholder="Search name, contact..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === f ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{f}</button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{partners.length} leads</span>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : partners.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="mx-auto text-gray-300 mb-3" size={32} />
            <p className="text-gray-400 text-sm">No discovery calls found.</p>
            <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">
              <Plus size={16} /> Add First Lead
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Name','Contact','Schedule','Status','Subscription','Actions'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partners.map((p, i) => (
                <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="table-cell">
                    <p className="font-semibold text-gray-900">{p.name}</p>
                    {p.company_name && <p className="text-xs text-gray-400">{p.company_name}</p>}
                  </td>
                  <td className="table-cell text-xs text-gray-500">
                    {p.contact ? (
                      <a href={`tel:${p.contact}`} className="flex items-center gap-1 hover:text-orange-500">
                        <Phone size={11} /> {p.contact}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="table-cell text-xs text-gray-500">
                    {p.schedule ? new Date(p.schedule).toLocaleDateString('en-PH', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    }) : '—'}
                  </td>
                  <td className="table-cell">{remarksBadge(p.remarks)}</td>
                  <td className="table-cell">
                    {p.subscription ? (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {p.subscription}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={() => setSmsTarget(p)}
                        className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-500">
                        <MessageSquare size={13} />
                      </button>
                      <button onClick={() => setEditing(p)}
                        className="p-1.5 rounded hover:bg-orange-50 text-gray-400 hover:text-orange-500">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setDeleting(p)}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Lead" size="lg">
        <PartnerForm
          onSuccess={() => { setShowAdd(false); showToast('Lead added!'); fetchCalls(); }}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Modal */}
      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Lead" size="lg">
          <PartnerForm
            initial={editing}
            onSuccess={() => { setEditing(null); showToast('Updated!'); fetchCalls(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* Send SMS */}
      {smsTarget && (
        <SendSmsModal
          recipient={smsTarget}
          onClose={() => setSmsTarget(null)}
          onSent={() => { setSmsTarget(null); showToast('SMS sent!'); }}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove Lead" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">Sure ka bang i-remove si <span className="font-semibold">{deleting.name}</span>?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleDelete(deleting)} className="btn-danger"><Trash2 size={14} /> Remove</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
