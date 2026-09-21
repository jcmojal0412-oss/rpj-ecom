'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, Clock, Copy, ExternalLink, FileText, Loader2, MapPin, Paperclip, Pencil, Repeat, Trash2, Users, Wallet, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { fmtTime12, peso } from '@/lib/calendar';
import { CategoryChip, StatusBadge, longDate, niceDate, type CalEvent, type Meta } from './calendar-ui';

interface Payment { id: number; payment_date: string; amount: number; payment_method: string | null; reference_no: string | null; remarks: string | null; recorded_by_name: string | null; voided_at: string | null; void_reason: string | null; created_at: string }
interface Attachment { id: number; payment_id: number | null; kind: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; uploaded_by_name: string | null }
interface AuditRow { action: string; details: string | null; created_at: string; actor_name: string | null }
export interface Detail { event: CalEvent; payments: Payment[]; attachments: Attachment[]; audit: AuditRow[]; google: { status: string; meet_link: string | null; last_error?: string | null } | null }

const ACTION_LABEL: Record<string, string> = {
  created: 'Created', updated: 'Edited', deleted: 'Deleted', cancelled: 'Cancelled', restored: 'Restored', status_changed: 'Status changed', payment_recorded: 'Payment recorded',
  payment_voided: 'Payment voided', attachment_added: 'File added', attachment_removed: 'File removed', overdue: 'Marked overdue', auto_overdue: 'Marked overdue automatically',
};
const KIND_LABEL: Record<string, string> = { receipt: 'Receipt', invoice: 'Invoice', statement: 'Statement', soa: 'SOA', meeting_file: 'Meeting file', screenshot: 'Screenshot', other: 'File' };
const fmtStamp = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 min-w-0 break-words">{children}</dd>
    </div>
  );
}

// The full picture of one schedule, plus every action that can be taken on it.
export default function EventDetail({ meta, eventId, onClose, onChanged, onEdit, onPay }: {
  meta: Meta; eventId: number; onClose: () => void; onChanged: () => void; onEdit: (e: CalEvent) => void; onPay: (e: CalEvent, mode: 'paid' | 'partial') => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'cancel' | { void: number }>(null);
  const [scope, setScope] = useState<'this' | 'future' | 'all'>('this');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileKind, setFileKind] = useState('other');

  const load = useCallback(async () => {
    const res = await fetch(`/api/calendar/events/${eventId}`, { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) { setError(j.error || 'Could not open this schedule.'); return; }
    setD(j);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<Response>, done?: string, reload = true) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fn();
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Something went wrong.'); return false; }
      if (done) setMsg(done.replace('{n}', String(j.deleted ?? '')));
      setConfirm(null); setReason('');
      if (reload) await load(); // a deleted schedule no longer exists to reload
      onChanged();
      return j;
    } finally { setBusy(false); }
  };

  const post = (path: string, body: unknown) => fetch(`/api/calendar/events/${eventId}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('kind', fileKind);
    await act(() => fetch(`/api/calendar/events/${eventId}/attachments`, { method: 'POST', body: fd }), 'File added.');
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = async () => {
    const r = await act(() => fetch(`/api/calendar/events/${eventId}?scope=${scope}`, { method: 'DELETE' }), undefined, false);
    if (r) onClose();
  };

  if (!d) {
    return (
      <Modal open onClose={onClose} title="Schedule details" size="lg">
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <div className="flex justify-center py-10 text-gray-400"><Loader2 className="animate-spin" /></div>}
      </Modal>
    );
  }
  const e = d.event;
  const isMeeting = e.event_type === 'meeting';
  const financial = e.financial_type !== 'NONE';
  const collection = e.financial_type === 'COLLECTION';
  const recurring = !!e.recurrence_id;
  const livePayments = d.payments.filter(p => !p.voided_at);
  const canDelete = !!e.can_edit;

  if (e.masked) {
    return (
      <Modal open onClose={onClose} title="Private Schedule" size="sm">
        <p className="text-sm text-gray-600">This schedule is private. You can see that the time is taken ({niceDate(e.start_date)}{e.all_day ? '' : `, ${fmtTime12(e.start_time)}`}), but not what it is about.</p>
        <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Schedule details" size="lg">
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <CategoryChip category={e.category} />
            <StatusBadge status={e.status} overdue={e.overdue} />
            {e.privacy !== 'public' && <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-md px-2 py-0.5">{e.privacy === 'private' ? 'Private' : 'Restricted'}</span>}
            {e.is_demo ? <span className="text-[11px] font-medium text-amber-700 bg-amber-50 rounded-md px-2 py-0.5">Sample</span> : null}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 break-words">{e.event_title}</h3>
          {financial && e.amount != null && (
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{peso(e.amount)}</p>
          )}
        </div>

        {financial && e.amount != null && (
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="money-summary">
            {[['Total', e.amount, 'text-gray-900'], [collection ? 'Received' : 'Paid', e.paid, 'text-emerald-700'], ['Remaining', e.remaining, e.remaining > 0 ? (e.overdue ? 'text-red-700' : 'text-gray-900') : 'text-gray-400']].map(([l, v, c]) => (
              <div key={l as string} className="rounded-xl bg-gray-50 border border-gray-100 py-2.5 px-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">{l as string}</p>
                <p className={`text-sm sm:text-base font-semibold tabular-nums ${c}`}>{peso(v as number)}</p>
              </div>
            ))}
          </div>
        )}

        <dl className="divide-y divide-gray-50">
          <Row label={financial ? 'Due date' : 'Date'}><span className="inline-flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" />{longDate(e.start_date)}{e.end_date !== e.start_date ? ` – ${longDate(e.end_date)}` : ''}</span></Row>
          <Row label="Time"><span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-gray-400" />{e.all_day ? 'All day' : `${fmtTime12(e.start_time)}${e.end_time ? ` – ${fmtTime12(e.end_time)}` : ''}`}</span></Row>
          {e.original_due_date && e.original_due_date !== e.start_date && <Row label="Original due date">{longDate(e.original_due_date)}</Row>}
          <Row label="Business unit">{e.business_unit_name ?? '—'}</Row>
          <Row label="Assigned to">{e.assigned_name ?? '—'}</Row>
          {financial && <Row label={collection ? 'Payer / Source' : 'Payee'}>{e.payee ?? '—'}</Row>}
          {financial && <Row label="Payment method">{e.payment_method ?? '—'}</Row>}
          {financial && <Row label="Reference no.">{e.reference_no ?? '—'}</Row>}
          {financial && <Row label="Account / Bank">{e.account_bank ?? '—'}</Row>}
          {isMeeting && <Row label="Location">{e.meeting_location ? <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-gray-400" />{e.meeting_location}</span> : '—'}</Row>}
          {isMeeting && (
            <Row label="Meeting link">
              {e.meeting_link || d.google?.meet_link
                ? <a href={(e.meeting_link || d.google?.meet_link) as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 hover:underline break-all"><ExternalLink size={14} />{e.meeting_link || d.google?.meet_link}</a>
                : '—'}
            </Row>
          )}
          {isMeeting && (
            <Row label="Attendees">
              {(e.attendees ?? []).length
                ? <span className="inline-flex flex-wrap gap-1.5">{(e.attendees ?? []).map((a, i) => <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-md px-2 py-0.5"><Users size={11} />{a.name}</span>)}</span>
                : '—'}
            </Row>
          )}
          {recurring && <Row label="Repeats"><span className="inline-flex items-center gap-1.5"><Repeat size={14} className="text-gray-400" />{e.recurrence_text}</span></Row>}
          {(e.reminders ?? []).length > 0 && <Row label="Reminders">{(e.reminders ?? []).map(r => (r === 0 ? 'Same day' : r === 1 ? '1 day before' : `${r} days before`)).join(', ')}</Row>}
          <Row label="Description">{e.description ? <span className="whitespace-pre-wrap">{e.description}</span> : '—'}</Row>
          <Row label="Created by">{e.created_by_name ?? '—'} · {fmtStamp(e.created_at)}</Row>
          {d.google && <Row label="Google Calendar">{d.google.status === 'synced' ? 'Synced' : d.google.status === 'error' ? `Not synced — ${d.google.last_error ?? 'error'}` : d.google.status}</Row>}
        </dl>

        {/* Payment history */}
        {financial && (
          <section aria-label="Payment history">
            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><Wallet size={15} className="text-gray-400" />{collection ? 'Collection history' : 'Payment history'}</h4>
            {d.payments.length === 0 ? <p className="text-sm text-gray-500">{collection ? 'Nothing received yet.' : 'No payments recorded yet.'}</p> : (
              <ul className="space-y-2">
                {d.payments.map(p => (
                  <li key={p.id} className={`rounded-xl border px-3 py-2.5 text-sm ${p.voided_at ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-100'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold tabular-nums ${p.voided_at ? 'line-through' : 'text-gray-900'}`}>{peso(p.amount)} <span className="font-normal text-gray-500">· {niceDate(p.payment_date)}</span></p>
                        <p className="text-xs text-gray-500 break-words">{[p.payment_method, p.reference_no && `Ref ${p.reference_no}`, p.recorded_by_name && `by ${p.recorded_by_name}`].filter(Boolean).join(' · ')}</p>
                        {p.remarks && <p className="text-xs text-gray-500 mt-0.5">{p.remarks}</p>}
                        {p.voided_at && <p className="text-xs text-red-600 mt-0.5">Voided — {p.void_reason}</p>}
                        {d.attachments.filter(a => a.payment_id === p.id).map(a => (
                          <a key={a.id} href={`/api/calendar/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mt-1 mr-2"><Paperclip size={11} />{a.original_name}</a>
                        ))}
                      </div>
                      {!p.voided_at && e.can_pay && (
                        <button onClick={() => { setConfirm({ void: p.id }); setReason(''); setError(''); }} className="text-xs text-gray-400 hover:text-red-600 shrink-0 py-1 px-1.5">Void</button>
                      )}
                    </div>
                    {typeof confirm === 'object' && confirm && confirm.void === p.id && (
                      <div className="mt-2 flex flex-col sm:flex-row gap-2">
                        <input className="form-input" aria-label="Reason for voiding" placeholder="Reason for voiding (required)" value={reason} onChange={x => setReason(x.target.value)} />
                        <button disabled={busy || !reason.trim()} onClick={() => act(() => fetch(`/api/calendar/events/${eventId}/payments/${p.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }), 'Payment voided.')} className="btn-primary disabled:opacity-50 justify-center">Void payment</button>
                        <button onClick={() => setConfirm(null)} className="btn-secondary justify-center">Keep</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {livePayments.length > 0 && e.remaining > 0 && <p className="text-xs text-gray-500 mt-2">Remaining balance: <span className="font-semibold tabular-nums">{peso(e.remaining)}</span></p>}
          </section>
        )}

        {/* Files */}
        <section aria-label="Attachments">
          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><Paperclip size={15} className="text-gray-400" />Attachments</h4>
          {d.attachments.filter(a => !a.payment_id).length === 0 && <p className="text-sm text-gray-500 mb-2">No files yet.</p>}
          <ul className="space-y-1.5 mb-2">
            {d.attachments.filter(a => !a.payment_id).map(a => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-lg border border-gray-100 px-3 py-2">
                <a href={`/api/calendar/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 hover:underline min-w-0"><FileText size={14} className="shrink-0" /><span className="truncate">{a.original_name}</span></a>
                <span className="text-xs text-gray-400 shrink-0">{KIND_LABEL[a.kind] ?? 'File'} · {kb(a.size_bytes)}</span>
                <button aria-label={`Remove ${a.original_name}`} className="text-gray-300 hover:text-red-500 shrink-0" onClick={() => act(() => fetch(`/api/calendar/attachments/${a.id}`, { method: 'DELETE' }), 'File removed.')}><X size={14} /></button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="File type" className="form-input w-auto py-1.5 text-sm" value={fileKind} onChange={x => setFileKind(x.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input ref={fileRef} type="file" aria-label="Add a file" className="text-sm max-w-full" onChange={x => { const f = x.target.files?.[0]; if (f) upload(f); }} disabled={busy} />
          </div>
        </section>

        {/* Audit trail */}
        <details className="group">
          <summary className="text-sm font-semibold text-gray-900 cursor-pointer select-none">Activity log ({d.audit.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {d.audit.map((a, i) => (
              <li key={i} className="text-xs text-gray-600 border-l-2 border-gray-100 pl-3">
                <span className="font-semibold text-gray-800">{ACTION_LABEL[a.action] ?? a.action}</span>{a.details ? ` — ${a.details}` : ''}
                <span className="block text-gray-400">{a.actor_name ?? 'System'} · {fmtStamp(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>

        {msg && <p className="text-sm text-emerald-700 font-medium" role="status">{msg}</p>}
        {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}

        {/* Cancel / delete confirmation lives in the modal, no browser dialogs */}
        {(confirm === 'delete' || confirm === 'cancel') && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 space-y-2.5" data-testid="confirm-box">
            <p className="text-sm font-medium text-red-900">{confirm === 'delete' ? 'Delete this schedule?' : 'Cancel this schedule?'}</p>
            {recurring && confirm === 'delete' && (
              <div className="text-sm text-red-900 space-y-1">
                {([['this', 'This schedule only'], ['future', 'This and following schedules'], ['all', 'All schedules in the series']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2"><input type="radio" name="del-scope" checked={scope === k} onChange={() => setScope(k)} /> {l}</label>
                ))}
                <p className="text-xs text-red-700">Occurrences that already have payments are kept.</p>
              </div>
            )}
            {confirm === 'cancel' && <input className="form-input" aria-label="Reason for cancelling" placeholder="Reason (optional)" value={reason} onChange={x => setReason(x.target.value)} />}
            {confirm === 'delete' && <p className="text-xs text-red-700">This removes it from the calendar. Its history stays in the activity log.</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center">
              <button className="btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Keep it</button>
              {confirm === 'delete'
                ? <button className="btn-primary" disabled={busy} onClick={remove}>Yes, delete</button>
                : <button className="btn-primary" disabled={busy} onClick={() => act(() => post('/status', { action: 'cancel', reason }), 'Schedule cancelled.')}>Yes, cancel it</button>}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 [&>button]:justify-center max-sm:[&>button]:flex-1">
          {financial && e.can_pay && e.status !== 'cancelled' && e.remaining > 0 && (
            <button className="btn-primary" onClick={() => onPay(e, 'paid')}>{collection ? 'Mark as Received' : 'Mark as Paid'}</button>
          )}
          {financial && e.can_pay && e.status !== 'cancelled' && e.remaining > 0 && (
            <button className="btn-secondary" onClick={() => onPay(e, 'partial')}>{collection ? 'Add Partial Collection' : 'Add Partial Payment'}</button>
          )}
          {!financial && e.can_update_status && e.status !== 'cancelled' && (
            <button className="btn-secondary" disabled={busy} onClick={() => act(() => post('/status', { action: e.status === 'completed' ? 'reopen' : 'complete' }), e.status === 'completed' ? 'Marked as not done.' : 'Marked as done.')}>{e.status === 'completed' ? 'Mark as Not Done' : 'Mark as Done'}</button>
          )}
          {e.can_edit && <button className="btn-secondary" onClick={() => onEdit(e)}><Pencil size={14} />Edit</button>}
          <button className="btn-secondary" disabled={busy} onClick={async () => { const j = await act(() => post('/duplicate', {}), 'Duplicated.'); if (j?.id) { onChanged(); onClose(); } }}><Copy size={14} />Duplicate</button>
          {e.can_edit && e.status !== 'cancelled' && <button className="btn-secondary" onClick={() => { setConfirm('cancel'); setReason(''); }}>Cancel Schedule</button>}
          {e.can_edit && e.status === 'cancelled' && <button className="btn-secondary" disabled={busy} onClick={() => act(() => post('/status', { action: 'restore' }), 'Schedule restored.')}>Restore</button>}
          {canDelete && <button className="btn-secondary !text-red-600" onClick={() => { setConfirm('delete'); setScope('this'); }}><Trash2 size={14} />Delete</button>}
          <button className="btn-secondary sm:ml-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
