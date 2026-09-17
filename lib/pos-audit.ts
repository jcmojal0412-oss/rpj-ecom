import type Database from 'better-sqlite3';

// Shared writer for pos_sales_audit_log — every sensitive FOR PICKUP action
// (creation, financing approval/decline, remittance received, item release,
// void/refund of an unreleased pickup sale) goes through this so the trail
// is consistent. Call from inside the same transaction as the action itself.
export function logSaleAudit(db: Database.Database, saleId: number, actorUserId: number, action: string, details?: string) {
  db.prepare(
    'INSERT INTO pos_sales_audit_log (sale_id, actor_user_id, action, details) VALUES (?,?,?,?)'
  ).run(saleId, actorUserId, action, details ?? null);
}
