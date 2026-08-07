'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Search } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';

interface Employee {
  id: number;
  employee_code: string;
  full_name: string;
  position: string | null;
  department: string | null;
  employment_type: string;
  employment_status: 'Active' | 'Inactive' | 'Resigned' | 'Terminated';
  attendance_enabled: number;
}

const STATUS_FILTERS = ['All', 'Active', 'Inactive', 'Resigned', 'Terminated'];

const STATUS_BADGE: Record<string, string> = {
  Active: 'badge-green',
  Inactive: 'badge-gray',
  Resigned: 'badge-amber',
  Terminated: 'badge-red',
};

export default function EmployeesClient() {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const fetchEmployees = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (q) params.set('q', q);
    fetch(`/api/employees?${params}`).then(r => r.json()).then(d => {
      setEmployees(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  useEffect(fetchEmployees, [statusFilter, q]);

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500 mt-1">Employee Masterlist / 201 File</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Add Employee
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === f ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            type="text"
            className="form-input pl-8 py-1.5 text-sm"
            placeholder="Search name, position, department..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : employees.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No employees found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Employee ID</th>
                  <th className="table-header">Full Name</th>
                  <th className="table-header">Position</th>
                  <th className="table-header">Department</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employees.map(e => (
                  <tr key={e.id} onClick={() => router.push(`/employees/${e.id}`)} className="hover:bg-gray-50/60 cursor-pointer">
                    <td className="table-cell font-mono text-xs text-gray-500">{e.employee_code}</td>
                    <td className="table-cell font-medium text-gray-900">{e.full_name}</td>
                    <td className="table-cell">{e.position || '—'}</td>
                    <td className="table-cell">{e.department || '—'}</td>
                    <td className="table-cell">{e.employment_type}</td>
                    <td className="table-cell"><span className={STATUS_BADGE[e.employment_status]}>{e.employment_status}</span></td>
                    <td className="table-cell">{e.attendance_enabled ? <span className="badge-blue">Enabled</span> : <span className="badge-gray">Disabled</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Employee" size="sm">
          <AddEmployeeForm
            onCancel={() => setShowAdd(false)}
            onCreated={(id) => { setShowAdd(false); showToast('Employee created!'); router.push(`/employees/${id}`); }}
          />
        </Modal>
      )}
    </div>
  );
}

function AddEmployeeForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const [fullName, setFullName] = useState('');
  const [employmentType, setEmploymentType] = useState('Probationary');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!fullName.trim()) { setError('Full name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim(), employment_type: employmentType }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create.'); return; }
      onCreated(data.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label">Full Name</label>
        <input type="text" className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Juan Dela Cruz" />
      </div>
      <div>
        <label className="form-label">Employment Type</label>
        <select className="form-input" value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
          <option value="Probationary">Probationary</option>
          <option value="Regular">Regular</option>
          <option value="Contractual">Contractual</option>
        </select>
      </div>
      <p className="text-xs text-gray-400">You can fill in the rest of the 201 file details after creating.</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Creating...' : 'Create Employee'}
        </button>
      </div>
    </div>
  );
}
