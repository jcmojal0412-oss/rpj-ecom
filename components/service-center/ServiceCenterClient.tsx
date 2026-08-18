'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  BadgeDollarSign, Wallet, AlertCircle, Package, HandCoins, Wrench,
  ClipboardList, Clock,
} from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { resolveServicePeriod, shiftServiceAnchor, type ServicePeriodKey } from '@/lib/service-center';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import RepairForm from './RepairForm';
import RepairDetailsDrawer from './RepairDetailsDrawer';
import type { Repair } from './types';
import { REPAIR_STATUS_COLOR, CUSTOMER_STATUS_COLOR, ONGOING_REPAIR_STATUSES } from './types';

const PERIOD_OPTIONS: { key: ServicePeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];

const TABS = ['All Repairs', 'Ongoing', 'Completed', 'Customer Unpaid', 'Tech Unpaid'] as const;
type Tab = typeof TABS[number];

export default function ServiceCenterClient() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Repair | null>(null);
  const [deleting, setDeleting] = useState<Repair | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const [periodKey, setPeriodKey] = useState<ServicePeriodKey>('month');
  const [anchor, setAnchor] = useState(todayISO());
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [activeTab, setActiveTab] = useState<Tab>('All Repairs');

  const fetchData = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/service-repairs').then(r => r.json());
    setRepairs(data.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const range = useMemo(
    () => resolveServicePeriod(periodKey, anchor, customFrom, customTo),
    [periodKey, anchor, customFrom, customTo]
  );

  const periodRepairs = useMemo(
    () => repairs.filter(r => {
      const d = r.repair_date?.slice(0, 10) ?? '';
      return d >= range.from && d <= range.to;
    }),
    [repairs, range]
  );

  const kpis = useMemo(() => ({
    repairSales: periodRepairs.reduce((s, r) => s + r.repair_amount, 0),
    collected: periodRepairs.reduce((s, r) => s + r.collected, 0),
    customerBalance: periodRepairs.reduce((s, r) => s + r.balance, 0),
    cogs: periodRepairs.reduce((s, r) => s + r.cogs, 0),
    bns: periodRepairs.reduce((s, r) => s + r.bns_share, 0),
    techPayable: periodRepairs.reduce((s, r) => s + r.tech_payable, 0),
    total: periodRepairs.length,
    completed: periodRepairs.filter(r => r.repair_status === 'Completed').length,
    ongoing: periodRepairs.filter(r => ONGOING_REPAIR_STATUSES.includes(r.repair_status)).length,
  }), [periodRepairs]);

  // Attention Needed reflects real, current state across ALL repairs — not
  // scoped to the selected KPI period, since an old unpaid balance still
  // needs action today regardless of which period you're viewing.
  const attention = useMemo(() => {
    const outstanding = repairs.filter(r => r.balance > 0.005);
    const payoutDue = repairs.filter(r => r.tech_payout_status === 'Due');
    const ongoing = repairs.filter(r => ONGOING_REPAIR_STATUSES.includes(r.repair_status));
    const waitingParts = repairs.filter(r => r.repair_status === 'Waiting for Parts');
    return { outstanding, payoutDue, ongoing, waitingParts };
  }, [repairs]);

  const tabFiltered = useMemo(() => {
    switch (activeTab) {
      case 'Ongoing': return periodRepairs.filter(r => ONGOING_REPAIR_STATUSES.includes(r.repair_status));
      case 'Completed': return periodRepairs.filter(r => r.repair_status === 'Completed');
      case 'Customer Unpaid': return periodRepairs.filter(r => r.customer_payment_status !== 'Paid');
      case 'Tech Unpaid': return periodRepairs.filter(r => r.tech_payable > 0.005);
      default: return periodRepairs;
    }
  }, [periodRepairs, activeTab]);

  const handleDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/service-repairs/${deleting.id}`, { method: 'DELETE' });
    showToast('Repair entry deleted');
    setDeleting(null);
    fetchData();
  };

  const goToTab = (tab: Tab) => {
    setActiveTab(tab);
    document.getElementById('repair-jobs-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Spinner size={36} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-4 sm:p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#16233B]">Service Center Monitoring</h1>
          <p className="text-sm text-[#66758A] mt-1">Track repair jobs, customer collections, and technician payouts</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#233653] hover:bg-[#1b2941] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> Add Repair
        </button>
      </div>

      {/* Date filter */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="flex items-center bg-[#F0F3F8] rounded-lg p-1 gap-0.5">
          {PERIOD_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriodKey(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                periodKey === key ? 'bg-[#233653] text-white' : 'text-[#66758A] hover:text-[#16233B]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {periodKey === 'custom' ? (
          <div className="flex items-center gap-2">
            <input type="date" className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-[#B7C0CC] text-xs">to</span>
            <input type="date" className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" value={customTo} min={customFrom} max={todayISO()} onChange={e => setCustomTo(e.target.value)} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(a => shiftServiceAnchor(periodKey, a, -1))} className="p-1.5 rounded-lg hover:bg-[#F0F3F8] text-[#66758A]">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-[#16233B] whitespace-nowrap">{range.label}</span>
            <button onClick={() => setAnchor(a => shiftServiceAnchor(periodKey, a, 1))} className="p-1.5 rounded-lg hover:bg-[#F0F3F8] text-[#66758A]">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Repair Sales" value={formatCurrency(kpis.repairSales)} icon={BadgeDollarSign} iconColor="#B68B3C" iconBg="#FBF3E2" />
        <Kpi label="Amount Collected" value={formatCurrency(kpis.collected)} icon={Wallet} iconColor="#15803D" iconBg="#EAF7EE" />
        <Kpi label="Customer Balance" value={formatCurrency(kpis.customerBalance)} icon={AlertCircle} iconColor="#DC2626" iconBg="#FDEDED" />
        <Kpi label="COGS" value={formatCurrency(kpis.cogs)} icon={Package} iconColor="#66758A" iconBg="#F0F3F8" />
        <Kpi label="BNS Earnings" value={formatCurrency(kpis.bns)} icon={HandCoins} iconColor="#233653" iconBg="#E7EBF2" />
        <Kpi label="Tech Payable" value={formatCurrency(kpis.techPayable)} icon={Wrench} iconColor="#B45309" iconBg="#FEF3E2" />
      </div>
      <p className="text-xs text-[#66758A] -mt-3">
        {kpis.total} Repair{kpis.total === 1 ? '' : 's'} • {kpis.completed} Completed • {kpis.ongoing} Ongoing
      </p>

      {/* Attention Needed */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-[#16233B] mb-1">Attention Needed</h2>
        <p className="text-xs text-[#66758A] mb-4">Items that require action right now.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {attention.outstanding.length > 0 && (
            <AttentionCard
              icon={AlertCircle} title="Customer Outstanding"
              lines={[`${attention.outstanding.length} job${attention.outstanding.length === 1 ? '' : 's'}`, `${formatCurrency(attention.outstanding.reduce((s, r) => s + r.balance, 0))} outstanding`]}
              actionLabel="View Collections" href="/service-center/collections"
              color="#DC2626" bg="#FDEDED"
            />
          )}
          {attention.payoutDue.length > 0 && (
            <AttentionCard
              icon={Wrench} title="Technician Payout Due"
              lines={[`${attention.payoutDue.length} job${attention.payoutDue.length === 1 ? '' : 's'}`, `${formatCurrency(attention.payoutDue.reduce((s, r) => s + r.tech_payable, 0))} payable`]}
              actionLabel="View Payouts" href="/service-center/payouts"
              color="#B45309" bg="#FEF3E2"
            />
          )}
          {attention.ongoing.length > 0 && (
            <AttentionCard
              icon={ClipboardList} title="Ongoing Repairs"
              lines={[`${attention.ongoing.length} job${attention.ongoing.length === 1 ? '' : 's'}`]}
              actionLabel="View Repairs" onClick={() => goToTab('Ongoing')}
              color="#233653" bg="#E7EBF2"
            />
          )}
          {attention.waitingParts.length > 0 && (
            <AttentionCard
              icon={Clock} title="Waiting for Parts"
              lines={[`${attention.waitingParts.length} job${attention.waitingParts.length === 1 ? '' : 's'}`]}
              actionLabel="View Repairs" onClick={() => goToTab('Ongoing')}
              color="#66758A" bg="#F0F3F8"
            />
          )}
          {attention.outstanding.length === 0 && attention.payoutDue.length === 0 && attention.ongoing.length === 0 && (
            <p className="text-sm text-[#66758A] col-span-full">✅ Nothing needs your attention right now.</p>
          )}
        </div>
      </div>

      {/* Repair Jobs Table */}
      <div id="repair-jobs-table" className="bg-white border border-[#E5EAF0] rounded-xl overflow-hidden">
        <div className="flex gap-1.5 flex-wrap px-5 sm:px-6 pt-5 sm:pt-6">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === t ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6">
          {tabFiltered.length === 0 ? (
            <p className="text-sm text-[#94A2B4] text-center py-12">No repairs found for this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5EAF0] text-left text-xs text-[#66758A]">
                    <th className="px-3 py-3 font-medium whitespace-nowrap">Date</th>
                    <th className="px-3 py-3 font-medium">Job / Unit</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Repair Amount</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">COGS</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Collected</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Balance</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">BNS</th>
                    <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Tech</th>
                    <th className="px-3 py-3 font-medium whitespace-nowrap">Repair Status</th>
                    <th className="px-3 py-3 font-medium whitespace-nowrap">Customer Payment</th>
                    <th className="px-3 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F3F8]">
                  {tabFiltered.map(r => (
                    <tr key={r.id} className="hover:bg-[#F6F8FC] cursor-pointer" onClick={() => setDrawerId(r.id)}>
                      <td className="px-3 py-3 text-[#16233B] whitespace-nowrap">{formatDate(r.repair_date)}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-[#16233B]">{r.repair_details || '—'}</p>
                        {r.unit_model && <p className="text-xs text-[#94A2B4]">{r.unit_model}</p>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[#16233B] whitespace-nowrap">{formatCurrency(r.repair_amount)}</td>
                      <td className="px-3 py-3 text-right text-[#66758A] whitespace-nowrap">{formatCurrency(r.cogs)}</td>
                      <td className="px-3 py-3 text-right text-green-700 whitespace-nowrap">{formatCurrency(r.collected)}</td>
                      <td className="px-3 py-3 text-right text-red-600 whitespace-nowrap">{formatCurrency(r.balance)}</td>
                      <td className="px-3 py-3 text-right text-blue-700 whitespace-nowrap">{formatCurrency(r.bns_share)}</td>
                      <td className="px-3 py-3 text-right text-amber-700 whitespace-nowrap">{formatCurrency(r.tech_earnings)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${REPAIR_STATUS_COLOR[r.repair_status]}`}>{r.repair_status}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CUSTOMER_STATUS_COLOR[r.customer_payment_status]}`}>{r.customer_payment_status}</span>
                      </td>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditing(r); setShowForm(true); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600" title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" title="Delete">
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
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Repair Entry' : 'Add Repair Entry'} size="lg">
        <RepairForm
          initial={editing ?? undefined}
          onSuccess={() => { setShowForm(false); showToast(editing ? 'Repair updated!' : 'Repair added!'); fetchData(); }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete Repair" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Delete repair entry "{deleting.repair_details ?? deleting.unit_model}"? This also removes its payment and payout history. This cannot be undone.
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

      {drawerId != null && (
        <RepairDetailsDrawer repairId={drawerId} onClose={() => setDrawerId(null)} onChanged={fetchData} />
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, iconColor, iconBg }: {
  label: string; value: string; icon: React.ElementType; iconColor: string; iconBg: string;
}) {
  return (
    <div className="bg-white border border-[#E5EAF0] rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor: iconBg }}>
          <Icon size={16} style={{ color: iconColor }} />
        </div>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#66758A] leading-snug">{label}</p>
      </div>
      <p className="text-lg font-bold text-[#16233B] whitespace-nowrap">{value}</p>
    </div>
  );
}

function AttentionCard({ icon: Icon, title, lines, actionLabel, href, onClick, color, bg }: {
  icon: React.ElementType; title: string; lines: string[]; actionLabel: string;
  href?: string; onClick?: () => void; color: string; bg: string;
}) {
  const content = (
    <>
      <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: bg }}>
        <Icon size={17} style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#16233B]">{title}</p>
        {lines.map((l, i) => <p key={i} className="text-xs text-[#66758A]">{l}</p>)}
        <p className="text-xs font-semibold mt-1" style={{ color }}>{actionLabel} →</p>
      </div>
    </>
  );
  const cls = "flex items-start gap-3 bg-white border border-[#E5EAF0] rounded-lg px-4 py-3 hover:border-[#B68B3C] transition-colors text-left";
  return href
    ? <Link href={href} className={cls}>{content}</Link>
    : <button onClick={onClick} className={cls}>{content}</button>;
}
