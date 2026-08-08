'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import { SettingsTab, ShiftsTab, TestModeTab } from '@/components/attendance/AttendanceAdminClient';
import { HolidaysTab, LeaveTypesTab, ExceptionsTab } from '@/components/leave/LeaveManagementClient';

// One consolidated home for every advanced/technical setting that used to
// be scattered across the Attendance Admin and Leave Management pages.
// None of these tabs were rewritten — they're the exact same components,
// just reachable from one place now so the day-to-day Attendance/Payroll
// pages stay simple for non-technical HR staff. Nothing about how these
// tabs compute or save anything has changed.
type Tab = 'shifts' | 'rules' | 'holidays' | 'leave_types' | 'exceptions' | 'test';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shifts', label: 'Shift Templates' },
  { key: 'rules', label: 'Attendance Rules' },
  { key: 'holidays', label: 'Holiday Settings' },
  { key: 'leave_types', label: 'Leave Types' },
  { key: 'exceptions', label: 'Attendance Exceptions' },
  { key: 'test', label: 'Test Mode' },
];

export default function HrSettingsClient() {
  const { toast, showToast, clearToast } = useToast();
  const [tab, setTab] = useState<Tab>('shifts');
  const [copied, setCopied] = useState(false);

  // Starts as a relative path so server and client first-render match; the
  // full origin is filled in after mount (client-only), avoiding a hydration
  // mismatch (window.location isn't available during SSR).
  const [kioskUrl, setKioskUrl] = useState('/attendance-kiosk');
  useEffect(() => {
    setKioskUrl(`${window.location.origin}/attendance-kiosk`);
  }, []);

  const copyKioskLink = () => {
    navigator.clipboard.writeText(kioskUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">HR Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Advanced configuration — shift templates, attendance rules, holidays, leave types, and testing tools</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">Kiosk Attendance Link</p>
          <p className="text-sm text-gray-800 truncate">{kioskUrl}</p>
          <p className="text-xs text-gray-400 mt-0.5">Public page — no login needed. Open this on the kiosk device/tablet.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <a href="/attendance-kiosk" target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5">
            <ExternalLink size={13} />
            Open
          </a>
          <button onClick={copyKioskLink} className="btn-secondary text-xs py-1.5">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'shifts' && <ShiftsTab showToast={showToast} />}
      {tab === 'rules' && <SettingsTab showToast={showToast} />}
      {tab === 'holidays' && <HolidaysTab showToast={showToast} />}
      {tab === 'leave_types' && <LeaveTypesTab showToast={showToast} />}
      {tab === 'exceptions' && <ExceptionsTab showToast={showToast} />}
      {tab === 'test' && <TestModeTab showToast={showToast} />}
    </div>
  );
}
