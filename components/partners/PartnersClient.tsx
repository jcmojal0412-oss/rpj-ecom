'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Pencil, Trash2, Phone, Mail, Building2, Users } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import PartnerForm from './PartnerForm';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency } from '@/lib/utils';
import GrossSales from './GrossSales';

export interface Partner {
  id: number; name: string; contact: string | null; schedule: string | null;
  remarks: string | null; subscription: string | null; price: number;
  assist_by: string | null; commission: string | null; referred_by: string | null;
  contract_signing: string | null; onboarding: string | null; start_ads: string | null;
  company_name: string | null; email: string | null;
  bank: string | null; acct_name: string | null; acct_number: string | null;
  notes: string | null; created_at: string;
}

const STATUS_FILTERS = ['ALL', 'DONE', 'PENDING', 'NO SHOW'];

type DatePeriod = 'today' | 'yesterday' | '7days' | 'this_month' | 'last_month' | 'lifetime';

const DATE_FILTERS: { key: DatePeriod; label: string }[] = [
  { key: 'today',      label: 'Today'       },
  { key: 'yesterday',  label: 'Yesterday'   },
  { key: '7days',      label: 'Last 7 Days' },
  { key: 'this_month', label: 'This Month'  },
  { key: 'last_month', label: 'Last Month'  },
  { key: 'lifetime',   label: 'Lifetime'    },
];

function filterByPeriod(partners: Partner[], period: DatePeriod): Partner[] {
  if (period === 'lifetime') return partners;
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return partners.filter(p => {
    const raw = p.schedule || p.created_at;
    if (!raw) return period === 'lifetime';
    const d = new Date(raw);

    if (period === 'today') {
      return d >= today;
    }
    if (period === 'yesterday') {
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      return d >= yest && d < today;
    }
    if (period === '7days') {
      const week = new Date(today); week.setDate(week.getDate() - 7);
      return d >= week;
    }
    if (period === 'this_month') {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (period === 'last_month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    return true;
  });
}

const remarksBadge = (r: string | null) => {
  if (!r) return <span className="badge-gray">—</span>;
  if (r === 'DONE')    return <span className="badge-green">✓ DONE</span>;
  if (r === 'NO SHOW') return <span className="badge-red">NO SHOW</span>;
  return <span className="badge-amber">PENDING</span>;
};

const stageBadge = (v: string | null, labels: [string, string]) => {
  if (!v) return <span className="text-gray-300 text-xs">—</span>;
  if (v === 'DONE' || v === 'START') return <span className="text-green-600 text-xs font-semibold">✓</span>;
  return <span className="text-amber-500 text-xs font-semibold">⏳</span>;
};

export default function PartnersClient() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('ALL');
  const [datePeriod, setDatePeriod] = useState<DatePeriod>('lifetime');
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<Partner | null>(null);
  const [deleting, setDeleting] = useState<Partner | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (filter !== 'ALL') params.set('status', filter);
    const data = await fetch(`/api/partners?${params}`).then(r => r.json());
    setPartners(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, filter]);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const handleDelete = async (p: Partner) => {
    await fetch(`/api/partners/${p.id}`, { method: 'DELETE' });
    setDeleting(null);
    showToast(`${p.name} removed`);
    fetchPartners();
  };

  // Apply date filter for KPIs
  const filteredByDate = filterByPeriod(partners, datePeriod);

  // KPIs
  const total      = filteredByDate.length;
  const onboarded  = filteredByDate.filter(p => p.onboarding === 'DONE').length;
  const adsRunning = filteredByDate.filter(p => p.start_ads === 'START').length;
  const totalRev   = filteredByDate.reduce((s, p) => s + (p.price || 0), 0);

  const subColors: Record<string, string> = {
    'ELITE WV':           'bg-purple-100 text-purple-700',
    'STARTER WV':         'bg-blue-100 text-blue-700',
    'OLD PARTNER STARTER':'bg-gray-100 text-gray-600',
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SEDO Partners</h1>
          <p className="text-sm text-gray-500 mt-1">Discovery calls, onboarding, and partner records</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Add Partner
        </button>
      </div>

      {/* Date Period Filter */}
      <div className="flex flex-wrap gap-1.5">
        {DATE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDatePeriod(key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              datePeriod === key
                ? 'bg-orange-500 text-white shadow-sm shadow-orange-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card text-center">
          <Users size={20} className="text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{total}</p>
          <p className="text-xs text-gray-500">Total Partners</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-700">{onboarded}</p>
          <p className="text-xs text-gray-500">Onboarded</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-600">{adsRunning}</p>
          <p className="text-xs text-gray-500">Ads Running</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalRev)}</p>
          <p className="text-xs text-gray-500">Total Subscriptions</p>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
          <input className="form-input pl-9" placeholder="Search name, company, email..."
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
        <span className="text-xs text-gray-400">{partners.length} records</span>
      </div>

      {/* Partners Table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : partners.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">No partners found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Name / Company','Contact','Subscription','Call','Contract','Onboard','Ads','Commission','Actions'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partners.map((p, i) => (
                <>
                  <tr key={p.id}
                    className={`cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-orange-50`}
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    <td className="table-cell">
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      {p.company_name && <p className="text-xs text-gray-500">{p.company_name}</p>}
                    </td>
                    <td className="table-cell text-gray-500 text-xs">{p.contact ?? '—'}</td>
                    <td className="table-cell">
                      {p.subscription ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${subColors[p.subscription] ?? 'bg-gray-100 text-gray-600'}`}>
                          {p.subscription}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="table-cell">{remarksBadge(p.remarks)}</td>
                    <td className="table-cell text-center">{stageBadge(p.contract_signing, ['DONE',''])}</td>
                    <td className="table-cell text-center">{stageBadge(p.onboarding, ['DONE',''])}</td>
                    <td className="table-cell text-center">{stageBadge(p.start_ads, ['START',''])}</td>
                    <td className="table-cell text-xs text-gray-600">{p.commission ?? '—'}</td>
                    <td className="table-cell">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditing(p)} className="p-1.5 rounded hover:bg-orange-50 text-gray-400 hover:text-orange-500">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setDeleting(p)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded detail row */}
                  {expanded === p.id && (
                    <tr key={`exp-${p.id}`} className="bg-blue-50/50">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <p className="font-semibold text-gray-500 mb-1">CONTACT</p>
                            {p.contact && <p className="flex items-center gap-1"><Phone size={11} /> {p.contact}</p>}
                            {p.email && <p className="flex items-center gap-1 mt-1"><Mail size={11} /> {p.email}</p>}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-500 mb-1">BANKING</p>
                            {p.bank && <p>{p.bank}</p>}
                            {p.acct_name && <p>{p.acct_name}</p>}
                            {p.acct_number && <p className="font-mono">{p.acct_number}</p>}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-500 mb-1">DETAILS</p>
                            {p.referred_by && <p>Referred by: <span className="font-medium">{p.referred_by}</span></p>}
                            {p.assist_by && <p>Assisted by: <span className="font-medium">{p.assist_by}</span></p>}
                            {p.subscription && <p>Plan: <span className="font-medium">{p.subscription} — {formatCurrency(p.price)}</span></p>}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-500 mb-1">SCHEDULE</p>
                            {p.schedule && <p>{new Date(p.schedule).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                            {p.notes && <p className="mt-1 text-gray-600 italic">{p.notes}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Gross Sales Section */}
      <div className="card">
        <GrossSales />
      </div>

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Partner" size="lg">
        <PartnerForm onSuccess={() => { setShowAdd(false); showToast('Partner added!'); fetchPartners(); }} onCancel={() => setShowAdd(false)} />
      </Modal>

      {/* Edit Modal */}
      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Partner" size="lg">
          <PartnerForm initial={editing} onSuccess={() => { setEditing(null); showToast('Partner updated!'); fetchPartners(); }} onCancel={() => setEditing(null)} />
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove Partner" size="sm">
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
