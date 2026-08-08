'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Clock3, AlertTriangle, Coffee, FileEdit, Palmtree, AlertCircle } from 'lucide-react';
import { formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import { OtReviewModal, CorrectionReviewModal } from '@/components/attendance/AttendanceAdminClient';
import { LeaveReviewModal } from '@/components/leave/LeaveManagementClient';

const REFRESH_MS = 45_000;

// The everyday landing view for HR/Owner — deliberately just 4 numbers plus
// a single "here's what needs a decision" panel. Everything technical
// (shift templates, break rules, holiday calendar, leave types, test mode)
// lives in HR Settings instead — this page never shows a formula or a
// config field, only outcomes and actions.
export default function HrDashboardClient() {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ present: 0, late: 0, absent: 0, onBreak: 0 });
  const [attention, setAttention] = useState<{ pendingOt: any[]; pendingCorrections: any[]; pendingLeave: any[]; missingTimeOut: any[] }>({
    pendingOt: [], pendingCorrections: [], pendingLeave: [], missingTimeOut: [],
  });
  const [reviewingOt, setReviewingOt] = useState<any | null>(null);
  const [reviewingCorrection, setReviewingCorrection] = useState<any | null>(null);
  const [reviewingLeave, setReviewingLeave] = useState<any | null>(null);

  const fetchAll = () => {
    const today = todayISO();
    Promise.all([
      fetch(`/api/attendance/records?from=${today}&to=${today}`).then(r => r.json()),
      fetch('/api/attendance/live-status').then(r => r.json()),
      fetch('/api/hr/needs-attention').then(r => r.json()),
    ]).then(([records, live, needsAttention]) => {
      const rows = Array.isArray(records) ? records : [];
      setCounts({
        present: rows.filter((r: any) => r.status === 'present').length,
        late: rows.filter((r: any) => r.status === 'late').length,
        absent: rows.filter((r: any) => r.status === 'absent').length,
        onBreak: live?.counts?.onBreak ?? 0,
      });
      setAttention({
        pendingOt: needsAttention.pendingOt ?? [],
        pendingCorrections: needsAttention.pendingCorrections ?? [],
        pendingLeave: needsAttention.pendingLeave ?? [],
        missingTimeOut: needsAttention.missingTimeOut ?? [],
      });
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const totalAttention = attention.pendingOt.length + attention.pendingCorrections.length + attention.pendingLeave.length + attention.missingTimeOut.length;

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  const cards = [
    { label: 'Present Today', value: counts.present, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Late Today', value: counts.late, icon: Clock3, color: 'text-amber-600 bg-amber-50' },
    { label: 'Absent Today', value: counts.absent, icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'On Break', value: counts.onBreak, icon: Coffee, color: 'text-orange-600 bg-orange-50' },
  ];

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">HR Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Today at a glance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card flex items-center gap-4">
            <div className={`p-3 rounded-xl ${c.color}`}><c.icon size={22} /></div>
            <div>
              <p className="text-xs text-gray-500 font-medium">{c.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card space-y-4 border-2 border-orange-100">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-gray-900">Needs Your Attention</p>
          {totalAttention > 0 && <span className="badge-amber">{totalAttention}</span>}
        </div>

        {totalAttention === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Nothing needs your attention right now.</p>
        ) : (
          <div className="space-y-1.5">
            {attention.pendingOt.map((r: any) => (
              <button key={`ot-${r.id}`} onClick={() => setReviewingOt(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock3 size={14} className="text-orange-500 shrink-0" />
                  OT for Approval — {r.employee_name} ({formatDate(r.event_date)})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.pendingCorrections.map((r: any) => (
              <button key={`corr-${r.id}`} onClick={() => setReviewingCorrection(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <FileEdit size={14} className="text-blue-500 shrink-0" />
                  Attendance Correction — {r.employee_name} ({formatDate(r.event_date)})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.pendingLeave.map((r: any) => (
              <button key={`leave-${r.id}`} onClick={() => setReviewingLeave(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <Palmtree size={14} className="text-green-500 shrink-0" />
                  Leave Request — {r.employee_name} ({r.leave_type_name})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.missingTimeOut.map((r: any) => (
              <div key={`missing-${r.employee_id}`} onClick={() => router.push('/attendance')} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  Missing Time Out — {r.employee_name} (today)
                </span>
                <span className="text-xs text-gray-400 font-medium">View →</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {reviewingOt && (
        <OtReviewModal request={reviewingOt} onClose={() => setReviewingOt(null)} onDone={() => { setReviewingOt(null); showToast('OT request reviewed!'); fetchAll(); }} />
      )}
      {reviewingCorrection && (
        <CorrectionReviewModal request={reviewingCorrection} onClose={() => setReviewingCorrection(null)} onDone={() => { setReviewingCorrection(null); showToast('Correction reviewed!'); fetchAll(); }} />
      )}
      {reviewingLeave && (
        <LeaveReviewModal request={reviewingLeave} onClose={() => setReviewingLeave(null)} onDone={() => { setReviewingLeave(null); showToast('Leave request reviewed!'); fetchAll(); }} />
      )}
    </div>
  );
}
