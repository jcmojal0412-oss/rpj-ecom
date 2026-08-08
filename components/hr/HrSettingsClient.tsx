'use client';

import { useState } from 'react';
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

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">HR Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Advanced configuration — shift templates, attendance rules, holidays, leave types, and testing tools</p>
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
