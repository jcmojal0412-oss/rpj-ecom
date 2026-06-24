'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, Check, X, GripVertical } from 'lucide-react';
import { STATUS_COLORS, getStatusColor } from '@/lib/statusColors';

export interface ResearchStatusRecord {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

interface Props {
  onChanged: () => void;
}

const COLOR_KEYS = Object.keys(STATUS_COLORS);

export default function StatusManager({ onChanged }: Props) {
  const [statuses, setStatuses] = useState<ResearchStatusRecord[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('gray');
  const [addName, setAddName] = useState('');
  const [addColor, setAddColor] = useState('gray');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStatuses = async () => {
    const data = await fetch('/api/research-statuses').then(r => r.json());
    setStatuses(data);
  };

  useEffect(() => { fetchStatuses(); }, []);

  const startEdit = (s: ResearchStatusRecord) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
    setError('');
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    setError('');
    const res = await fetch(`/api/research-statuses/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, color: editColor, sort_order: statuses.find(s => s.id === editingId)?.sort_order }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setEditingId(null);
    setSaving(false);
    fetchStatuses();
    onChanged();
  };

  const handleDelete = async (id: number) => {
    setError('');
    const res = await fetch(`/api/research-statuses/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    fetchStatuses();
    onChanged();
  };

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setSaving(true);
    setError('');
    const res = await fetch('/api/research-statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: addName, color: addColor }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setAddName('');
    setAddColor('gray');
    setSaving(false);
    fetchStatuses();
    onChanged();
  };

  const moveStatus = async (id: number, direction: 'up' | 'down') => {
    const idx = statuses.findIndex(s => s.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= statuses.length) return;

    const a = statuses[idx];
    const b = statuses[swapIdx];

    await Promise.all([
      fetch(`/api/research-statuses/${a.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: a.name, color: a.color, sort_order: b.sort_order }),
      }),
      fetch(`/api/research-statuses/${b.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: b.name, color: b.color, sort_order: a.sort_order }),
      }),
    ]);
    fetchStatuses();
    onChanged();
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Existing statuses */}
      <div className="space-y-2">
        {statuses.map((s, idx) => {
          const colors = getStatusColor(s.color);
          return (
            <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 ${colors.bg}`}>
              {/* Reorder arrows */}
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveStatus(s.id, 'up')} disabled={idx === 0}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-xs">▲</button>
                <button onClick={() => moveStatus(s.id, 'down')} disabled={idx === statuses.length - 1}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-xs">▼</button>
              </div>

              {/* Color dot */}
              <div className={`w-3 h-3 rounded-full shrink-0 ${colors.dot}`} />

              {editingId === s.id ? (
                /* Edit mode */
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <input
                    autoFocus
                    className="flex-1 min-w-0 text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                  />
                  {/* Color picker */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {COLOR_KEYS.map(key => (
                      <button
                        key={key}
                        onClick={() => setEditColor(key)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${STATUS_COLORS[key].dot} ${
                          editColor === key ? 'border-gray-800 scale-125' : 'border-transparent hover:scale-110'
                        }`}
                        title={STATUS_COLORS[key].label}
                      />
                    ))}
                  </div>
                  <button onClick={saveEdit} disabled={saving}
                    className="p-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                    <Check size={13} />
                  </button>
                  <button onClick={() => setEditingId(null)}
                    className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                /* View mode */
                <>
                  <span className={`flex-1 text-sm font-semibold px-2 py-0.5 rounded-full ${colors.header}`}>
                    {s.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(s)}
                      className="p-1.5 rounded-lg hover:bg-white/70 text-gray-500 hover:text-orange-500 transition-colors"
                      title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(s.id)}
                      className="p-1.5 rounded-lg hover:bg-white/70 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new status */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Add New Status</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="flex-1 min-w-0 form-input text-sm"
            placeholder="Status name (e.g. For Revision)"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          {/* Color picker for new */}
          <div className="flex items-center gap-1">
            {COLOR_KEYS.map(key => (
              <button
                key={key}
                onClick={() => setAddColor(key)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${STATUS_COLORS[key].dot} ${
                  addColor === key ? 'border-gray-800 scale-125' : 'border-transparent hover:scale-110'
                }`}
                title={STATUS_COLORS[key].label}
              />
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !addName.trim()}
            className="btn-primary text-xs py-2 disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Color selected: <span className="font-medium">{STATUS_COLORS[addColor]?.label}</span>
        </p>
      </div>
    </div>
  );
}
