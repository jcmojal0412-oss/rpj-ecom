'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Shield, User, Check, X, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { MODULES, AVATAR_COLORS, AVATAR_HEX } from '@/lib/auth-helpers';
import Spinner from '@/components/ui/Spinner';

interface AppUser {
  id: number; name: string; username: string;
  role: 'owner' | 'staff'; avatar_color: string;
  active: number; permissions: string[];
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function UserManager() {
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [changingPw, setChangingPw] = useState<AppUser | null>(null);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/users').then(r => r.json());
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDelete = async (u: AppUser) => {
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error, 'error'); }
    else { showToast(`${u.name} removed`); }
    setDeleting(null);
    fetchUsers();
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage staff accounts and module access</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Add Staff
        </button>
      </div>

      {/* Credentials info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
        <p className="text-sm font-semibold text-blue-900 mb-1">Default Login Credentials</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-blue-700">
          <span>Owner: <code className="bg-blue-100 px-1 rounded">owner</code> / <code className="bg-blue-100 px-1 rounded">rpj2026</code></span>
          <span>Staff default: <code className="bg-blue-100 px-1 rounded">staff123</code></span>
        </div>
        <p className="text-xs text-blue-500 mt-1">Change passwords after first login.</p>
      </div>

      {/* Users grid */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {users.map(u => (
            <div key={u.id} className={`card relative ${!u.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base shrink-0"
                  style={{ backgroundColor: AVATAR_HEX[u.avatar_color] ?? '#3b82f6' }}>
                  {initials(u.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 truncate">{u.name}</p>
                    {u.role === 'owner'
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full"><Shield size={10} /> Owner</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"><User size={10} /> Staff</span>}
                    {!u.active && <span className="text-xs text-red-500 font-medium">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">@{u.username}</p>

                  {/* Module permissions */}
                  {u.role !== 'owner' && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {MODULES.map(m => (
                        <span key={m.key} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          u.permissions.includes(m.key)
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-400'
                        }`}>
                          {m.icon} {m.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {u.role === 'owner' && (
                    <>
                      <p className="text-xs text-indigo-500 mt-2 font-medium">Full access to all modules</p>
                      <button
                        onClick={() => setChangingPw(u)}
                        className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 font-medium transition-colors"
                      >
                        <KeyRound size={12} /> Change Password
                      </button>
                    </>
                  )}
                </div>
              </div>

              {u.role !== 'owner' && (
                <div className="flex items-center gap-1 mt-4 pt-3 border-t border-gray-100">
                  <button onClick={() => setEditing(u)} className="btn-secondary text-xs py-1.5">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => setDeleting(u)} className="ml-auto p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Staff Member" size="md">
        <UserForm
          onSuccess={() => { setShowAdd(false); showToast('Staff account created!'); fetchUsers(); }}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Modal */}
      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Staff Member" size="md">
          <UserForm
            initial={editing}
            onSuccess={() => { setEditing(null); showToast('Account updated!'); fetchUsers(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove Staff" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sure ka bang i-remove ang account ni <span className="font-semibold">{deleting.name}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleDelete(deleting)} className="btn-danger"><Trash2 size={14} /> Remove</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Password Modal */}
      {changingPw && (
        <Modal open={!!changingPw} onClose={() => setChangingPw(null)} title="Change Password" size="sm">
          <ChangePasswordForm
            user={changingPw}
            onSuccess={() => { setChangingPw(null); showToast('Password changed!'); }}
            onCancel={() => setChangingPw(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// ── Change Password Form ──────────────────────────────────────────────────────

function ChangePasswordForm({ user, onSuccess, onCancel }: {
  user: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNew, setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          username: user.username,
          avatar_color: user.avatar_color,
          active: true,
          password: newPw,
          permissions: user.permissions,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to change password'); return; }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      <div>
        <label className="form-label">New Password</label>
        <div className="relative">
          <input
            type={showNew ? 'text' : 'password'}
            className="form-input pr-10"
            placeholder="Min. 6 characters"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            required
            autoFocus
          />
          <button type="button" onClick={() => setShowNew(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div>
        <label className="form-label">Confirm New Password</label>
        <div className="relative">
          <input
            type={showConfirm ? 'text' : 'password'}
            className="form-input pr-10"
            placeholder="Re-enter new password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            required
          />
          <button type="button" onClick={() => setShowConfirm(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : 'Change Password'}
        </button>
      </div>
    </form>
  );
}

// ── User Form ─────────────────────────────────────────────────────────────────

function UserForm({ initial, onSuccess, onCancel }: {
  initial?: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name,        setName]        = useState(initial?.name ?? '');
  const [username,    setUsername]    = useState(initial?.username ?? '');
  const [password,    setPassword]    = useState('');
  const [color,       setColor]       = useState(initial?.avatar_color ?? 'blue');
  const [active,      setActive]      = useState(initial ? initial.active === 1 : true);
  const [permissions, setPermissions] = useState<string[]>(initial?.permissions ?? ['dashboard']);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  const togglePerm = (key: string) =>
    setPermissions(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body: Record<string, unknown> = { name, username, avatar_color: color, active, permissions };
    if (password) body.password = password;

    try {
      const url    = initial ? `/api/users/${initial.id}` : '/api/users';
      const method = initial ? 'PUT' : 'POST';
      if (!initial) body.role = 'staff';

      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      {/* Avatar color picker */}
      <div>
        <label className="form-label">Avatar Color</label>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {AVATAR_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : 'hover:scale-105'}`}
              style={{ backgroundColor: AVATAR_HEX[c] ?? '#3b82f6' }}
            />
          ))}
        </div>
        {/* Preview */}
        <div className="flex items-center gap-3 mt-3 p-3 bg-gray-50 rounded-xl">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: AVATAR_HEX[color] ?? '#3b82f6' }}>
            {name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '??'}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{name || 'Staff Name'}</p>
            <p className="text-xs text-gray-400">@{username || 'username'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Full Name *</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Maria Santos" required />
        </div>
        <div>
          <label className="form-label">Username *</label>
          <input className="form-input" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="maria" required />
        </div>
        <div className="col-span-2">
          <label className="form-label">{initial ? 'New Password (leave blank to keep)' : 'Password *'}</label>
          <input type="password" className="form-input" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••"
            required={!initial} />
        </div>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setActive(v => !v)}
          className={`relative w-10 h-5 rounded-full transition-colors ${active ? 'bg-orange-500' : 'bg-gray-200'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : ''}`} />
        </button>
        <label className="text-sm text-gray-700 font-medium">Account Active</label>
      </div>

      {/* Module permissions */}
      <div>
        <label className="form-label">Module Access</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {MODULES.map(m => {
            const on = permissions.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => togglePerm(m.key)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                  on ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
                }`}
              >
                <span>{m.icon}</span>
                <span className="flex-1 text-left text-xs">{m.label}</span>
                {on && <Check size={13} className="shrink-0 text-orange-500" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Account' : 'Create Account'}
        </button>
      </div>
    </form>
  );
}
