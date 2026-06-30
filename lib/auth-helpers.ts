import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Pure utilities — no next/headers import (safe to use anywhere including db.ts)

export type UserRole = 'owner' | 'staff';

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  avatar_color: string;
  permissions: string[];
}

const APP_SECRET = 'rpj-corp-ecom-2026-local';
const SESSION_COOKIE = 'rpj_session';

export { SESSION_COOKIE };

// ── Password ──────────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + ':' + salt + ':' + APP_SECRET).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = createHash('sha256').update(password + ':' + salt + ':' + APP_SECRET).digest('hex');
  return computed === hash;
}

// ── Session token ─────────────────────────────────────────────────────────────
// Signed with HMAC-SHA256 to prevent forgery. Format: base64url(payload).base64url(signature)
// Without this signature, anyone could craft their own cookie (e.g. role:"owner") and
// bypass login entirely — the signature makes tampering cryptographically detectable.

export function encodeSession(user: SessionUser): string {
  const payload   = Buffer.from(JSON.stringify(user)).toString('base64url');
  const signature = createHmac('sha256', APP_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSession(token: string): SessionUser | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = createHmac('sha256', APP_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export function sessionCookieOptions(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax' as const,
  };
}

export function clearCookieOptions() {
  return { name: SESSION_COOKIE, value: '', maxAge: 0, path: '/' };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MODULES = [
  { key: 'dashboard',        label: 'Dashboard',        icon: '📊' },
  { key: 'products',         label: 'Products',         icon: '🏷️' },
  { key: 'inventory',        label: 'Inventory',        icon: '📦' },
  { key: 'purchase_orders',  label: 'Purchase Orders',  icon: '🛒' },
  { key: 'product_research', label: 'Product Research', icon: '🔬' },
  { key: 'reports',          label: 'Reports',          icon: '📈' },
  { key: 'expenses',         label: 'Monthly Expenses', icon: '💰' },
  { key: 'partners',         label: 'SEDO Partners',    icon: '🤝' },
  { key: 'calculator',       label: 'Ecom Calculator',  icon: '🧮' },
] as const;

export type ModuleKey = typeof MODULES[number]['key'];

export const AVATAR_COLORS = [
  'blue', 'purple', 'green', 'amber', 'red',
  'pink', 'teal', 'indigo', 'orange', 'cyan',
];

export const AVATAR_BG: Record<string, string> = {
  blue:   'bg-blue-500',   purple: 'bg-purple-500', green:  'bg-green-500',
  amber:  'bg-amber-500',  red:    'bg-red-500',     pink:   'bg-pink-500',
  teal:   'bg-teal-500',   indigo: 'bg-indigo-500',  orange: 'bg-orange-500',
  cyan:   'bg-cyan-500',
};

export const AVATAR_RING: Record<string, string> = {
  blue:   'ring-blue-300',   purple: 'ring-purple-300', green:  'ring-green-300',
  amber:  'ring-amber-300',  red:    'ring-red-300',    pink:   'ring-pink-300',
  teal:   'ring-teal-300',   indigo: 'ring-indigo-300', orange: 'ring-orange-300',
  cyan:   'ring-cyan-300',
};

// Hex colors — use these for inline styles to avoid Tailwind purge issues
export const AVATAR_HEX: Record<string, string> = {
  blue:   '#3b82f6',
  purple: '#a855f7',
  green:  '#22c55e',
  amber:  '#f59e0b',
  red:    '#ef4444',
  pink:   '#ec4899',
  teal:   '#14b8a6',
  indigo: '#6366f1',
  orange: '#f97316',
  cyan:   '#06b6d4',
};
