import type Database from 'better-sqlite3';
import { addDays, weekdayOf } from './calendar';
import { CalendarError, createEvent, type Caps, type EventInput } from './calendar-service';

// Sample schedules for trying the calendar out. Dates are relative to today (rent
// tomorrow, collection the day after, …) and every row is flagged is_demo so the
// Owner can remove them all in one click — they are never loaded automatically.
export function loadDemoData(db: Database.Database, c: Caps, today: string): number {
  if ((db.prepare('SELECT COUNT(*) c FROM calendar_events WHERE is_demo = 1 AND deleted_at IS NULL').get() as { c: number }).c > 0) {
    throw new CalendarError('Sample data is already loaded. Remove it first to load it again.', 409);
  }
  const unit = (name: string) => (db.prepare('SELECT id FROM calendar_business_units WHERE name = ?').get(name) as { id: number } | undefined)?.id ?? null;
  const nextFriday = (() => { let d = today; while (weekdayOf(d) !== 5) d = addDays(d, 1); return d; })();
  const ym = today.slice(0, 7);
  const rows: EventInput[] = [
    { event_title: 'Cesar Residences Rent', category: 'payment_due', business_unit_id: unit('Bodega ni Suki'), start_date: addDays(today, 1), amount: 105000, payee: 'Cesar Residences', payment_method: 'Bank Transfer', reminders: [7, 3, 1, 0] },
    { event_title: 'J&T Expected Remittance', category: 'expected_collection', business_unit_id: unit('RPJ ECOM'), start_date: addDays(today, 2), amount: 82500, payee: 'J&T Express', reminders: [1, 0] },
    { event_title: 'Marketing Meeting', category: 'meeting', business_unit_id: unit('RPJ Corporate'), start_date: addDays(today, 3), all_day: false, start_time: '15:00', end_time: '16:00', meeting_location: 'Conference Room', privacy: 'public', reminders: [0] },
    { event_title: 'Supplier Payment', category: 'supplier_payment', business_unit_id: unit('Bodega ni Suki'), start_date: addDays(today, 4), amount: 45000, payee: 'Sample Supplier', reminders: [3, 1, 0] },
    { event_title: 'Rent Catch-Up Payment', category: 'payment_due', business_unit_id: unit('Bodega ni Suki'), start_date: nextFriday, amount: 27188.44, payee: 'Cesar Residences', reminders: [1, 0], recurrence: { freq: 'weekly', by_weekday: [5], end_type: 'never' } },
    { event_title: 'Payroll', category: 'payroll', business_unit_id: unit('RPJ Corporate'), start_date: `${ym}-08`, amount: 96500, reminders: [3, 1, 0], recurrence: { freq: 'monthly', by_monthday: [8, 15, 23, 30], end_type: 'never' } },
  ];
  let n = 0;
  db.transaction(() => { for (const r of rows) { createEvent(db, c, r, today, { demo: true }); n++; } })();
  return n;
}

// Removes ONLY the rows loaded above (and their payments, files' rows, reminders, history).
export function removeDemoData(db: Database.Database): number {
  const ids = (db.prepare('SELECT id FROM calendar_events WHERE is_demo = 1').all() as { id: number }[]).map(r => r.id);
  if (!ids.length) return 0;
  const inList = ids.map(() => '?').join(',');
  db.transaction(() => {
    for (const t of ['calendar_event_payments', 'calendar_event_attachments', 'calendar_event_audit_logs', 'calendar_event_reminders', 'calendar_event_attendees', 'calendar_notifications', 'calendar_google_sync']) {
      db.prepare(`DELETE FROM ${t} WHERE event_id IN (${inList})`).run(...ids);
    }
    db.prepare(`DELETE FROM calendar_events WHERE id IN (${inList})`).run(...ids);
    db.prepare(`DELETE FROM calendar_event_recurrences WHERE id NOT IN (SELECT recurrence_id FROM calendar_events WHERE recurrence_id IS NOT NULL)`).run();
  })();
  return ids.length;
}
