import type Database from 'better-sqlite3';
import { DEFAULT_BUSINESS_UNITS } from './calendar';

// RPJ Operations Calendar tables. Additive only — nothing existing is altered.
// Naming follows the rest of the system (snake_case, INTEGER ids, created_at /
// updated_at, soft delete with deleted_at).
export function migrateCalendarSchema(db: Database.Database) {
  db.exec(`
    -- The calendar keeps its own list of business units (RPJ Corporate, SEDO, …).
    -- The existing "businesses" table drives the POS / Expenses dropdowns, so adding
    -- units there would show them to cashiers; business_id links the ones that match.
    CREATE TABLE IF NOT EXISTS calendar_business_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      business_id INTEGER REFERENCES businesses(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- The repeat rule of a recurring schedule. Every occurrence is a real row in
    -- calendar_events (so each can be paid / cancelled on its own).
    CREATE TABLE IF NOT EXISTS calendar_event_recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      freq TEXT NOT NULL,
      unit TEXT NOT NULL,
      interval_count INTEGER NOT NULL DEFAULT 1,
      by_weekday TEXT,
      by_monthday TEXT,
      end_type TEXT NOT NULL DEFAULT 'never',
      until_date TEXT,
      occurrence_count INTEGER,
      start_date TEXT NOT NULL,
      master_event_id INTEGER,
      generated_until TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_title TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'event' CHECK(event_type IN ('event','meeting','task')),
      category TEXT NOT NULL,
      business_unit_id INTEGER REFERENCES calendar_business_units(id),
      assigned_user_id INTEGER REFERENCES users(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      financial_type TEXT NOT NULL DEFAULT 'NONE' CHECK(financial_type IN ('PAYMENT','COLLECTION','NONE')),
      amount REAL,
      payee TEXT,
      payment_method TEXT,
      reference_no TEXT,
      account_bank TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      original_due_date TEXT,
      privacy TEXT NOT NULL DEFAULT 'public' CHECK(privacy IN ('public','restricted','private')),
      meeting_location TEXT,
      meeting_link TEXT,
      recurrence_id INTEGER REFERENCES calendar_event_recurrences(id),
      occurrence_date TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      deleted_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_date);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(financial_type, status);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_recurrence ON calendar_events(recurrence_id);
    -- A series can never get the same date twice (a deleted occurrence keeps its row,
    -- so regenerating the series never brings it back).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_series_date ON calendar_events(recurrence_id, occurrence_date) WHERE recurrence_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS calendar_event_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      days_before INTEGER NOT NULL CHECK(days_before >= 0 AND days_before <= 365),
      UNIQUE(event_id, days_before)
    );

    CREATE TABLE IF NOT EXISTS calendar_event_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      email TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_attendees_event ON calendar_event_attendees(event_id);

    -- Every payment (or collection received) against a scheduled amount. The
    -- scheduled due date is never touched; the balance is amount minus these rows.
    CREATE TABLE IF NOT EXISTS calendar_event_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_method TEXT,
      reference_no TEXT,
      remarks TEXT,
      recorded_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      voided_at TEXT,
      voided_by INTEGER REFERENCES users(id),
      void_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_payments_event ON calendar_event_payments(event_id);

    CREATE TABLE IF NOT EXISTS calendar_event_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      payment_id INTEGER REFERENCES calendar_event_payments(id),
      kind TEXT NOT NULL DEFAULT 'other',
      stored_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_attachments_event ON calendar_event_attachments(event_id);

    CREATE TABLE IF NOT EXISTS calendar_event_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      actor_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_audit_event ON calendar_event_audit_logs(event_id);

    -- Google Calendar link per event: one row per event, so an event can never be
    -- pushed twice. Financial detail is not stored here or sent to Google.
    CREATE TABLE IF NOT EXISTS calendar_google_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE REFERENCES calendar_events(id),
      google_event_id TEXT,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','synced','error','deleted')),
      meet_link TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- In-app alerts. UNIQUE keeps a reminder from being raised twice for the same
    -- person, event and day.
    CREATE TABLE IF NOT EXISTS calendar_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_id INTEGER NOT NULL REFERENCES calendar_events(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      fire_date TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, event_id, kind, fire_date)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_notifications_user ON calendar_notifications(user_id, read_at);
  `);

  const count = (db.prepare('SELECT COUNT(*) c FROM calendar_business_units').get() as { c: number }).c;
  if (count === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO calendar_business_units (name, business_id, sort_order) VALUES (?, ?, ?)');
    const existing = db.prepare('SELECT id FROM businesses WHERE lower(name) = lower(?)');
    DEFAULT_BUSINESS_UNITS.forEach((name, i) => ins.run(name, (existing.get(name) as { id: number } | undefined)?.id ?? null, i));
  }
}
