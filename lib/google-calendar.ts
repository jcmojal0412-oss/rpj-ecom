import { getDb } from './db';

// Google Calendar sync for SEDO Discovery Call bookings — plain REST calls
// (no googleapis SDK) so the OAuth token dance and event creation stay
// dependency-free, matching the Resend integration's approach.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function getSetting(db: ReturnType<typeof getDb>, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || 'https://rpjcorp.com/api/settings/google-calendar/callback';
}

export function isGoogleCalendarConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-connect
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

export function isGoogleCalendarConnected(): boolean {
  return !!getSetting(getDb(), 'google_calendar_refresh_token');
}

export function getConnectedGoogleEmail(): string | null {
  return getSetting(getDb(), 'google_calendar_email');
}

export async function saveGoogleCalendarConnection(refreshToken: string, accessToken: string) {
  const db = getDb();
  setSetting(db, 'google_calendar_refresh_token', refreshToken);
  const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const info = infoRes.ok ? await infoRes.json() as { email?: string } : {};
  setSetting(db, 'google_calendar_email', info.email || 'Connected');
}

export function disconnectGoogleCalendar() {
  getDb().prepare("DELETE FROM app_settings WHERE key IN ('google_calendar_refresh_token','google_calendar_email')").run();
}

async function getFreshAccessToken(): Promise<string | null> {
  const db = getDb();
  const refreshToken = getSetting(db, 'google_calendar_refresh_token');
  if (!refreshToken || !isGoogleCalendarConfigured()) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('[google-calendar] token refresh failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

interface CalendarEventInput {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
  summary: string;
  description: string;
  zoomLink?: string;
}

// Fire-and-forget from the booking route — safe no-op if Google Calendar
// hasn't been connected yet.
export async function createCalendarEvent(input: CalendarEventInput): Promise<void> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return;

  const start = new Date(`${input.date}T${input.time}:00+08:00`);
  const end = new Date(start.getTime() + input.durationMinutes * 60000);

  const body = {
    summary: input.summary,
    description: input.description,
    location: input.zoomLink || undefined,
    start: { dateTime: start.toISOString(), timeZone: 'Asia/Manila' },
    end: { dateTime: end.toISOString(), timeZone: 'Asia/Manila' },
  };

  const res = await fetch(CALENDAR_EVENTS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[google-calendar] event creation failed:', res.status, await res.text().catch(() => ''));
  }
}
