import type Database from 'better-sqlite3';

// Mirrors the login lockout in app/api/auth/login/route.ts (3 attempts / 15
// minutes) but slightly looser — a PIN is short and fat-finger typos are
// more likely than with a real password, and this is keyed per-cashier (see
// the pos_manager_pin_attempts table) rather than globally, so a higher
// threshold here doesn't meaningfully weaken the brute-force deterrent.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface PinLockoutStatus { locked: boolean; minutesLeft?: number }

// Call before checking the PIN itself. Also clears an expired lock so the
// caller's subsequent failure/success bookkeeping starts from a clean slate.
export function checkManagerPinLockout(db: Database.Database, userId: number): PinLockoutStatus {
  const row = db.prepare('SELECT locked_until FROM pos_manager_pin_attempts WHERE user_id = ?').get(userId) as { locked_until: string | null } | undefined;
  if (!row?.locked_until) return { locked: false };

  const lockedUntil = new Date(row.locked_until + 'Z'); // treat as UTC, same convention as user login lockout
  if (lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
    return { locked: true, minutesLeft };
  }

  db.prepare('UPDATE pos_manager_pin_attempts SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').run(userId);
  return { locked: false };
}

export function recordManagerPinFailure(db: Database.Database, userId: number): void {
  const row = db.prepare('SELECT failed_attempts FROM pos_manager_pin_attempts WHERE user_id = ?').get(userId) as { failed_attempts: number } | undefined;
  const attempts = (row?.failed_attempts ?? 0) + 1;

  if (attempts >= MAX_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString().slice(0, 19);
    db.prepare(`
      INSERT INTO pos_manager_pin_attempts (user_id, failed_attempts, locked_until) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until
    `).run(userId, attempts, lockUntil);
    return;
  }

  db.prepare(`
    INSERT INTO pos_manager_pin_attempts (user_id, failed_attempts) VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET failed_attempts = excluded.failed_attempts
  `).run(userId, attempts);
}

export function resetManagerPinAttempts(db: Database.Database, userId: number): void {
  db.prepare('UPDATE pos_manager_pin_attempts SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').run(userId);
}

export function lockoutMessage(minutesLeft: number): string {
  return `Too many failed PIN attempts. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`;
}
