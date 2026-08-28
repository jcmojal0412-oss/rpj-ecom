import Database from 'better-sqlite3';
import path from 'path';
import { hashPassword, MODULES } from './auth-helpers';
import { CASH_APPLIED_SQL, ONLINE_APPLIED_SQL } from './pos-shift-totals';

const DB_PATH =
  process.env.DATABASE_PATH ||           // Railway volume (set in env vars)
  (process.env.VERCEL ? '/tmp/rpj.db'   // Vercel serverless tmp
  : path.join(process.cwd(), 'rpj.db')); // Local development

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    migrateSchema();
    seedStatusesIfEmpty();
    seedUsersIfEmpty();
    seedPartnersIfEmpty();
    seedIfEmpty();
  }
  return db;
}

export function runTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// Category is free text, but casing must stay consistent — two spellings of
// the same category (e.g. "Electronics" vs "ELECTRONICS") silently split
// into separate filter chips everywhere categories are grouped (Products
// page, POS tabs, Inventory Movement Report). Snap a newly-typed category
// back to whatever casing already exists in the DB, case-insensitively;
// a genuinely new category keeps its as-typed casing.
export function resolveProductCategory(db: Database.Database, raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const match = db.prepare(
    `SELECT category FROM products WHERE category IS NOT NULL AND category != '' AND LOWER(category) = LOWER(?) LIMIT 1`
  ).get(trimmed) as { category: string } | undefined;
  return match?.category ?? trimmed;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      cogs REAL,
      srp REAL,
      reorder_point INTEGER DEFAULT 10,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY,
      product_id INTEGER UNIQUE REFERENCES products(id),
      quantity INTEGER DEFAULT 0,
      last_updated TEXT
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      type TEXT CHECK(type IN ('IN','OUT')),
      quantity INTEGER,
      note TEXT,
      moved_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT UNIQUE,
      supplier TEXT,
      total_amount REAL,
      status TEXT CHECK(status IN ('pending','received','cancelled')) DEFAULT 'pending',
      ordered_at TEXT,
      received_at TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS po_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER REFERENCES purchase_orders(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER,
      unit_cost REAL
    );
    CREATE TABLE IF NOT EXISTS product_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      image_ready INTEGER DEFAULT 0,
      google_link TEXT,
      cogs REAL,
      srp REAL,
      fb_page_name TEXT,
      fb_page_admin TEXT,
      status TEXT DEFAULT 'For Research',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS research_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT 'gray',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('owner','staff')) DEFAULT 'staff',
      avatar_color TEXT DEFAULT 'blue',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      module TEXT NOT NULL,
      UNIQUE(user_id, module)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function migrateSchema() {
  // Add new columns to product_research if they don't exist yet
  const cols = (db.prepare('PRAGMA table_info(product_research)').all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('supplier_details'))    db.exec('ALTER TABLE product_research ADD COLUMN supplier_details TEXT');
  if (!cols.includes('objectives'))          db.exec('ALTER TABLE product_research ADD COLUMN objectives TEXT');
  if (!cols.includes('drive_link'))          db.exec('ALTER TABLE product_research ADD COLUMN drive_link TEXT');
  if (!cols.includes('webcake_warehouse'))   db.exec('ALTER TABLE product_research ADD COLUMN webcake_warehouse INTEGER DEFAULT 0');
  if (!cols.includes('add_to_warehouse'))    db.exec('ALTER TABLE product_research ADD COLUMN add_to_warehouse INTEGER DEFAULT 0');
  if (!cols.includes('gsheet_monitoring'))   db.exec('ALTER TABLE product_research ADD COLUMN gsheet_monitoring INTEGER DEFAULT 0');
  if (!cols.includes('promo'))               db.exec('ALTER TABLE product_research ADD COLUMN promo TEXT');
  if (!cols.includes('shipping_fee'))        db.exec('ALTER TABLE product_research ADD COLUMN shipping_fee REAL DEFAULT 0');
  if (!cols.includes('ads_cost'))            db.exec('ALTER TABLE product_research ADD COLUMN ads_cost REAL DEFAULT 0');
  if (!cols.includes('rts_percent'))         db.exec('ALTER TABLE product_research ADD COLUMN rts_percent REAL DEFAULT 0');
  if (!cols.includes('done_botcake'))        db.exec('ALTER TABLE product_research ADD COLUMN done_botcake INTEGER DEFAULT 0');
  if (!cols.includes('done_webcake'))        db.exec('ALTER TABLE product_research ADD COLUMN done_webcake INTEGER DEFAULT 0');
  if (!cols.includes('bundle_price'))        db.exec('ALTER TABLE product_research ADD COLUMN bundle_price REAL');

  // Partner Sales table
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      period_label TEXT,
      sale_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Partners table
  db.exec(`
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      schedule TEXT,
      remarks TEXT,
      subscription TEXT,
      price REAL DEFAULT 0,
      assist_by TEXT,
      commission TEXT,
      referred_by TEXT,
      contract_signing TEXT,
      onboarding TEXT,
      start_ads TEXT,
      company_name TEXT,
      email TEXT,
      bank TEXT,
      acct_name TEXT,
      acct_number TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Auto-grant ALL current MODULES to every owner account.
  // Whenever a new module/feature is added to MODULES in auth-helpers.ts,
  // this keeps owner permissions in sync automatically — no manual migration needed.
  const owners = db.prepare("SELECT id FROM users WHERE role='owner'").all() as { id: number }[];
  const grantPerm = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, module) VALUES (?,?)');
  for (const o of owners) {
    for (const m of MODULES) grantPerm.run(o.id, m.key);
  }

  // Login rate limiting columns
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
  if (!userCols.includes('failed_attempts')) db.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0');
  if (!userCols.includes('locked_until'))    db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');

  // Partner active status column
  const partnerCols = (db.prepare('PRAGMA table_info(partners)').all() as { name: string }[]).map(c => c.name);
  if (!partnerCols.includes('active')) db.exec('ALTER TABLE partners ADD COLUMN active INTEGER DEFAULT 1');

  // Purchase order payment tracking
  const poCols = (db.prepare('PRAGMA table_info(purchase_orders)').all() as { name: string }[]).map(c => c.name);
  if (!poCols.includes('paid_amount'))    db.exec('ALTER TABLE purchase_orders ADD COLUMN paid_amount REAL DEFAULT 0');
  if (!poCols.includes('payment_date'))   db.exec('ALTER TABLE purchase_orders ADD COLUMN payment_date TEXT');
  if (!poCols.includes('payment_notes'))  db.exec('ALTER TABLE purchase_orders ADD COLUMN payment_notes TEXT');
  if (!poCols.includes('receipt_path'))   db.exec('ALTER TABLE purchase_orders ADD COLUMN receipt_path TEXT');

  // AI Product Researcher fields on products
  const prodCols = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map(c => c.name);
  if (!prodCols.includes('ai_score'))                db.exec('ALTER TABLE products ADD COLUMN ai_score REAL');
  if (!prodCols.includes('season'))                  db.exec('ALTER TABLE products ADD COLUMN season TEXT');
  if (!prodCols.includes('research_notes'))          db.exec('ALTER TABLE products ADD COLUMN research_notes TEXT');
  if (!prodCols.includes('decision'))                db.exec('ALTER TABLE products ADD COLUMN decision TEXT');
  if (!prodCols.includes('perceived_value_score'))   db.exec('ALTER TABLE products ADD COLUMN perceived_value_score REAL');
  if (!prodCols.includes('ai_research_json'))        db.exec('ALTER TABLE products ADD COLUMN ai_research_json TEXT');
  if (!prodCols.includes('barcode'))                 db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');

  // Expenses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      category TEXT,
      reference_no TEXT,
      bank_from TEXT,
      bank_to TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Service Center Monitoring — repair job tracking with revenue split
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_date TEXT NOT NULL,
      repair_details TEXT,
      unit_model TEXT,
      cs_payment REAL DEFAULT 0,
      cogs REAL DEFAULT 0,
      labor_amount REAL DEFAULT 0,
      bns_share REAL DEFAULT 0,
      gerald_share REAL DEFAULT 0,
      dp REAL DEFAULT 0,
      status TEXT DEFAULT 'ONGOING',
      paid_to_tech INTEGER DEFAULT 0,
      tech_paid_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Public discovery-call booking page — weekly availability schedule
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER UNIQUE NOT NULL, -- 0=Sun..6=Sat
      start_time TEXT NOT NULL,            -- "09:00"
      end_time TEXT NOT NULL,              -- "17:00"
      enabled INTEGER DEFAULT 1
    );
  `);
  seedBookingAvailabilityIfEmpty();

  // Multi-range weekly availability (supersedes booking_availability's
  // 1-range-per-day limit — day_of_week is UNIQUE there so ALTER TABLE can't
  // lift it). booking_availability is left in place, untouched, as a safe
  // rollback point.
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL, -- 0=Sun..6=Sat, no UNIQUE — multiple ranges/day allowed
      start_time TEXT NOT NULL,     -- "09:00"
      end_time TEXT NOT NULL,       -- "12:00"
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0  -- preserves range display order within a day
    );
    CREATE INDEX IF NOT EXISTS idx_booking_slots_dow ON booking_slots(day_of_week);
  `);
  seedBookingSlotsFromAvailabilityIfEmpty();

  // Booking reminder tracking (24h-before and 1h-before emails)
  const partnerCols2 = (db.prepare('PRAGMA table_info(partners)').all() as { name: string }[]).map(c => c.name);
  if (!partnerCols2.includes('reminder_24h_sent')) db.exec('ALTER TABLE partners ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0');
  if (!partnerCols2.includes('reminder_1h_sent'))  db.exec('ALTER TABLE partners ADD COLUMN reminder_1h_sent INTEGER DEFAULT 0');

  // Same, but for SMS reminders — tracked separately since a booking may
  // have email delivery succeed while SMS fails (or vice versa, e.g. no
  // contact number on file).
  if (!partnerCols2.includes('sms_24h_sent')) db.exec('ALTER TABLE partners ADD COLUMN sms_24h_sent INTEGER DEFAULT 0');
  if (!partnerCols2.includes('sms_1h_sent'))  db.exec('ALTER TABLE partners ADD COLUMN sms_1h_sent INTEGER DEFAULT 0');

  // Financing-provider sales log — populated by AI-scanned screenshots
  // (Skyro/Billease/Salmon/Home Credit/POS Terminal) or manual entry.
  db.exec(`
    CREATE TABLE IF NOT EXISTS financing_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      amount REAL NOT NULL,
      sale_date TEXT,
      customer_name TEXT,
      reference_no TEXT,
      notes TEXT,
      screenshot_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_financing_sales_provider ON financing_sales(provider);
  `);

  // Employee Attendance Module V1 — event-sourced (append-only) attendance
  // log, plus OT-approval and correction-request review queues. Corrections
  // never mutate an existing event: approving one INSERTs a new row (source
  // = 'correction') and marks the old row's superseded_by, so the full
  // history stays intact for audit purposes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('TIME_IN','COFFEE_OUT','COFFEE_IN','LUNCH_OUT','LUNCH_IN','TIME_OUT')),
      event_time TEXT NOT NULL,
      photo_path TEXT,
      source TEXT NOT NULL DEFAULT 'clock' CHECK(source IN ('clock','correction','system')),
      correction_id INTEGER REFERENCES attendance_corrections(id),
      superseded_by INTEGER REFERENCES attendance_events(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_events_user_date ON attendance_events(user_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_events_date ON attendance_events(event_date);

    CREATE TABLE IF NOT EXISTS attendance_ot_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_date TEXT NOT NULL,
      time_out_event_id INTEGER REFERENCES attendance_events(id),
      excess_minutes INTEGER NOT NULL,
      approved_minutes INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
      remarks TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, event_date)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_ot_status ON attendance_ot_requests(status);

    CREATE TABLE IF NOT EXISTS attendance_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_date TEXT NOT NULL,
      original_event_id INTEGER REFERENCES attendance_events(id),
      requested_event_type TEXT NOT NULL CHECK(requested_event_type IN ('TIME_IN','COFFEE_OUT','COFFEE_IN','LUNCH_OUT','LUNCH_IN','TIME_OUT')),
      requested_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
      remarks TEXT,
      new_event_id INTEGER REFERENCES attendance_events(id),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_corrections_user_date ON attendance_corrections(user_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_corrections_status ON attendance_corrections(status);

    CREATE TABLE IF NOT EXISTS attendance_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id),
      event_date TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_audit_target ON attendance_audit_log(target_user_id, event_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_audit_auto_absent
      ON attendance_audit_log(target_user_id, event_date, action) WHERE action = 'auto_absent';
  `);
  seedAttendanceSettingsIfEmpty();

  // Admin Test/Simulation Mode — lets an owner/attendance-admin create
  // fabricated clock events for QA without waiting for real clock time.
  // is_test=1 rows are invisible to every real read path (today, clock,
  // records, live-status, the background jobs) — see the AND is_test = 0
  // filters added alongside each of those queries. Only the dedicated
  // /api/attendance/test/* routes ever read or write is_test=1 rows.
  const attendanceEventCols = (db.prepare('PRAGMA table_info(attendance_events)').all() as { name: string }[]).map(c => c.name);
  if (!attendanceEventCols.includes('is_test')) {
    db.exec('ALTER TABLE attendance_events ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0');
  }

  // Shift Templates — replaces the single global work_start/work_end/
  // grace_period_minutes assumption. attendance_work_start/work_end/
  // grace_period_minutes rows in app_settings are left in place (harmless,
  // unread) as a safe rollback point, same pattern as booking_availability
  // being superseded by booking_slots. Every calculation now resolves the
  // shift that was actually in effect for a given employee on a given
  // date via attendance_shift_assignments — NOT the employee's current
  // shift — so changing someone's shift never rewrites how past dates are
  // computed. attendance_events, attendance_ot_requests, and
  // attendance_corrections are untouched by this change (still only
  // reference user_id), exactly as anticipated when the module first shipped.
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      grace_period_minutes INTEGER NOT NULL DEFAULT 15,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance_shift_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      shift_id INTEGER NOT NULL REFERENCES attendance_shifts(id),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shift_assignments_user ON attendance_shift_assignments(user_id, effective_from);
  `);
  seedShiftsIfEmpty();

  // Employee / 201-File Module — separates HR employee records from
  // `users` (system login accounts). Not every system user is an actual
  // employee, and not every employee needs a system login (linked_user_id
  // is optional). employee_id is derived at read time as
  // "RPJ-" + id padded to 4 digits — never stored, so it can't drift from
  // the row's real id.
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      mobile_number TEXT,
      email TEXT,
      address TEXT,
      birthday TEXT,
      emergency_contact_name TEXT,
      emergency_contact_number TEXT,
      position TEXT,
      department TEXT,
      branch TEXT,
      date_hired TEXT,
      employment_type TEXT NOT NULL CHECK(employment_type IN ('Regular','Probationary','Contractual')) DEFAULT 'Probationary',
      employment_status TEXT NOT NULL CHECK(employment_status IN ('Active','Inactive','Resigned','Terminated')) DEFAULT 'Active',
      work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
      rest_day INTEGER,
      attendance_enabled INTEGER NOT NULL DEFAULT 1,
      linked_user_id INTEGER REFERENCES users(id),
      salary_type TEXT NOT NULL CHECK(salary_type IN ('Monthly','Daily')) DEFAULT 'Monthly',
      basic_rate REAL NOT NULL DEFAULT 0,
      allowance REAL NOT NULL DEFAULT 0,
      ot_eligible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_linked_user ON employees(linked_user_id) WHERE linked_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status, attendance_enabled);
  `);

  // Attendance identity migrates from user_id to employee_id — added
  // alongside the existing user_id columns (left in place, unread, as a
  // safe rollback point) rather than replacing them, since SQLite can't
  // cleanly redefine a column's meaning in place.
  const addColIfMissing = (table: string, col: string, ddl: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColIfMissing('attendance_events', 'employee_id', 'employee_id INTEGER REFERENCES employees(id)');
  addColIfMissing('attendance_ot_requests', 'employee_id', 'employee_id INTEGER REFERENCES employees(id)');
  addColIfMissing('attendance_corrections', 'employee_id', 'employee_id INTEGER REFERENCES employees(id)');
  addColIfMissing('attendance_shift_assignments', 'employee_id', 'employee_id INTEGER REFERENCES employees(id)');
  addColIfMissing('attendance_audit_log', 'employee_id', 'employee_id INTEGER REFERENCES employees(id)');

  // markAbsentees' idempotency guard now keys off employee_id (new rows no
  // longer populate the legacy target_user_id column, which would make
  // the old target_user_id-based unique index useless — NULL != NULL for
  // SQLite uniqueness purposes, so every new row would look distinct).
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_audit_auto_absent_employee
      ON attendance_audit_log(employee_id, event_date, action) WHERE action = 'auto_absent';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_ot_employee_date
      ON attendance_ot_requests(employee_id, event_date) WHERE employee_id IS NOT NULL;
  `);

  // attendance_ot_requests.user_id was NOT NULL + FK(users.id) from before
  // employees existed. With foreign_keys=ON, callers with no linked_user_id
  // had no valid value to write there, so flagPotentialOvertime() threw for
  // every unlinked employee. The real idempotency guard is now the
  // employee_id partial unique index just above, so this dead column only
  // needs to stop demanding a value — one-time table rebuild, guarded so it
  // only runs while the column is still NOT NULL.
  const otUserIdCol = (db.prepare("PRAGMA table_info(attendance_ot_requests)").all() as { name: string; notnull: number }[])
    .find(c => c.name === 'user_id');
  if (otUserIdCol && otUserIdCol.notnull) {
    db.exec(`
      CREATE TABLE attendance_ot_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        event_date TEXT NOT NULL,
        time_out_event_id INTEGER REFERENCES attendance_events(id),
        excess_minutes INTEGER NOT NULL,
        approved_minutes INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
        remarks TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        employee_id INTEGER REFERENCES employees(id),
        UNIQUE(user_id, event_date)
      );
      INSERT INTO attendance_ot_requests_new SELECT
        id, user_id, event_date, time_out_event_id, excess_minutes, approved_minutes,
        status, remarks, reviewed_by, reviewed_at, created_at, employee_id
      FROM attendance_ot_requests;
      DROP TABLE attendance_ot_requests;
      ALTER TABLE attendance_ot_requests_new RENAME TO attendance_ot_requests;
      CREATE INDEX IF NOT EXISTS idx_attendance_ot_status ON attendance_ot_requests(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_ot_employee_date
        ON attendance_ot_requests(employee_id, event_date) WHERE employee_id IS NOT NULL;
    `);
  }

  // Same dead-column story as attendance_ot_requests above, but for
  // attendance_events — needed so the unauthenticated Attendance Kiosk can
  // record a clock event for an employee with no linked_user_id and no
  // admin session to attribute it to (there's simply no valid users.id to
  // put there). employee_id is already the real identity column read by
  // every real query; this only removes the obsolete NOT NULL requirement.
  const evUserIdCol = (db.prepare("PRAGMA table_info(attendance_events)").all() as { name: string; notnull: number }[])
    .find(c => c.name === 'user_id');
  if (evUserIdCol && evUserIdCol.notnull) {
    db.exec(`
      CREATE TABLE attendance_events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        event_date TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('TIME_IN','COFFEE_OUT','COFFEE_IN','LUNCH_OUT','LUNCH_IN','TIME_OUT')),
        event_time TEXT NOT NULL,
        photo_path TEXT,
        source TEXT NOT NULL DEFAULT 'clock' CHECK(source IN ('clock','correction','system')),
        correction_id INTEGER REFERENCES attendance_corrections(id),
        superseded_by INTEGER REFERENCES attendance_events(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT (datetime('now')),
        is_test INTEGER NOT NULL DEFAULT 0,
        employee_id INTEGER REFERENCES employees(id)
      );
      INSERT INTO attendance_events_new SELECT
        id, user_id, event_date, event_type, event_time, photo_path, source,
        correction_id, superseded_by, created_by, created_at, is_test, employee_id
      FROM attendance_events;
      DROP TABLE attendance_events;
      ALTER TABLE attendance_events_new RENAME TO attendance_events;
      CREATE INDEX IF NOT EXISTS idx_attendance_events_user_date ON attendance_events(user_id, event_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_events_date ON attendance_events(event_date);
    `);
  }

  seedEmployeesFromUsersIfEmpty();

  // Date-specific shift overrides — separate from attendance_shift_assignments
  // (the employee's permanent "Default Shift", historized so reassigning it
  // never rewrites past dates). An override applies to exactly ONE date, for
  // a temporary schedule change (e.g. covering someone else's shift for a
  // day), and never touches the assignment history table. Resolution order
  // (see getEffectiveShiftForDate in lib/attendance-shifts.ts): override for
  // that exact date, else the employee's default shift as of that date.
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_shift_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      override_date TEXT NOT NULL,
      shift_id INTEGER NOT NULL REFERENCES attendance_shifts(id),
      reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_id, override_date)
    );
    CREATE INDEX IF NOT EXISTS idx_shift_overrides_employee_date ON attendance_shift_overrides(employee_id, override_date);
  `);

  // Attendance Exceptions / Leave Management V1 — makes attendance
  // payroll-ready by distinguishing a genuine no-show (Absent) from an
  // approved non-working day (Rest Day, approved Leave, Official Business /
  // Authorized Absence / Company Event, or a non-working Holiday). None of
  // this touches the pure computation engine in lib/attendance.ts — it's a
  // resolution layer (see lib/attendance-exceptions.ts) that runs AFTER
  // computeDaySummary() and only ever overrides an 'absent' or (on a rest
  // day) 'not_started' result, exactly the same "push identity/scoping
  // resolution into a separate DB-touching layer" pattern used for shifts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS leave_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      annual_credits REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      day_type TEXT NOT NULL CHECK(day_type IN ('full','half')) DEFAULT 'full',
      reason TEXT NOT NULL,
      attachment_path TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
      remarks TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_range ON leave_requests(employee_id, from_date, to_date);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      holiday_type TEXT NOT NULL DEFAULT 'Regular Holiday',
      is_working INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

    CREATE TABLE IF NOT EXISTS attendance_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      exception_type TEXT NOT NULL CHECK(exception_type IN ('official_business','authorized_absence','company_event')),
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_employee_range ON attendance_exceptions(employee_id, from_date, to_date);
  `);
  seedLeaveTypesIfEmpty();

  // Payroll V1 — computes off the already-built Attendance/Leave/Employee
  // data (never re-implements any of it). payroll_entries stores a FULL
  // SNAPSHOT of every source value used (rate, allowance, attendance
  // totals, approved OT, computed pay breakdown) at generation time — once
  // written, nothing here is ever re-read live from employees/
  // attendance_events/leave_requests again, so editing an employee's
  // salary, shift, or old attendance can never change a historical payroll
  // run. See lib/payroll.ts (pure calculation engine, no DB access — same
  // "engine never changes" principle as lib/attendance.ts) and
  // lib/payroll-data.ts (the DB-touching aggregation layer that builds the
  // snapshot). Explicitly NOT built yet per instruction: SSS, PhilHealth,
  // Pag-IBIG, withholding tax, 13th month — Phase 2.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','for_review','approved','paid','locked')) DEFAULT 'draft',
      generated_by INTEGER REFERENCES users(id),
      generated_at TEXT DEFAULT (datetime('now')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      paid_by INTEGER REFERENCES users(id),
      paid_at TEXT,
      locked_by INTEGER REFERENCES users(id),
      locked_at TEXT,
      payslips_generated_by INTEGER REFERENCES users(id),
      payslips_generated_at TEXT,
      UNIQUE(from_date, to_date)
    );

    CREATE TABLE IF NOT EXISTS payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      employee_name_snapshot TEXT NOT NULL,
      employee_code_snapshot TEXT NOT NULL,
      position_snapshot TEXT,
      salary_type_snapshot TEXT NOT NULL,
      basic_rate_snapshot REAL NOT NULL,
      allowance_snapshot REAL NOT NULL,
      work_days_count INTEGER NOT NULL DEFAULT 0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      undertime_minutes INTEGER NOT NULL DEFAULT 0,
      excess_break_minutes INTEGER NOT NULL DEFAULT 0,
      absence_days REAL NOT NULL DEFAULT 0,
      unpaid_leave_days REAL NOT NULL DEFAULT 0,
      approved_ot_minutes INTEGER NOT NULL DEFAULT 0,
      ot_multiplier_snapshot REAL NOT NULL DEFAULT 1.25,
      basic_pay REAL NOT NULL DEFAULT 0,
      ot_pay REAL NOT NULL DEFAULT 0,
      allowance_pay REAL NOT NULL DEFAULT 0,
      bonus_earnings REAL NOT NULL DEFAULT 0,
      gross_pay REAL NOT NULL DEFAULT 0,
      late_deduction REAL NOT NULL DEFAULT 0,
      undertime_deduction REAL NOT NULL DEFAULT 0,
      excess_break_deduction REAL NOT NULL DEFAULT 0,
      absence_deduction REAL NOT NULL DEFAULT 0,
      unpaid_leave_deduction REAL NOT NULL DEFAULT 0,
      other_deductions REAL NOT NULL DEFAULT 0,
      total_deductions REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(payroll_period_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_entries_period ON payroll_entries(payroll_period_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee ON payroll_entries(employee_id);

    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_entry_id INTEGER NOT NULL REFERENCES payroll_entries(id),
      adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('bonus','incentive','additional_allowance','other_earning','cash_advance','loan_deduction','other_deduction')),
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      added_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_entry ON payroll_adjustments(payroll_entry_id);

    CREATE TABLE IF NOT EXISTS payroll_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_period_id INTEGER REFERENCES payroll_periods(id),
      payroll_entry_id INTEGER REFERENCES payroll_entries(id),
      actor_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_audit_period ON payroll_audit_log(payroll_period_id);
  `);
  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('payroll_ot_multiplier', '1.25')`).run();

  // Soft-delete ("Void") for payroll periods — a period is never hard
  // deleted (see app/api/payroll/periods/[id]/route.ts DELETE), just
  // flagged and hidden from the default list, keeping payroll_entries/
  // payroll_adjustments/payroll_audit_log fully intact.
  addColIfMissing('payroll_periods', 'voided_at', 'voided_at TEXT');
  addColIfMissing('payroll_periods', 'voided_by', 'voided_by INTEGER REFERENCES users(id)');

  // Statutory Contributions V1 — SSS, PhilHealth, Pag-IBIG. Employee share
  // reduces Net Pay; employer share (+ SSS EC) is tracked as company cost
  // only, never subtracted — see lib/statutory-contributions.ts and the
  // computeStatutoryContributionsForPeriod() aggregator in
  // lib/payroll-data.ts. Rate/bracket data is VERSIONED here rather than
  // hardcoded in code, so a future rate change is a new version row, never
  // a rewrite of already-generated payroll — every payroll_entries row
  // freezes which version label produced its numbers (see the
  // *_version_snapshot columns below), same "snapshot everything, never
  // re-read live" principle as the rest of Payroll V1. No withholding tax
  // yet — explicitly out of scope per instruction.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sss_contribution_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_label TEXT NOT NULL UNIQUE,
      effective_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sss_contribution_brackets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES sss_contribution_versions(id),
      min_compensation REAL NOT NULL,
      max_compensation REAL,
      msc REAL NOT NULL,
      ee_amount REAL NOT NULL,
      er_amount REAL NOT NULL,
      ec_amount REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sss_brackets_version ON sss_contribution_brackets(version_id, min_compensation);

    CREATE TABLE IF NOT EXISTS philhealth_contribution_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_label TEXT NOT NULL UNIQUE,
      effective_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      premium_rate REAL NOT NULL,
      income_floor REAL NOT NULL,
      income_ceiling REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pagibig_contribution_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_label TEXT NOT NULL UNIQUE,
      effective_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      ee_rate_low REAL NOT NULL,
      ee_rate_high REAL NOT NULL,
      ee_low_threshold REAL NOT NULL,
      er_rate REAL NOT NULL,
      max_fund_salary REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  seedStatutoryContributionTablesIfEmpty();

  addColIfMissing('employees', 'sss_number', 'sss_number TEXT');
  addColIfMissing('employees', 'philhealth_number', 'philhealth_number TEXT');
  addColIfMissing('employees', 'pagibig_number', 'pagibig_number TEXT');
  addColIfMissing('employees', 'sss_enabled', 'sss_enabled INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('employees', 'philhealth_enabled', 'philhealth_enabled INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('employees', 'pagibig_enabled', 'pagibig_enabled INTEGER NOT NULL DEFAULT 1');

  // Employee-share DEFAULT deduction amounts (per payroll cutoff) — pre-fill
  // the manual Statutory Contributions entry in Payroll (see
  // app/api/payroll/periods/route.ts's generate step) so HR isn't retyping
  // the same peso figure every run. Still fully editable per-run afterward
  // via PUT /api/payroll/entries/[id]/contributions — this is a starting
  // value, not an override. Employee share only (not employer share),
  // matching what was actually asked for.
  addColIfMissing('employees', 'sss_deduction_amount', 'sss_deduction_amount REAL NOT NULL DEFAULT 0');
  addColIfMissing('employees', 'philhealth_deduction_amount', 'philhealth_deduction_amount REAL NOT NULL DEFAULT 0');
  addColIfMissing('employees', 'pagibig_deduction_amount', 'pagibig_deduction_amount REAL NOT NULL DEFAULT 0');

  addColIfMissing('payroll_entries', 'contribution_basis_snapshot', 'contribution_basis_snapshot REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'sss_ee_contribution', 'sss_ee_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'sss_er_contribution', 'sss_er_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'sss_ec_contribution', 'sss_ec_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'sss_version_snapshot', 'sss_version_snapshot TEXT');
  addColIfMissing('payroll_entries', 'philhealth_ee_contribution', 'philhealth_ee_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'philhealth_er_contribution', 'philhealth_er_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'philhealth_version_snapshot', 'philhealth_version_snapshot TEXT');
  addColIfMissing('payroll_entries', 'pagibig_ee_contribution', 'pagibig_ee_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'pagibig_er_contribution', 'pagibig_er_contribution REAL NOT NULL DEFAULT 0');
  addColIfMissing('payroll_entries', 'pagibig_version_snapshot', 'pagibig_version_snapshot TEXT');

  // AI FB Ads Generator V1 — one row per generated creative. product_id is
  // nullable (staff can generate for a product not yet in the Products
  // module, via manual entry + uploaded image). source_image_path is the
  // reference photo sent to the image API; generated_image_path is the
  // result. Both live in the same persistent-storage convention already
  // used by receipts (see app/api/upload/receipt/route.ts) — a subfolder
  // next to the SQLite file on Railway, public/ai-fb-ads locally.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_fb_ad_creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      selling_price REAL,
      old_price REAL,
      offer TEXT,
      benefits TEXT,
      headline TEXT,
      cta TEXT NOT NULL DEFAULT 'Shop Now',
      creative_style TEXT NOT NULL DEFAULT 'auto',
      format TEXT NOT NULL DEFAULT '4:5',
      source_image_path TEXT,
      generated_image_path TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_fb_ad_creatives_product ON ai_fb_ad_creatives(product_id);
  `);

  // Command Center V2 — owner-only personal executive assistant (Goldie).
  // Single-user by design (no created_by/user scoping — see middleware.ts
  // '_owner' gate on /command-center and /api/command-center), so schema
  // stays intentionally simple per the original spec. category is plain
  // TEXT (not a FK) — cc_categories just powers the Settings suggestion
  // list, doesn't constrain what gets typed/spoken.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cc_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cc_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      due_date TEXT,
      due_time TEXT,
      priority TEXT NOT NULL DEFAULT 'Normal' CHECK(priority IN ('Urgent','High','Normal','Low')),
      status TEXT NOT NULL DEFAULT 'To Do' CHECK(status IN ('To Do','In Progress','Waiting','Completed','Cancelled')),
      source TEXT NOT NULL DEFAULT 'typed' CHECK(source IN ('typed','voice')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cc_tasks_due ON cc_tasks(due_date, status);

    CREATE TABLE IF NOT EXISTS cc_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      remind_date TEXT,
      remind_time TEXT,
      recurrence TEXT NOT NULL DEFAULT 'once' CHECK(recurrence IN ('once','daily','weekly','monthly')),
      recurrence_day TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done','cancelled')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cc_follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status_note TEXT,
      category TEXT,
      follow_up_date TEXT,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','done','cancelled')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cc_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      goal TEXT,
      category TEXT,
      deadline TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cc_plan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES cc_plans(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cc_plan_tasks_plan ON cc_plan_tasks(plan_id);

    -- Dedupe log for Goldie's spoken reminders — one row per (entity, day)
    -- actually announced, so the ~60s due-now poll doesn't repeat the same
    -- task/reminder over and over, but still announces fresh each new day.
    CREATE TABLE IF NOT EXISTS cc_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('task','reminder')),
      entity_id INTEGER NOT NULL,
      fired_for_date TEXT NOT NULL,
      spoken_text TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_type, entity_id, fired_for_date)
    );
  `);

  // Marketing Analytics — one row per calendar day of marketing/store
  // performance, entered manually via the Daily Records page. Derived KPIs
  // (CAC, conversion rate, ROAS, avg spend/buyer) are intentionally NOT
  // stored — always computed from these raw fields (see lib/marketing-analytics.ts)
  // so they can never drift out of sync with the source numbers.
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_date TEXT NOT NULL UNIQUE,
      marketing_spend REAL NOT NULL DEFAULT 0,
      gross_sales REAL NOT NULL DEFAULT 0,
      total_buyers INTEGER NOT NULL DEFAULT 0,
      new_customers INTEGER NOT NULL DEFAULT 0,
      store_visits INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_performance_date ON marketing_performance(entry_date);
  `);

  // Service Center repairs — order/receipt reference numbers
  const repairCols = (db.prepare('PRAGMA table_info(service_repairs)').all() as { name: string }[]).map(c => c.name);
  if (!repairCols.includes('order_no'))   db.exec('ALTER TABLE service_repairs ADD COLUMN order_no TEXT');
  if (!repairCols.includes('receipt_no')) db.exec('ALTER TABLE service_repairs ADD COLUMN receipt_no TEXT');

  // Service Center rework — independent repair/collection/payout tracking.
  // repair_status replaces the old binary status ('ONGOING'/'CUSTOMER PAID')
  // as the operational-progress field. Customer payment status and
  // technician payout status are now DERIVED (never stored) from these two
  // ledger tables, so partial payments/payouts are representable — the old
  // status field is left in place, untouched, for backward compatibility,
  // but is no longer read by the application.
  if (!repairCols.includes('repair_status'))     db.exec('ALTER TABLE service_repairs ADD COLUMN repair_status TEXT');
  if (!repairCols.includes('technician_name'))   db.exec('ALTER TABLE service_repairs ADD COLUMN technician_name TEXT');
  if (!repairCols.includes('customer_name'))     db.exec('ALTER TABLE service_repairs ADD COLUMN customer_name TEXT');
  if (!repairCols.includes('contact_number'))    db.exec('ALTER TABLE service_repairs ADD COLUMN contact_number TEXT');
  if (!repairCols.includes('notes'))             db.exec('ALTER TABLE service_repairs ADD COLUMN notes TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS service_repair_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL REFERENCES service_repairs(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT,
      reference_notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_service_repair_payments_repair ON service_repair_payments(repair_id);

    CREATE TABLE IF NOT EXISTS service_repair_tech_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL REFERENCES service_repairs(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT,
      reference_notes TEXT,
      processed_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_service_repair_tech_payouts_repair ON service_repair_tech_payouts(repair_id);
  `);

  // One-time backfill — only touches rows whose repair_status is still NULL,
  // i.e. rows that existed before this migration (every row created going
  // forward always gets an explicit repair_status from the API, so this
  // WHERE clause naturally never re-fires once the backfill has run).
  // Reconstructs history from the only two signals the old schema actually
  // had: `dp` (a real partial payment collected at intake — verified against
  // production data, e.g. a ₱2,500 job with dp=500 genuinely meant ₱500
  // collected / ₱2,000 owed) and `status`/`paid_to_tech` (binary flags with
  // no partial-payment or exact-date granularity, so the remaining balance
  // on a legacy 'CUSTOMER PAID' row is recorded as settled on repair_date —
  // the closest available date — and tech payouts use the already-reliable
  // tech_paid_date).
  const needsBackfill = (db.prepare(
    `SELECT COUNT(*) as c FROM service_repairs WHERE repair_status IS NULL`
  ).get() as { c: number }).c;

  if (needsBackfill > 0) {
    const legacyRows = db.prepare(`
      SELECT id, cs_payment, dp, status, repair_date, tech_paid_date, gerald_share, paid_to_tech
      FROM service_repairs WHERE repair_status IS NULL
    `).all() as {
      id: number; cs_payment: number; dp: number; status: string; repair_date: string;
      tech_paid_date: string | null; gerald_share: number; paid_to_tech: number;
    }[];

    const insertPayment = db.prepare(`
      INSERT INTO service_repair_payments (repair_id, amount, payment_date, payment_method, reference_notes)
      VALUES (?,?,?,?,?)
    `);
    const insertPayout = db.prepare(`
      INSERT INTO service_repair_tech_payouts (repair_id, amount, payment_date, payment_method, reference_notes)
      VALUES (?,?,?,?,?)
    `);
    const updateStatus = db.prepare(`UPDATE service_repairs SET repair_status=? WHERE id=?`);

    const backfill = db.transaction((rows: typeof legacyRows) => {
      for (const r of rows) {
        const dp = r.dp || 0;
        const cs = r.cs_payment || 0;
        if (dp > 0) {
          insertPayment.run(r.id, dp, r.repair_date, 'Down Payment (migrated)', 'Migrated from existing Down Payment field');
        }
        if (r.status === 'CUSTOMER PAID' && cs > dp) {
          insertPayment.run(r.id, cs - dp, r.repair_date, 'Legacy', 'Migrated — balance settled (previously marked Customer Paid)');
        }
        if (r.paid_to_tech) {
          insertPayout.run(r.id, r.gerald_share, r.tech_paid_date || r.repair_date, 'Legacy', 'Migrated from previous system');
        }
        updateStatus.run(r.status === 'CUSTOMER PAID' ? 'Completed' : 'Received', r.id);
      }
    });
    backfill(legacyRows);
  }

  // Service Center revert — the app is going back to the simple ONGOING /
  // CUSTOMER PAID status model (repair_status and the payment/payout ledger
  // tables above are no longer read by the app going forward), so any repair
  // created or edited while the richer model was live needs its
  // status/dp/paid_to_tech/tech_paid_date resynced from the real ledger data
  // once, or that state would silently be lost. Guarded so it only ever runs
  // a single time; every write after this point goes through the simple
  // fields directly again.
  const statusResynced = db.prepare(`SELECT value FROM app_settings WHERE key='service_center_status_resynced'`).get();
  if (!statusResynced) {
    const resyncRows = db.prepare(`
      SELECT r.id, r.cs_payment, r.gerald_share,
        COALESCE(p.collected, 0) as collected,
        COALESCE(t.paid_out, 0) as paid_out,
        t.last_payout_date
      FROM service_repairs r
      LEFT JOIN (SELECT repair_id, SUM(amount) as collected FROM service_repair_payments GROUP BY repair_id) p ON p.repair_id = r.id
      LEFT JOIN (SELECT repair_id, SUM(amount) as paid_out, MAX(payment_date) as last_payout_date FROM service_repair_tech_payouts GROUP BY repair_id) t ON t.repair_id = r.id
    `).all() as { id: number; cs_payment: number; gerald_share: number; collected: number; paid_out: number; last_payout_date: string | null }[];

    const updateResync = db.prepare(`UPDATE service_repairs SET status=?, dp=?, paid_to_tech=?, tech_paid_date=? WHERE id=?`);
    const resync = db.transaction((rows: typeof resyncRows) => {
      for (const r of rows) {
        const isPaid = r.cs_payment > 0 ? r.collected >= r.cs_payment - 0.005 : r.collected > 0;
        const isTechPaid = r.gerald_share > 0 && r.paid_out >= r.gerald_share - 0.005;
        updateResync.run(
          isPaid ? 'CUSTOMER PAID' : 'ONGOING',
          r.collected,
          isTechPaid ? 1 : 0,
          isTechPaid ? r.last_payout_date : null,
          r.id,
        );
      }
    });
    resync(resyncRows);
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('service_center_status_resynced', '1')`).run();
  }

  // CEO Overview — Service Center marketing spend, tracked separately from
  // repair records so the overview can weigh BNS income against what it
  // cost to generate that income.
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_center_marketing_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sc_marketing_expenses_date ON service_center_marketing_expenses(expense_date);
  `);

  // Expense Management Module — businesses this covers (more can be added
  // later by inserting rows; no admin UI for that in V1), and the columns
  // the old ad-hoc "Monthly Expenses" table never had. Added additively so
  // every existing expense row keeps working unchanged.
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  seedBusinessesIfEmpty();

  const expenseCols = (db.prepare('PRAGMA table_info(expenses)').all() as { name: string }[]).map(c => c.name);
  if (!expenseCols.includes('business_id'))     db.exec('ALTER TABLE expenses ADD COLUMN business_id INTEGER REFERENCES businesses(id)');
  if (!expenseCols.includes('paid_to'))          db.exec('ALTER TABLE expenses ADD COLUMN paid_to TEXT');
  if (!expenseCols.includes('payment_method'))   db.exec('ALTER TABLE expenses ADD COLUMN payment_method TEXT');
  if (!expenseCols.includes('receipt_path'))     db.exec('ALTER TABLE expenses ADD COLUMN receipt_path TEXT');
  if (!expenseCols.includes('ai_processed'))     db.exec('ALTER TABLE expenses ADD COLUMN ai_processed INTEGER DEFAULT 0');
  if (!expenseCols.includes('ai_confidence'))    db.exec('ALTER TABLE expenses ADD COLUMN ai_confidence TEXT');
  if (!expenseCols.includes('status'))           db.exec("ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'Verified'");
  if (!expenseCols.includes('created_by'))       db.exec('ALTER TABLE expenses ADD COLUMN created_by INTEGER REFERENCES users(id)');
  if (!expenseCols.includes('deleted_at'))       db.exec('ALTER TABLE expenses ADD COLUMN deleted_at TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
  `);

  // One-time remap of the old ad-hoc category strings to the new 7-category
  // taxonomy. Existing rows keep their status ('Verified' default from the
  // ALTER above is correct — they were manually entered and already trusted)
  // and stay unassigned to a business (never fabricated — shown as "—" and
  // only counted under "All Businesses").
  const categoriesRemapped = db.prepare(`SELECT value FROM app_settings WHERE key='expense_categories_remapped'`).get();
  if (!categoriesRemapped) {
    const remap: Record<string, string> = {
      'Supplier Payment': 'Products / Inventory',
      'Ads Budget': 'FB Ads Spent',
      'Salary': 'Payroll',
      'Utilities': 'Bills',
      'Rent': 'Rent',
      'Shipping Fee': 'Others',
      'Office Supplies': 'Others',
      'Others': 'Others',
    };
    const updateCategory = db.prepare('UPDATE expenses SET category=? WHERE category=?');
    for (const [oldCat, newCat] of Object.entries(remap)) {
      if (oldCat !== newCat) updateCategory.run(newCat, oldCat);
    }
    // Anything outside the known legacy set (or NULL) becomes 'Others' too,
    // so every row always has one of the 7 valid category values going forward.
    const validCats = ['Products / Inventory', 'Payroll', 'FB Ads Spent', 'Loan', 'Rent', 'Bills', 'Others'];
    db.prepare(`UPDATE expenses SET category='Others' WHERE category IS NULL OR category NOT IN (${validCats.map(() => '?').join(',')})`).run(...validCats);
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('expense_categories_remapped', '1')`).run();
  }

  // Point of Sale — line-itemized sales transactions. Nothing else in this
  // schema represents a per-product sale (gross_sales/financing_sales are
  // manually-entered lump sums with no product linkage), so this is new.
  // products/inventory stay untouched and business-agnostic — the same
  // shared catalog serves every business's POS.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER REFERENCES businesses(id),
      sale_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount REAL DEFAULT 0,
      additional_fee REAL DEFAULT 0,
      total REAL NOT NULL,
      cash_amount REAL DEFAULT 0,
      online_amount REAL DEFAULT 0,
      change_due REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Completed','Voided')),
      cashier_id INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pos_sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pos_sales_date ON pos_sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_pos_sales_business ON pos_sales(business_id);
    CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale ON pos_sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_pos_sale_items_product ON pos_sale_items(product_id);
  `);

  // Extra sale-level fields to match the branch POS UI: tax/service/delivery
  // as additional adjustable line items, a payment method tag (label only —
  // no real payment-gateway integration behind it), and an optional external
  // reference number (e.g. a GCash transaction ID).
  const posSaleCols = (db.prepare('PRAGMA table_info(pos_sales)').all() as { name: string }[]).map(c => c.name);
  if (!posSaleCols.includes('tax_percent'))    db.exec('ALTER TABLE pos_sales ADD COLUMN tax_percent REAL DEFAULT 0');
  if (!posSaleCols.includes('tax_amount'))     db.exec('ALTER TABLE pos_sales ADD COLUMN tax_amount REAL DEFAULT 0');
  if (!posSaleCols.includes('service_charge')) db.exec('ALTER TABLE pos_sales ADD COLUMN service_charge REAL DEFAULT 0');
  if (!posSaleCols.includes('delivery_fee'))   db.exec('ALTER TABLE pos_sales ADD COLUMN delivery_fee REAL DEFAULT 0');
  if (!posSaleCols.includes('payment_method')) db.exec('ALTER TABLE pos_sales ADD COLUMN payment_method TEXT');
  if (!posSaleCols.includes('reference_no'))   db.exec('ALTER TABLE pos_sales ADD COLUMN reference_no TEXT');

  // Partial refunds — kept separate from pos_sales/pos_sale_items so a sale's
  // own total/line totals stay the immutable historical charge amount. A
  // sale can receive multiple partial refunds over time; "how much of this
  // line has been refunded" is derived by summing pos_refund_items per
  // sale_item_id rather than mutating the original sale.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES pos_sales(id),
      refund_date TEXT NOT NULL,
      total_refund REAL NOT NULL,
      reason TEXT,
      cashier_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pos_refund_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refund_id INTEGER NOT NULL REFERENCES pos_refunds(id) ON DELETE CASCADE,
      sale_item_id INTEGER NOT NULL REFERENCES pos_sale_items(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pos_refunds_sale ON pos_refunds(sale_id);
    CREATE INDEX IF NOT EXISTS idx_pos_refund_items_refund ON pos_refund_items(refund_id);
  `);

  // COGS snapshot on each sale line (parallel to the existing unit_price
  // snapshot) so the Product Sales Report's cost/profit figures stay
  // accurate even if a product's cogs changes later. Backfilled from the
  // product's current cogs for any pre-existing rows — idempotent, only
  // touches rows that still look unset, so it's a no-op once real sales
  // start capturing it themselves at insert time.
  const saleItemCols = (db.prepare('PRAGMA table_info(pos_sale_items)').all() as { name: string }[]).map(c => c.name);
  if (!saleItemCols.includes('cogs')) db.exec('ALTER TABLE pos_sale_items ADD COLUMN cogs REAL DEFAULT 0');
  db.exec(`
    UPDATE pos_sale_items SET cogs = (SELECT COALESCE(p.cogs,0) FROM products p WHERE p.id = pos_sale_items.product_id)
    WHERE (cogs IS NULL OR cogs = 0) AND product_id IS NOT NULL
  `);

  // Freebie/promo items: selling price is forced to 0 (so revenue reports
  // are correct with zero changes to any SUM(line_total)/SUM(total) query),
  // but cogs above stays the real product cost — a freebie still costs the
  // business money, it just doesn't charge the customer. original_price
  // preserves what the item would normally have sold for, for the receipt
  // and future reporting; it's never treated as a discount.
  if (!saleItemCols.includes('is_freebie'))     db.exec('ALTER TABLE pos_sale_items ADD COLUMN is_freebie INTEGER DEFAULT 0');
  if (!saleItemCols.includes('original_price')) db.exec('ALTER TABLE pos_sale_items ADD COLUMN original_price REAL');
  if (!saleItemCols.includes('freebie_reason')) db.exec('ALTER TABLE pos_sale_items ADD COLUMN freebie_reason TEXT');

  // Cashier shifts — optional clock-in/out with cash-drawer reconciliation.
  // Starting a shift is never required to use the POS: a sale made with no
  // open shift just gets shift_id = NULL, exactly like before this feature
  // existed. cash_sales/expected_cash/actual_cash/discrepancy are computed
  // once, at the moment a shift is closed (see PUT /api/pos/shifts/[id]/close) —
  // a later refund does not retroactively edit an already-closed shift.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER REFERENCES businesses(id),
      cashier_id INTEGER REFERENCES users(id),
      time_in TEXT NOT NULL,
      time_out TEXT,
      starting_cash REAL NOT NULL DEFAULT 0,
      cash_sales REAL,
      online_sales REAL,
      expected_cash REAL,
      actual_cash REAL,
      discrepancy REAL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Closed')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pos_shifts_cashier ON pos_shifts(cashier_id);
    CREATE INDEX IF NOT EXISTS idx_pos_shifts_business ON pos_shifts(business_id);
  `);
  const posSaleCols2 = (db.prepare('PRAGMA table_info(pos_sales)').all() as { name: string }[]).map(c => c.name);
  if (!posSaleCols2.includes('shift_id')) db.exec('ALTER TABLE pos_sales ADD COLUMN shift_id INTEGER REFERENCES pos_shifts(id)');

  // Ad-hoc cash-drawer movements during an open shift (petty cash top-ups,
  // cash pulled out for a bank deposit, etc.) — separate from sales, and
  // factored into expected_cash at close time (starting_cash + cash_sales +
  // cash_in - cash_out).
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_shift_cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES pos_shifts(id),
      type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pos_shift_cash_movements_shift ON pos_shift_cash_movements(shift_id);
  `);

  // Lets an expense paid out of the shift's own cash drawer (e.g. buying
  // supplies mid-shift) be linked back to that shift for the Cashier's
  // Report's "View Expenses" detail — nullable, so it never affects any
  // expense recorded the normal way (unrelated to a POS shift).
  const expenseCols2 = (db.prepare('PRAGMA table_info(expenses)').all() as { name: string }[]).map(c => c.name);
  if (!expenseCols2.includes('shift_id')) db.exec('ALTER TABLE expenses ADD COLUMN shift_id INTEGER REFERENCES pos_shifts(id)');

  // Financing (Salmon/Skyro/BillEase): the store collects a downpayment
  // through the normal cash_amount/online_amount split, and the remaining
  // balance is financed by a third party — that remainder must never be
  // counted as cash/online collected today, so it lives in its own columns
  // rather than being folded into cash_amount/online_amount. financing_status
  // starts 'Pending' and is meant to move to 'Settled'/'Cancelled' later —
  // no settlement UI yet, this just makes sure the data can support one.
  const posSaleCols3 = (db.prepare('PRAGMA table_info(pos_sales)').all() as { name: string }[]).map(c => c.name);
  if (!posSaleCols3.includes('financing_provider'))  db.exec('ALTER TABLE pos_sales ADD COLUMN financing_provider TEXT');
  if (!posSaleCols3.includes('financing_amount'))    db.exec('ALTER TABLE pos_sales ADD COLUMN financing_amount REAL DEFAULT 0');
  if (!posSaleCols3.includes('financing_reference')) db.exec('ALTER TABLE pos_sales ADD COLUMN financing_reference TEXT');
  if (!posSaleCols3.includes('financing_status'))    db.exec('ALTER TABLE pos_sales ADD COLUMN financing_status TEXT');

  // Persisted at shift close, same pattern as cash_sales/online_sales, so the
  // Cashier's Report and Z Reading can show "Financing Receivable" as its own
  // line without it ever inflating the cash-drawer reconciliation above.
  const posShiftCols = (db.prepare('PRAGMA table_info(pos_shifts)').all() as { name: string }[]).map(c => c.name);
  if (!posShiftCols.includes('financing_receivable')) db.exec('ALTER TABLE pos_shifts ADD COLUMN financing_receivable REAL');

  // Cashback redeemed by the customer, deducted from Amount Due before any
  // payment method is chosen — kept separate from cash_amount/online_amount
  // for the same reason financing_amount is: it isn't real cash/electronic
  // money entering the drawer today, so it must never inflate cash-drawer
  // reconciliation the way lumping it into cash_amount would.
  if (!posSaleCols3.includes('cashback_amount')) db.exec('ALTER TABLE pos_sales ADD COLUMN cashback_amount REAL DEFAULT 0');

  // Downpayment/reservation the store already collected in an earlier,
  // separate transaction — applied here as a credit against today's Amount
  // Due. Distinct from financing_amount (a receivable owed by a third
  // party) and from cash_amount/online_amount (money collected today): this
  // is money the store already has, from before this sale.
  if (!posSaleCols3.includes('downpayment_applied')) db.exec('ALTER TABLE pos_sales ADD COLUMN downpayment_applied REAL DEFAULT 0');

  // Return/Exchange: a replacement sale (e.g. "EXC-000046") links back to
  // the original sale it's exchanging against, and exchange_credit_applied
  // is the value of the returned item credited toward this new purchase —
  // a deduction against Amount Due like downpayment_applied above, but kept
  // in its own field so reports never confuse "customer already paid this
  // before" with "customer is trading in an item right now."
  if (!posSaleCols3.includes('linked_sale_id'))          db.exec('ALTER TABLE pos_sales ADD COLUMN linked_sale_id INTEGER REFERENCES pos_sales(id)');
  if (!posSaleCols3.includes('exchange_credit_applied'))  db.exec('ALTER TABLE pos_sales ADD COLUMN exchange_credit_applied REAL DEFAULT 0');

  // refund_method + cash_out_amount let Expected Cash correctly subtract
  // only the portion of a refund that actually left the drawer as physical
  // cash — for a plain refund that's the full total_refund when paid back
  // in cash; for an exchange's returned item, only the leftover excess (if
  // any) after its value was applied as credit toward the new purchase, not
  // the item's full original value. Existing refunds default to 0/NULL, so
  // they correctly keep not affecting Expected Cash (unchanged behavior).
  const posRefundCols = (db.prepare('PRAGMA table_info(pos_refunds)').all() as { name: string }[]).map(c => c.name);
  if (!posRefundCols.includes('refund_method'))            db.exec('ALTER TABLE pos_refunds ADD COLUMN refund_method TEXT');
  if (!posRefundCols.includes('cash_out_amount'))           db.exec('ALTER TABLE pos_refunds ADD COLUMN cash_out_amount REAL DEFAULT 0');
  if (!posRefundCols.includes('linked_exchange_sale_id'))   db.exec('ALTER TABLE pos_refunds ADD COLUMN linked_exchange_sale_id INTEGER REFERENCES pos_sales(id)');
  if (!posRefundCols.includes('freebies_returned'))         db.exec('ALTER TABLE pos_refunds ADD COLUMN freebies_returned TEXT');

  // shift_id records which shift's drawer a refund's cash actually came out
  // of — the shift open *when the refund was processed*, not the original
  // sale's shift. A return often happens in a different (even much later)
  // shift than the purchase, so deriving this from the original sale's
  // shift_id (as computeShiftCashRefunds used to) attributes the cash-out
  // to the wrong shift, or to no shift at all if the original sale predates
  // any shift being open — silently making Expected Cash overstate what's
  // really in the drawer. Backfilled once from the original sale's shift_id
  // as a best-effort default for rows inserted before this column existed.
  if (!posRefundCols.includes('shift_id')) {
    db.exec('ALTER TABLE pos_refunds ADD COLUMN shift_id INTEGER REFERENCES pos_shifts(id)');
    db.exec(`UPDATE pos_refunds SET shift_id = (SELECT shift_id FROM pos_sales WHERE id = pos_refunds.sale_id) WHERE shift_id IS NULL`);
  }

  // Per returned line: Sellable restocks normally (same as every refund
  // before this column existed — NULL behaves identically to 'Sellable'),
  // Defective/For Inspection is kept out of sellable stock.
  const posRefundItemCols = (db.prepare('PRAGMA table_info(pos_refund_items)').all() as { name: string }[]).map(c => c.name);
  if (!posRefundItemCols.includes('condition')) db.exec('ALTER TABLE pos_refund_items ADD COLUMN condition TEXT');

  // One-time cleanup: a bulk Excel import didn't normalize category casing,
  // so the same category could land as two distinct DB values (e.g.
  // "ELECTRONICS" vs "Electronics") — each showing up as its own duplicated
  // filter chip on the Products/POS/Inventory pages even though they mean
  // the same thing. Merge every case-insensitive duplicate down to one
  // canonical spelling per group: prefer the app's known category list
  // (ProductForm's CATEGORIES) if a variant matches it, else the variant
  // with the most products. New imports/manual entries can no longer create
  // this split — see resolveProductCategory — so this never needs to re-run.
  const categoriesCaseNormalized = db.prepare(`SELECT value FROM app_settings WHERE key='product_categories_case_normalized'`).get();
  if (!categoriesCaseNormalized) {
    const KNOWN_CATEGORIES = ['General Merchandise', 'Electronics', 'Apparel', 'Home Goods', 'Beauty', 'Food & Beverage', 'Toys', 'Sports', 'Other'];
    const catRows = db.prepare(
      `SELECT category, COUNT(*) as cnt FROM products WHERE category IS NOT NULL AND category != '' GROUP BY category`
    ).all() as { category: string; cnt: number }[];
    const groups = new Map<string, { category: string; cnt: number }[]>();
    for (const r of catRows) {
      const key = r.category.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const updateCategory = db.prepare('UPDATE products SET category=? WHERE category=?');
    for (const variants of groups.values()) {
      if (variants.length < 2) continue;
      const known = KNOWN_CATEGORIES.find(k => k.toLowerCase() === variants[0].category.toLowerCase());
      const canonical = known ?? variants.reduce((a, b) => (b.cnt > a.cnt ? b : a)).category;
      for (const v of variants) {
        if (v.category !== canonical) updateCategory.run(canonical, v.category);
      }
    }
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('product_categories_case_normalized', '1')`).run();
  }

  // One-time correction: cash_sales/online_sales on already-closed shifts
  // were computed from cash_amount/online_amount directly — the customer's
  // raw tendered amount — not net of change handed back, so any cash sale
  // with change overstated cash collected (e.g. a ₱65 sale paid with a
  // ₱100 bill recorded ₱100 of "cash sales" instead of ₱65). Recompute
  // using the corrected cash-applied formula (change absorbed by the cash
  // leg first, same as everywhere else in this codebase now) so historical
  // Cashier's Report rows reconcile correctly going forward. actual_cash
  // (a physical count entered by the cashier) is never touched — only the
  // expected/derived figures are corrected.
  const shiftCashApplyFixed = db.prepare(`SELECT value FROM app_settings WHERE key='shift_cash_applied_recomputed'`).get();
  if (!shiftCashApplyFixed) {
    const closedShifts = db.prepare(`SELECT id, starting_cash, actual_cash FROM pos_shifts WHERE status='Closed'`).all() as
      { id: number; starting_cash: number; actual_cash: number | null }[];
    const shiftTotals = db.prepare(`
      SELECT COALESCE(SUM(${CASH_APPLIED_SQL}),0) as cash_sales, COALESCE(SUM(${ONLINE_APPLIED_SQL}),0) as online_sales
      FROM pos_sales WHERE shift_id = ? AND status != 'Voided'
    `);
    const shiftMovements = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE 0 END),0) as cash_in,
             COALESCE(SUM(CASE WHEN type='OUT' THEN amount ELSE 0 END),0) as cash_out
      FROM pos_shift_cash_movements WHERE shift_id = ?
    `);
    const updateShift = db.prepare(`UPDATE pos_shifts SET cash_sales=?, online_sales=?, expected_cash=?, discrepancy=? WHERE id=?`);
    for (const shift of closedShifts) {
      const totals = shiftTotals.get(shift.id) as { cash_sales: number; online_sales: number };
      const movements = shiftMovements.get(shift.id) as { cash_in: number; cash_out: number };
      const expectedCash = shift.starting_cash + totals.cash_sales + movements.cash_in - movements.cash_out;
      const discrepancy = shift.actual_cash != null ? shift.actual_cash - expectedCash : null;
      updateShift.run(totals.cash_sales, totals.online_sales, expectedCash, discrepancy, shift.id);
    }
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('shift_cash_applied_recomputed', '1')`).run();
  }

  seedCcCategoriesIfEmpty();
}

function seedBusinessesIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM businesses').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT OR IGNORE INTO businesses (name) VALUES (?)');
  for (const name of ['Bodega ni Suki', 'RPJ ECOM']) insert.run(name);
}

function seedCcCategoriesIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM cc_categories').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT OR IGNORE INTO cc_categories (name) VALUES (?)');
  for (const name of ['Bodega ni Suki', 'SEDO', 'RPJ', 'Personal', 'Marketing', 'Finance', 'Operations']) {
    insert.run(name);
  }
}

// One-time backfill: every existing users row becomes a linked, active,
// attendance-enabled employee (preserves "existing functionality keeps
// working" through this migration), and every historical attendance row
// gets its employee_id filled in from that link. Only runs once — new
// system users created AFTER this migration do NOT automatically become
// employees; that's now a conscious admin action via the Employees page,
// which is the entire point of this separation.
function seedEmployeesFromUsersIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM employees').get() as { c: number }).c;
  if (count > 0) return;

  const users = db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[];
  const insert = db.prepare(`
    INSERT INTO employees (full_name, employment_status, attendance_enabled, linked_user_id, work_days)
    VALUES (?, 'Active', 1, ?, '1,2,3,4,5')
  `);
  for (const u of users) insert.run(u.name, u.id);

  db.exec(`
    UPDATE attendance_events SET employee_id = (SELECT id FROM employees WHERE linked_user_id = attendance_events.user_id) WHERE employee_id IS NULL;
    UPDATE attendance_ot_requests SET employee_id = (SELECT id FROM employees WHERE linked_user_id = attendance_ot_requests.user_id) WHERE employee_id IS NULL;
    UPDATE attendance_corrections SET employee_id = (SELECT id FROM employees WHERE linked_user_id = attendance_corrections.user_id) WHERE employee_id IS NULL;
    UPDATE attendance_shift_assignments SET employee_id = (SELECT id FROM employees WHERE linked_user_id = attendance_shift_assignments.user_id) WHERE employee_id IS NULL;
    UPDATE attendance_audit_log SET employee_id = (SELECT id FROM employees WHERE linked_user_id = attendance_audit_log.target_user_id) WHERE employee_id IS NULL AND target_user_id IS NOT NULL;
  `);
}

function seedShiftsIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM attendance_shifts').get() as { c: number }).c;
  if (count > 0) return;

  const insert = db.prepare('INSERT INTO attendance_shifts (name, start_time, end_time, grace_period_minutes, active) VALUES (?,?,?,?,1)');
  const shiftA = insert.run('Shift A', '09:00', '18:00', 15);
  insert.run('Shift B', '10:00', '19:00', 15);
  insert.run('Shift C', '11:00', '20:00', 15);

  // Auto-assign every existing user to Shift A from a far-past date so all
  // pre-existing (and this module only just launched, so minimal) history
  // resolves consistently. Admin can reassign anyone via the Shifts tab.
  const users = db.prepare('SELECT id FROM users').all() as { id: number }[];
  const assign = db.prepare('INSERT INTO attendance_shift_assignments (user_id, shift_id, effective_from) VALUES (?, ?, ?)');
  for (const u of users) assign.run(u.id, shiftA.lastInsertRowid, '2000-01-01');
}

function seedLeaveTypesIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM leave_types').get() as { c: number }).c;
  if (count > 0) return;

  const insert = db.prepare('INSERT INTO leave_types (name, paid, active, annual_credits) VALUES (?,?,1,?)');
  insert.run('Vacation Leave', 1, 15);
  insert.run('Sick Leave', 1, 15);
  insert.run('Emergency Leave', 1, 5);
  insert.run('Unpaid Leave', 0, null);
  insert.run('Other Leave', 1, null);
}

// Seeds the initial VERSION of each statutory schedule — verified against
// official sources at build time (SSS Circular No. 2024-006; PhilHealth's
// PIA advisory confirming the 5% UHC-Law rate unchanged through 2026;
// HDMF Circular No. 460). SSS bracket amounts are computed from the
// confirmed 5% EE / 10% ER percentages rather than transcribed from a
// third-party table — a spot-check against one aggregator site found an
// internally-inconsistent row there, so deriving from the confirmed rate
// is the more reliable source. Recommend a manual cross-check against the
// SSS's own published table before relying on this for real payroll —
// see the sandbox dry-run report for exact seeded values.
function seedStatutoryContributionTablesIfEmpty() {
  const sssCount = (db.prepare('SELECT COUNT(*) as c FROM sss_contribution_versions').get() as { c: number }).c;
  if (sssCount === 0) {
    const v = db.prepare(`
      INSERT INTO sss_contribution_versions (version_label, effective_date, is_active, notes)
      VALUES ('SSS-2025-01', '2025-01-01', 1, 'RA 11199 schedule per SSS Circular No. 2024-006 — 15% total (5% EE / 10% ER) of Monthly Salary Credit, MSC range 5,000-35,000 in 500 increments, EC 10 (MSC<15,000) / 30 (MSC>=15,000).')
    `).run();
    const versionId = Number(v.lastInsertRowid);
    const insertBracket = db.prepare(`
      INSERT INTO sss_contribution_brackets (version_id, min_compensation, max_compensation, msc, ee_amount, er_amount, ec_amount)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (let msc = 5000; msc <= 35000; msc += 500) {
      const min = msc === 5000 ? 0 : msc - 250;
      const max = msc === 35000 ? null : msc + 249.99;
      const ee = Math.round(msc * 0.05);
      const er = Math.round(msc * 0.10);
      const ec = msc < 15000 ? 10 : 30;
      insertBracket.run(versionId, min, max, msc, ee, er, ec);
    }
  }

  const phCount = (db.prepare('SELECT COUNT(*) as c FROM philhealth_contribution_versions').get() as { c: number }).c;
  if (phCount === 0) {
    db.prepare(`
      INSERT INTO philhealth_contribution_versions (version_label, effective_date, is_active, premium_rate, income_floor, income_ceiling, notes)
      VALUES ('PHILHEALTH-2025-01', '2025-01-01', 1, 0.05, 10000, 100000, '5% of Monthly Basic Salary (2.5% EE / 2.5% ER); floor 10,000 (min premium 500/mo total); ceiling 100,000 (max premium 5,000/mo total) — final step of the RA 11223 UHC Law phased schedule, confirmed unchanged through 2026.')
    `).run();
  }

  const pagibigCount = (db.prepare('SELECT COUNT(*) as c FROM pagibig_contribution_versions').get() as { c: number }).c;
  if (pagibigCount === 0) {
    db.prepare(`
      INSERT INTO pagibig_contribution_versions (version_label, effective_date, is_active, ee_rate_low, ee_rate_high, ee_low_threshold, er_rate, max_fund_salary, notes)
      VALUES ('PAGIBIG-2024-02', '2024-02-01', 1, 0.01, 0.02, 1500, 0.02, 10000, 'HDMF Circular No. 460 — EE 1% if monthly compensation <= 1,500 else 2%; ER always 2%; Maximum Fund Salary (MFS) 10,000 (max 200/mo each side); effective Feb 2024, confirmed unchanged through 2026.')
    `).run();
  }
}

// V1 ships one global shift/rules config (read via app_settings, no scoping
// column). The settings loader already takes an optional userId so a future
// per-employee/per-branch/multi-shift version can branch on it (e.g. join
// against a new attendance_shifts table) without changing attendance_events
// or any of the review-queue tables — those only ever reference user_id.
function seedAttendanceSettingsIfEmpty() {
  const defaults: [string, string][] = [
    ['attendance_work_start', '09:00'],
    ['attendance_work_end', '18:00'],
    ['attendance_grace_period_minutes', '15'],
    ['attendance_lunch_break_minutes', '60'],
    ['attendance_coffee_break_minutes', '10'],
    ['attendance_coffee_breaks_allowed', '2'],
    ['attendance_lunch_break_paid', '0'],
    ['attendance_coffee_break_paid', '0'],
    ['attendance_min_minutes_before_ot', '30'],
    ['attendance_selfie_required', '1'],
    ['attendance_work_days', '1,2,3,4,5'],
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) insert.run(k, v);
}

function seedBookingAvailabilityIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM booking_availability').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO booking_availability (day_of_week, start_time, end_time, enabled) VALUES (?,?,?,?)'
  );
  // Default: Mon(1)-Fri(5) 9am-5pm enabled, Sat/Sun disabled
  for (let dow = 0; dow <= 6; dow++) {
    const enabled = dow >= 1 && dow <= 5 ? 1 : 0;
    insert.run(dow, '09:00', '17:00', enabled);
  }
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('booking_duration_minutes', '60')").run();
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('booking_min_notice_hours', '2')").run();
}

function seedBookingSlotsFromAvailabilityIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM booking_slots').get() as { c: number }).c;
  if (count > 0) return; // already migrated (or edited since) — never overwrite
  const oldRows = db.prepare(
    'SELECT day_of_week, start_time, end_time, enabled FROM booking_availability'
  ).all() as { day_of_week: number; start_time: string; end_time: string; enabled: number }[];
  const insert = db.prepare(
    'INSERT INTO booking_slots (day_of_week, start_time, end_time, enabled, sort_order) VALUES (?,?,?,?,0)'
  );
  db.transaction(() => {
    for (const r of oldRows) insert.run(r.day_of_week, r.start_time, r.end_time, r.enabled);
  })();
}

function seedStatusesIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM research_statuses').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO research_statuses (name, color, sort_order) VALUES (?,?,?)');
  const defaults: [string, string, number][] = [
    ['For Research', 'gray', 0],
    ['For Ads Testing', 'blue', 1],
    ['For FB Page', 'amber', 2],
    ['Done', 'green', 3],
  ];
  for (const [name, color, order] of defaults) insert.run(name, color, order);
}

function seedUsersIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (count > 0) return;

  const insertUser = db.prepare('INSERT INTO users (name,username,password_hash,role,avatar_color) VALUES (?,?,?,?,?)');
  const insertPerm = db.prepare('INSERT INTO user_permissions (user_id,module) VALUES (?,?)');

  const owner = insertUser.run('Owner', 'owner', hashPassword('rpj2026'), 'owner', 'indigo');
  for (const m of MODULES) insertPerm.run(owner.lastInsertRowid, m.key);

  const staff = [
    { name: 'Maria Santos',   username: 'maria', color: 'pink',   modules: ['inventory','dashboard'] },
    { name: 'Juan dela Cruz', username: 'juan',  color: 'blue',   modules: ['purchase_orders','dashboard'] },
    { name: 'Ana Reyes',      username: 'ana',   color: 'green',  modules: ['product_research','dashboard'] },
    { name: 'Carlo Mendoza',  username: 'carlo', color: 'amber',  modules: ['products','inventory','dashboard'] },
  ];
  for (const s of staff) {
    const info = insertUser.run(s.name, s.username, hashPassword('staff123'), 'staff', s.color);
    for (const m of s.modules) insertPerm.run(info.lastInsertRowid, m);
  }
}

function seedPartnersIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM partners').get() as { c: number }).c;
  if (count > 0) return;

  const ins = db.prepare(`
    INSERT INTO partners (name,contact,schedule,remarks,subscription,price,assist_by,commission,
      referred_by,contract_signing,onboarding,start_ads,company_name,email,bank,acct_name,acct_number)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  type Row = (string | number | null)[];
  const data: Row[] = [
    ['NICA MARTINEZ','9974853842','2026-06-05 17:00:00','DONE','OLD PARTNER STARTER',0,'LHEN','NONE','OLD','DONE','DONE','START','LUVI HUB','luvimarketing.nica@gmail.com','Maribank','Alexander Munoz','14281580030'],
    ['RYAN GUTIERREZ','639457401258','2026-06-08 15:40:00','PENDING','OLD PARTNER STARTER',0,'LHEN','NONE','OLD','DONE','DONE','PENDING','JUST FOR FAMILY',null,null,null,null],
    ['CHRISTIAN NG','639484649396','2026-06-08 17:00:00','DONE','ELITE WV',2999,'LHEN','RECEIVED 06/16/26','NEW','DONE','DONE','START',"ENJI'S CORP",'christiananthonypuang@gmail.com','MariBank','Christian Anthony Pua Ng','12016806638'],
    ['MARIA CHRISTZEL PADOLINA','0909-143-5794','2026-06-09 17:00:00','DONE','STARTER WV',999,'LHEN','RECEIVED 06/16/26','NEW','DONE','DONE','START','Maria Christzel Corp.','mariachristzelng@gmail.com','MariBank/SeaBank','Maria Christzel Ng Padulina','17396902489'],
    ['JOSELITO BARCELONA','639655084182','2026-06-10 15:20:00','DONE','OLD PARTNER STARTER',0,'LHEN','NONE','OLD','DONE','DONE','PENDING','Smart Click PH','jojobarcelona1869@gmail.com','BDO','Joselito A. Barcelona','10800168186'],
    ['YOLZ ANGEL GANDIA','9482805157','2026-06-17 13:00:00','DONE','STARTER WV',999,'LHEN','RECEIVED 06/26/26','NEW','DONE','DONE','PENDING','HEAVENLY ANGEL','yolandasamaniegogandia@gmail.com','BDO','Yolanda Gandia','1280696824'],
    ['RHONA JOY NUNEZ','9952198565','2026-06-17 13:00:00','DONE','STARTER WV',999,'LHEN','RECEIVED 06/26/26','NEW','DONE','DONE','PENDING','Rhona Joy Hub','rhonajoynunez@gmail.com','GoTyme Bank','RHONA JOY PERMA NUNEZ','10530395667'],
    ['CHERRIE FABILLARAN',null,'2026-06-24 00:00:00','DONE','STARTER WV',999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['CATHERINE M. BORNALES',null,'2026-06-24 00:00:00','DONE','STARTER WV',999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['ROBINJAMES ESPINA',null,'2026-06-24 00:00:00','DONE','ELITE WV',2999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['GERALD OJANOLA',null,'2026-06-24 00:00:00','DONE','STARTER WV',999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['SIDNEY UY',null,'2026-06-24 00:00:00','DONE','STARTER WV',999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['CHARLEMAGNE ALCALA',null,'2026-06-24 00:00:00','DONE','ELITE WV',2999,'LHEN',null,'NEW','DONE','DONE',null,null,null,null,null,null],
    ['FEI RUEDAS GATRU','9390805985','2026-06-10 13:00:00','PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['JEZREEL LAGATA ABELO','9122755992','2026-06-10 17:01:00','PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['EMILY NUCUP MULLON',null,null,'DONE',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['SAM CUI NARRA',null,null,'DONE',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['RED CURIOSO MANLAPAZ',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['UBIE PANGALIMAN',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['ANDREI MANALO',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['NYL NORRAB',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['MARIA ROSIEL MARCAIDA / JO NILLIE',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['MARK JOHN ESPISUA',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['ELLZYJANE OLASIMAN ONGAY',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['MARICEL HERNANDEZ',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['MICHAEL ANGELO MAULION',null,null,'NO SHOW',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['LETT MENDOZA',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['SUZETTE RUEDAS BERMUDEZ',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['AYA EMZ',null,null,'NO SHOW',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['HAROLD ANONUEVO',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['RONALDO PORTUGAL',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['FERNANDO PALOMO',null,null,'DONE',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['VINCENT INDAC',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['DIEGO MORAL-LAMOR ZEG',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
    ['ROEL BAON',null,null,'PENDING',null,0,null,null,null,null,null,null,null,null,null,null,null],
  ];

  db.transaction(() => { for (const row of data) ins.run(...row); })();
}

function seedIfEmpty() {
  // No sample products — start fresh
  // Mark as seeded so this never runs again
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('products_seeded', '1')").run();
  return;

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T',' ').slice(0,19);
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate()-n); return fmt(d); };

  const products = [
    { sku:'ELEC-001', name:'Wireless Earbuds Pro',        category:'Electronics', cogs:450,  srp:999,  reorder_point:15 },
    { sku:'ELEC-002', name:'Smart Watch Series X',        category:'Electronics', cogs:1200, srp:2499, reorder_point:10 },
    { sku:'ELEC-003', name:'Portable Bluetooth Speaker',  category:'Electronics', cogs:350,  srp:799,  reorder_point:12 },
    { sku:'ELEC-004', name:'USB-C Hub 7-in-1',            category:'Electronics', cogs:180,  srp:399,  reorder_point:20 },
    { sku:'ELEC-005', name:'Phone Stand Adjustable',      category:'Electronics', cogs:80,   srp:199,  reorder_point:25 },
    { sku:'APP-001',  name:'Premium Cotton T-Shirt',      category:'Apparel',     cogs:120,  srp:350,  reorder_point:30 },
    { sku:'APP-002',  name:'Jogger Pants Slim Fit',       category:'Apparel',     cogs:200,  srp:550,  reorder_point:20 },
    { sku:'APP-003',  name:'Hoodie Zip-Up Classic',       category:'Apparel',     cogs:280,  srp:750,  reorder_point:15 },
    { sku:'APP-004',  name:'Baseball Cap Unisex',         category:'Apparel',     cogs:90,   srp:250,  reorder_point:25 },
    { sku:'APP-005',  name:'Compression Leggings',        category:'Apparel',     cogs:160,  srp:480,  reorder_point:20 },
    { sku:'HOME-001', name:'Stainless Tumbler 500ml',     category:'Home Goods',  cogs:140,  srp:380,  reorder_point:20 },
    { sku:'HOME-002', name:'Bamboo Cutting Board Set',    category:'Home Goods',  cogs:220,  srp:580,  reorder_point:10 },
    { sku:'HOME-003', name:'Aromatherapy Diffuser',       category:'Home Goods',  cogs:310,  srp:799,  reorder_point:8  },
    { sku:'HOME-004', name:'Non-Stick Cooking Pan 28cm',  category:'Home Goods',  cogs:380,  srp:899,  reorder_point:8  },
    { sku:'HOME-005', name:'Silicone Kitchen Utensil Set',category:'Home Goods',  cogs:190,  srp:490,  reorder_point:12 },
  ];

  const insertProd = db.prepare('INSERT INTO products (sku,name,category,cogs,srp,reorder_point) VALUES (@sku,@name,@category,@cogs,@srp,@reorder_point)');
  const insertInv  = db.prepare('INSERT INTO inventory (product_id,quantity,last_updated) VALUES (?,?,?)');
  const startQty   = [45,8,30,22,5,60,18,7,40,25,12,9,35,6,20];

  db.transaction(() => {
    for (let i = 0; i < products.length; i++) {
      const info = insertProd.run(products[i]);
      insertInv.run(info.lastInsertRowid, startQty[i], fmt(now));
    }
  })();

  const pids = (db.prepare('SELECT id FROM products ORDER BY id').all() as {id:number}[]).map(r=>r.id);
  const insertMove = db.prepare('INSERT INTO stock_movements (product_id,type,quantity,note,moved_at) VALUES (?,?,?,?,?)');
  const fast=[0,5,10], slow=[4,11];

  db.transaction(() => {
    for (let day=30;day>=1;day--) {
      const date=daysAgo(day);
      for (const idx of fast) {
        insertMove.run(pids[idx],'OUT',Math.floor(Math.random()*8)+3,'Sale',date);
        if (day%5===0) insertMove.run(pids[idx],'IN',20,'Restock',date);
      }
      for (let i=0;i<pids.length;i++) {
        if (fast.includes(i)||slow.includes(i)) continue;
        if (Math.random()>0.4) insertMove.run(pids[i],'OUT',Math.floor(Math.random()*4)+1,'Sale',date);
        if (day%10===0) insertMove.run(pids[i],'IN',10,'Restock',date);
      }
      for (const idx of slow) if (day%7===0) insertMove.run(pids[idx],'OUT',1,'Sale',date);
    }
    const today=fmt(now);
    insertMove.run(pids[0],'IN',50,'New stock received',today);
    insertMove.run(pids[0],'OUT',5,'Sale',today);
    insertMove.run(pids[5],'OUT',8,'Sale',today);
    insertMove.run(pids[10],'OUT',3,'Sale',today);
  })();

  const insertPO   = db.prepare('INSERT INTO purchase_orders (po_number,supplier,total_amount,status,ordered_at,received_at,notes) VALUES (?,?,?,?,?,?,?)');
  const insertPOI  = db.prepare('INSERT INTO po_items (po_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)');

  db.transaction(() => {
    const po1 = insertPO.run('PO-20260610-001','TechSource PH',18000,'received',daysAgo(14),daysAgo(10),'Initial stock order');
    insertPOI.run(po1.lastInsertRowid,pids[0],30,450); insertPOI.run(po1.lastInsertRowid,pids[1],10,1200);
    const po2 = insertPO.run('PO-20260617-001','Fashion Hub Manila',9600,'pending',daysAgo(7),null,'Awaiting delivery');
    insertPOI.run(po2.lastInsertRowid,pids[5],30,120); insertPOI.run(po2.lastInsertRowid,pids[6],20,200); insertPOI.run(po2.lastInsertRowid,pids[7],10,280);
    const po3 = insertPO.run('PO-20260601-001','HomeKing Wholesale',5800,'cancelled',daysAgo(23),null,'Supplier unavailable');
    insertPOI.run(po3.lastInsertRowid,pids[11],20,220); insertPOI.run(po3.lastInsertRowid,pids[12],10,310);
  })();

  const insertRes = db.prepare('INSERT INTO product_research (product_name,image_ready,google_link,cogs,srp,fb_page_name,fb_page_admin,status) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    insertRes.run('LED Strip Lights RGB',1,'https://google.com/search?q=led+strip+lights',120,349,'HomeLux PH','Maria Santos','Done');
    insertRes.run('Magnetic Phone Case',0,'https://google.com/search?q=magnetic+phone+case',80,249,'GadgetZone PH','Juan dela Cruz','For Ads Testing');
    insertRes.run('Posture Corrector Belt',1,'https://google.com/search?q=posture+corrector',150,450,'HealthFirst PH','Ana Reyes','For FB Page');
    insertRes.run('Reusable Silicone Bag Set',0,null,95,280,null,null,'For Research');
    insertRes.run('Wireless Charging Pad 15W',0,'https://google.com/search?q=wireless+charger+15w',200,599,'TechDeals PH','Carlo Mendoza','For Ads Testing');
  })();

  // Mark as seeded permanently — even if all products are deleted later, won't re-seed
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('products_seeded', '1')").run();
}
