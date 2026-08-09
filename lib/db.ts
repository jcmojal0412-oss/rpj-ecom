import Database from 'better-sqlite3';
import path from 'path';
import { hashPassword, MODULES } from './auth-helpers';

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
