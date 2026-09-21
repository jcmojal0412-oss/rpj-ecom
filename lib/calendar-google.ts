import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { addDays, CATEGORY_BY_KEY, peso } from './calendar';
import { getConnectedGoogleEmail, getFreshAccessToken, isGoogleCalendarConfigured, isGoogleCalendarConnected } from './google-calendar';

// Google Calendar sync for the Operations Calendar.
//
//  * One-way: RPJ is the source of truth, Google shows a copy. Nothing is read back.
//  * Uses the company's existing Google connection (the one SEDO bookings use), on its
//    primary calendar. Plain REST calls, no SDK — same approach as lib/google-calendar.ts.
//  * "Reconcile" design: instead of hooking every place that changes a schedule, one
//    idempotent pass compares what Google SHOULD have with what was last sent (a hash
//    per event) and creates / updates / deletes only the difference. Running it twice
//    does nothing the second time, so it can never create duplicates.
//  * Privacy: by default only basic info is sent ("RPJ – Supplier Payment Due" + a link
//    back to RPJ). Amounts and payee are sent only if the Owner switches that on. Bank
//    accounts and reference numbers are never sent. Restricted / private schedules are
//    marked private in Google as well.
//  * Sample data is never synced.

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SITE_ORIGIN = () => process.env.SITE_ORIGIN || 'https://rpjcorp.com';
const HORIZON_DAYS = 60;      // schedules further away than this are sent when they come closer
const MAX_OPS_PER_PASS = 30;  // API calls per pass; the rest continues on the next pass
const CALL_TIMEOUT_MS = 12_000;

// ---------------- settings ----------------
const getSetting = (db: Database.Database, key: string) => (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
const putSetting = (db: Database.Database, key: string, value: string) => { db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value); };

export interface GoogleSyncSettings { enabled: boolean; include_details: boolean }
export function getSyncSettings(db: Database.Database): GoogleSyncSettings {
  return { enabled: getSetting(db, 'calendar_google_enabled') === '1', include_details: getSetting(db, 'calendar_google_details') === '1' };
}
export function setSyncSettings(db: Database.Database, s: Partial<GoogleSyncSettings>) {
  if (typeof s.enabled === 'boolean') putSetting(db, 'calendar_google_enabled', s.enabled ? '1' : '0');
  if (typeof s.include_details === 'boolean') putSetting(db, 'calendar_google_details', s.include_details ? '1' : '0');
}

// Everything the settings panel shows.
export function googleStatus(db: Database.Database) {
  const configured = isGoogleCalendarConfigured();
  const connected = configured && isGoogleCalendarConnected();
  const st = getSyncSettings(db);
  const n = (status: string) => (db.prepare('SELECT COUNT(*) c FROM calendar_google_sync WHERE sync_status = ?').get(status) as { c: number }).c;
  const lastError = db.prepare("SELECT last_error, event_id FROM calendar_google_sync WHERE sync_status = 'error' AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { last_error: string; event_id: number } | undefined;
  return {
    configured, connected, email: connected ? getConnectedGoogleEmail() : null, enabled: st.enabled, include_details: st.include_details,
    // a schedule can be sent to Google only when all of these hold
    available: configured && connected && st.enabled,
    counts: { synced: n('synced'), pending: n('pending'), error: n('error') },
    last_error: lastError?.last_error ?? getSetting(db, 'calendar_google_last_error'),
    last_run_at: getSetting(db, 'calendar_google_last_run'),
  };
}

// ---------------- what Google gets ----------------
interface Row {
  id: number; event_title: string; category: string; event_type: string; financial_type: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: number;
  description: string | null; amount: number | null; payee: string | null; status: string; privacy: string; meeting_location: string | null; business_unit_name: string | null; google_meet: number;
}

// The generic headline used when amounts / payee are not shared.
function basicHeadline(r: Row): string {
  const label = CATEGORY_BY_KEY[r.category]?.label ?? 'Schedule';
  if (r.financial_type === 'COLLECTION') return 'Expected Collection';
  if (r.financial_type === 'PAYMENT') return /due$/i.test(label) ? label : `${label} Due`;
  return label;
}

const pad = (n: number) => String(n).padStart(2, '0');
function plusOneHour(date: string, time: string): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? { date: addDays(date, 1), time: `${pad((h + 1) % 24)}:${pad(m)}` } : { date, time: `${pad(h + 1)}:${pad(m)}` };
}

export function googleBody(r: Row, includeDetails: boolean) {
  const isPrivate = r.privacy === 'private';
  const financial = r.financial_type !== 'NONE';
  const lines: string[] = [];
  let summary: string;
  if (isPrivate) summary = 'RPJ – Private Schedule';
  else if (financial && !includeDetails) summary = `RPJ – ${basicHeadline(r)}`;
  else if (financial) summary = `RPJ – ${r.event_title}${r.amount != null ? ` (${peso(r.amount)})` : ''}`;
  else summary = `RPJ – ${r.event_title}`;

  if (!isPrivate) {
    if (r.business_unit_name) lines.push(`Business unit: ${r.business_unit_name}`);
    if (financial && includeDetails) {
      if (r.payee) lines.push(`${r.financial_type === 'COLLECTION' ? 'From' : 'Payee'}: ${r.payee}`);
      lines.push(`Status: ${r.status.replace('_', ' ')}`);
    }
    if (!financial && r.description) lines.push('', r.description);
  }
  lines.push('', `Open in RPJ System: ${SITE_ORIGIN()}/calendar?event=${r.id}`);

  const body: Record<string, any> = {
    summary,
    description: lines.join('\n').trim(),
    // Restricted / private / money schedules stay hidden from people who only have view access to the Google calendar.
    visibility: isPrivate || financial || r.privacy === 'restricted' ? 'private' : 'default',
    extendedProperties: { private: { rpjEventId: String(r.id), rpjApp: 'rpj-ecom' } },
  };
  if (!isPrivate && r.event_type === 'meeting' && r.meeting_location) body.location = r.meeting_location;

  if (r.all_day || !r.start_time) {
    // Google's all-day end date is exclusive.
    body.start = { date: r.start_date };
    body.end = { date: addDays(r.end_date, 1) };
  } else {
    const end = r.end_time ? { date: r.end_date, time: r.end_time } : plusOneHour(r.start_date, r.start_time);
    body.start = { dateTime: `${r.start_date}T${r.start_time}:00+08:00`, timeZone: 'Asia/Manila' };
    body.end = { dateTime: `${end.date}T${end.time}:00+08:00`, timeZone: 'Asia/Manila' };
  }
  return body;
}
const hashOf = (body: unknown, meet: number) => crypto.createHash('sha1').update(JSON.stringify(body) + `|meet:${meet}`).digest('hex');

// ---------------- HTTP ----------------
class GoogleHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function gcall(token: string, method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* keep raw */ }
    throw new GoogleHttpError(res.status, `Google said ${res.status}: ${msg}`);
  }
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
const meetLinkOf = (g: any): string | null => g?.hangoutLink ?? g?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ?? null;

// ---------------- reconcile ----------------
export interface SyncResult { ran: boolean; created: number; updated: number; deleted: number; errors: number; remaining: number; reason?: string }

const CANDIDATES_SQL = `
  SELECT e.*, bu.name AS business_unit_name, s.id AS sync_id, s.google_event_id, s.sync_status, s.meet_link, s.payload_hash, s.last_synced_at, s.attempts, s.next_attempt_at
  FROM calendar_events e
  LEFT JOIN calendar_business_units bu ON bu.id = e.business_unit_id
  LEFT JOIN calendar_google_sync s ON s.event_id = e.id
  WHERE e.is_demo = 0 AND (
        (e.deleted_at IS NULL AND e.status != 'cancelled' AND e.sync_google = 1 AND e.start_date >= ? AND e.start_date <= ?)
     OR (s.id IS NOT NULL AND s.sync_status != 'deleted' AND (e.deleted_at IS NOT NULL OR e.status = 'cancelled' OR e.sync_google = 0 OR e.updated_at > COALESCE(s.last_synced_at, '')))
  )
  ORDER BY e.start_date, e.id
`;

let running: Promise<SyncResult> | null = null;

export function reconcileGoogle(db: Database.Database, today: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (running) return running; // one pass at a time
  running = doReconcile(db, today, opts).finally(() => { running = null; });
  return running;
}

async function doReconcile(db: Database.Database, today: string, opts: { force?: boolean }): Promise<SyncResult> {
  const out: SyncResult = { ran: false, created: 0, updated: 0, deleted: 0, errors: 0, remaining: 0 };
  const settings = getSyncSettings(db);
  if (!settings.enabled) return { ...out, reason: 'Sync is switched off.' };
  if (!isGoogleCalendarConfigured() || !isGoogleCalendarConnected()) return { ...out, reason: 'Google Calendar is not connected.' };
  // Work out what actually needs sending first, so an idle pass costs no Google calls at all.
  const rows = db.prepare(CANDIDATES_SQL).all(addDays(today, -2), addDays(today, HORIZON_DAYS)) as any[];
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const plan: { r: any; gone: boolean; body: Record<string, any> | null; hash: string }[] = [];
  for (const r of rows) {
    const gone = r.deleted_at !== null || r.status === 'cancelled' || r.sync_google === 0;
    // wait out a failed attempt's back-off unless this is a manual "Sync now"
    if (!opts.force && r.sync_status === 'error' && r.next_attempt_at && r.next_attempt_at > nowIso) continue;
    if (gone) { if (r.google_event_id && r.sync_status !== 'deleted') plan.push({ r, gone, body: null, hash: '' }); continue; } // never sent = nothing to remove
    const body = googleBody(r, settings.include_details);
    const hash = hashOf(body, r.google_meet);
    const needMeet = r.google_meet === 1 && !r.meet_link;
    if (r.sync_status === 'synced' && r.payload_hash === hash && !needMeet) continue; // nothing changed
    plan.push({ r, gone, body, hash });
  }
  if (plan.length === 0) { putSetting(db, 'calendar_google_last_run', new Date().toISOString()); return { ...out, ran: true }; }

  const token = await getFreshAccessToken();
  if (!token) { putSetting(db, 'calendar_google_last_error', 'Could not sign in to Google. Reconnect Google Calendar.'); return { ...out, reason: 'Could not sign in to Google.' }; }
  out.ran = true;
  let ops = 0;

  const save = (r: any, patch: { google_event_id?: string | null; status: string; meet?: string | null; hash?: string | null; error?: string | null; attempts?: number; next?: string | null }) => {
    const exists = db.prepare('SELECT id FROM calendar_google_sync WHERE event_id = ?').get(r.id);
    const attempts = patch.attempts ?? 0;
    if (exists) {
      db.prepare(`UPDATE calendar_google_sync SET google_event_id = COALESCE(?, google_event_id), sync_status = ?, meet_link = COALESCE(?, meet_link), payload_hash = COALESCE(?, payload_hash),
        last_synced_at = CASE WHEN ? = 'synced' OR ? = 'deleted' THEN datetime('now') ELSE last_synced_at END, last_error = ?, attempts = ?, next_attempt_at = ? WHERE event_id = ?`)
        .run(patch.google_event_id ?? null, patch.status, patch.meet ?? null, patch.hash ?? null, patch.status, patch.status, patch.error ?? null, attempts, patch.next ?? null, r.id);
    } else {
      db.prepare(`INSERT INTO calendar_google_sync (event_id, google_event_id, sync_status, meet_link, payload_hash, last_synced_at, last_error, attempts, next_attempt_at)
        VALUES (?,?,?,?,?, CASE WHEN ? = 'synced' THEN datetime('now') END, ?,?,?)`)
        .run(r.id, patch.google_event_id ?? null, patch.status, patch.meet ?? null, patch.hash ?? null, patch.status, patch.error ?? null, attempts, patch.next ?? null);
    }
  };

  for (const { r, gone: wantGone, body, hash } of plan) {
    if (ops >= MAX_OPS_PER_PASS) { out.remaining++; continue; }
    try {
      if (wantGone) {
        ops++;
        try { await gcall(token, 'DELETE', `${EVENTS_URL}/${encodeURIComponent(r.google_event_id)}`); } catch (e) { if (!(e instanceof GoogleHttpError && (e.status === 404 || e.status === 410))) throw e; }
        save(r, { status: 'deleted' });
        out.deleted++;
        continue;
      }

      const createMeet = r.google_meet === 1 && !r.meet_link;
      const withMeet = (b: Record<string, any>) => (createMeet ? { ...b, conferenceData: { createRequest: { requestId: `rpj-${r.id}-${crypto.randomBytes(6).toString('hex')}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : b);
      const qs = createMeet ? '?conferenceDataVersion=1' : '';

      let googleId: string | null = r.google_event_id;
      let result: any = null;
      if (googleId) {
        ops++;
        try { result = await gcall(token, 'PATCH', `${EVENTS_URL}/${encodeURIComponent(googleId)}${qs}`, withMeet(body!)); out.updated++; }
        catch (e) { if (e instanceof GoogleHttpError && (e.status === 404 || e.status === 410)) googleId = null; else throw e; } // removed in Google: send it again
      }
      if (!googleId) {
        // Look first, so a lost database row can never produce a second copy in Google.
        ops++;
        const found = await gcall(token, 'GET', `${EVENTS_URL}?privateExtendedProperty=${encodeURIComponent(`rpjEventId=${r.id}`)}&maxResults=1&showDeleted=false`);
        const existing = found?.items?.[0];
        ops++;
        if (existing?.id && existing.status !== 'cancelled') { googleId = existing.id as string; result = await gcall(token, 'PATCH', `${EVENTS_URL}/${encodeURIComponent(googleId)}${qs}`, withMeet(body!)); out.updated++; }
        else { result = await gcall(token, 'POST', `${EVENTS_URL}${qs}`, withMeet(body!)); googleId = result?.id ?? null; out.created++; }
      }
      // A Meet link can take a moment to be issued; ask once more if it was not in the reply.
      let meet = meetLinkOf(result);
      if (r.google_meet === 1 && !meet && !r.meet_link && googleId) { ops++; meet = meetLinkOf(await gcall(token, 'GET', `${EVENTS_URL}/${encodeURIComponent(googleId)}`)); }
      save(r, { google_event_id: googleId, status: 'synced', meet, hash });
    } catch (e: any) {
      out.errors++;
      const status = e instanceof GoogleHttpError ? e.status : 0;
      const attempts = (r.attempts ?? 0) + 1;
      const backoffMin = Math.min(60, 2 ** attempts);
      save(r, { status: 'error', error: String(e?.message ?? e).slice(0, 300), attempts, next: new Date(Date.now() + backoffMin * 60_000).toISOString().slice(0, 19).replace('T', ' ') });
      if (status === 401 || status === 403 || status === 429) { putSetting(db, 'calendar_google_last_error', String(e.message).slice(0, 300)); out.remaining++; break; } // every further call would fail the same way
    }
  }
  putSetting(db, 'calendar_google_last_run', new Date().toISOString());
  if (out.errors === 0) putSetting(db, 'calendar_google_last_error', '');
  return out;
}

// ---------------- fire-and-forget trigger used by the routes ----------------
let lastKick = 0, followUp: ReturnType<typeof setTimeout> | null = null;

// Never blocks or fails a request: a slow or broken Google must not slow the calendar down.
export function kickGoogleSync(db: Database.Database, today: string, minGapMs = 0) {
  try {
    if (!getSyncSettings(db).enabled) return;
    const now = Date.now();
    if (now - lastKick < minGapMs) return;
    lastKick = now;
    reconcileGoogle(db, today).then(r => {
      // more than one pass worth of work: keep going shortly, without waiting for another request
      if (r.remaining > 0 && !followUp) followUp = setTimeout(() => { followUp = null; kickGoogleSync(db, today); }, 20_000);
    }).catch(e => console.error('[calendar-google] sync failed:', e));
  } catch (e) { console.error('[calendar-google] could not start sync:', e); }
}

export const __test = { HORIZON_DAYS, MAX_OPS_PER_PASS, resetKick: () => { lastKick = 0; if (followUp) { clearTimeout(followUp); followUp = null; } } };
