'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Status {
  configured: boolean; connected: boolean; email: string | null; enabled: boolean; include_details: boolean;
  counts: { synced: number; pending: number; error: number }; last_error: string | null; last_run_at: string | null;
}

// Owner-only. One-way copy of schedules into the company's Google Calendar.
export default function GoogleSyncPanel({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/calendar/google', { cache: 'no-store' }); if (r.ok) setS(await r.json()); } catch { /* panel simply stays empty */ }
  }, []);
  useEffect(() => {
    load();
    // back from the Google consent screen: /calendar?gcal=connected|error
    const g = new URLSearchParams(window.location.search).get('gcal');
    if (g === 'connected') { setOpen(true); setMsg({ text: 'Google Calendar connected. Turn on sync below to start sending schedules.' }); }
    else if (g === 'error') { setOpen(true); setMsg({ text: 'Google Calendar could not be connected. Please try again.', bad: true }); }
  }, [load]);

  const put = async (body: object) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/calendar/google', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error || 'Could not save.', bad: true }); return; }
      setS(j); setConfirmOn(false); onChanged();
    } finally { setBusy(false); }
  };
  const syncNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/calendar/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync_now' }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error || 'Could not sync.', bad: true }); return; }
      setS(j.status);
      const x = j.result;
      setMsg(!x.ran ? { text: x.reason || 'Nothing was synced.', bad: true } : { text: `Done — ${x.created} added, ${x.updated} updated, ${x.deleted} removed${x.errors ? `, ${x.errors} failed` : ''}${x.remaining ? `. ${x.remaining} more will follow shortly.` : '.'}`, bad: x.errors > 0 });
    } finally { setBusy(false); }
  };

  if (!s) return null;
  const pill = !s.configured ? ['Not set up', 'bg-gray-100 text-gray-600'] : !s.connected ? ['Not connected', 'bg-gray-100 text-gray-600'] : s.enabled ? ['Syncing', 'bg-emerald-50 text-emerald-700'] : ['Connected · sync off', 'bg-amber-50 text-amber-700'];

  return (
    <div className="card !p-0 overflow-hidden" data-testid="google-panel">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="text-sm font-semibold text-gray-900">Google Calendar sync</span>
        <span className={`text-[11px] font-semibold rounded-md px-2 py-0.5 ${pill[1]}`}>{pill[0]}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 text-sm text-gray-700">
          {!s.configured && <p>Google sign-in is not set up on this server (missing Google client ID / secret).</p>}
          {s.configured && !s.connected && (
            <>
              <p>Connect the company Google account to show schedules in Google Calendar. It is the same account the SEDO booking page uses.</p>
              <a href="/api/settings/google-calendar/connect?return=calendar" className="btn-primary inline-flex">Connect Google Calendar</a>
            </>
          )}
          {s.connected && (
            <>
              <p>Connected as <span className="font-semibold">{s.email}</span>.</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={s.enabled} disabled={busy} onChange={e => (e.target.checked ? setConfirmOn(true) : put({ enabled: false }))} />
                <span>Send schedules to Google Calendar
                  <span className="block text-xs text-gray-500">One-way: RPJ stays the master copy. Schedules in the next 60 days are sent; changes, cancellations and deletions follow automatically. Sample schedules are never sent.</span></span>
              </label>
              {confirmOn && !s.enabled && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2" role="alertdialog" aria-label="Confirm turning on sync">
                  <p className="text-sm text-orange-900">This will add your upcoming schedules (next 60 days) to the Google Calendar of <span className="font-semibold">{s.email}</span>. Anyone who can see that calendar will see the basic headlines.</p>
                  <div className="flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => put({ enabled: true })}>Turn on sync</button><button className="btn-secondary" onClick={() => setConfirmOn(false)}>Cancel</button></div>
                </div>
              )}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={s.include_details} disabled={busy} onChange={e => put({ include_details: e.target.checked })} />
                <span>Include amounts and payee/supplier names
                  <span className="block text-xs text-gray-500">Off (recommended): payments appear only as “RPJ – Supplier Payment Due”. Bank accounts and reference numbers are never sent.</span></span>
              </label>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button className="btn-secondary" onClick={syncNow} disabled={busy || !s.enabled}>{busy && <Loader2 size={14} className="animate-spin" />}Sync now</button>
                <p className="text-xs text-gray-500">{s.counts.synced} in Google · {s.counts.pending} waiting · <span className={s.counts.error ? 'text-red-600 font-semibold' : ''}>{s.counts.error} failed</span></p>
              </div>
              {s.last_error && <p className="text-xs text-red-600" role="alert">Last problem: {s.last_error}</p>}
            </>
          )}
          {msg && <p className={`text-sm font-medium ${msg.bad ? 'text-red-600' : 'text-emerald-700'}`} role="status">{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
