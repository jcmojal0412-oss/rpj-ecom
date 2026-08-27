import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'rpj_session';
const APP_SECRET = 'rpj-corp-ecom-2026-local'; // must match lib/auth-helpers.ts

// /attendance-kiosk is a shared physical-device screen with no login of its
// own (employees identify themselves by ID/email/mobile, not a password —
// see app/api/attendance-kiosk/*) — deliberately public, same as /book.
const PUBLIC = ['/login', '/api/auth/login', '/book', '/api/public', '/attendance-kiosk', '/api/attendance-kiosk'];

// Route → required module permission
const ROUTE_MODULES: [string, string][] = [
  ['/products',         'products'],
  ['/ai-fb-ads',        'ai_fb_ads'],
  ['/api/ai-fb-ads',    'ai_fb_ads'],
  ['/inventory',        'inventory'],
  ['/purchase-orders',  'purchase_orders'],
  ['/product-research', 'product_research'],
  ['/reports',          'reports'],
  ['/expenses',         'expenses'],
  ['/api/expenses',     'expenses'],
  ['/api/businesses',   'expenses'],
  ['/discovery-calls',  'partners'],
  ['/sedo-bookings',    'partners'],
  ['/partners',         'partners'],
  ['/gross-sales',      'partners'],
  ['/financing-sales',       'financing'],
  ['/api/financing-sales',   'financing'],
  ['/attendance',            'attendance'],
  ['/employees',             'employees'],
  ['/api/employees',         'employees'],
  ['/leave-management',      'leave_management'],
  ['/hr-dashboard',          'attendance'],
  ['/hr-settings',           'attendance'],
  ['/api/hr',                'attendance'],
  ['/payroll',               'payroll'],
  ['/api/payroll',           'payroll'],
  // Self-service clock in/out now lives ONLY on the unauthenticated
  // /attendance-kiosk (see PUBLIC below) — the old authenticated
  // /my-attendance page was removed. /api/attendance/* is intentionally
  // NOT listed here — that prefix mixes self-service and admin-only
  // (and now admin-on-behalf-of-employee) endpoints that a single
  // [prefix, module] rule can't distinguish by HTTP method, so every route
  // under it calls getSession() itself and does its own check. Same reason
  // /api/leave-types, /api/leave-requests, /api/holidays, and
  // /api/attendance-exceptions are NOT listed — each mixes self-service
  // (submit/view your own leave request, read active leave types/holidays)
  // with admin-only actions (approve, configure), so every route under
  // them does its own getSession() + permission check. /payroll and
  // /api/payroll ARE blanket-gated (unlike attendance/leave) because every
  // route under them is genuinely admin-only — the one self-service
  // exception, viewing your own payslip, lives under the separate
  // /payslips and /api/payslips paths, deliberately left unlisted here so
  // any logged-in employee can reach their own payslip.
  ['/calculator',       'calculator'],
  ['/pos',              'pos'],
  ['/api/pos',          'pos'],
  // CEO Overview is owner-only (income, marketing spend, net income) —
  // this must come before the generic '/service-center' rule below, since
  // ROUTE_MODULES matches on the first startsWith() hit. Repair Monitoring
  // and the repair-records API stay on the regular 'service_center'
  // permission so technicians can still log/update repairs.
  ['/service-center/ceo-overview', '_owner'],
  ['/api/service-center',          '_owner'],
  ['/service-center',   'service_center'],
  ['/api/service-repairs', 'service_center'],
  ['/marketing-analytics',     'marketing_analytics'],
  ['/api/marketing-analytics', 'marketing_analytics'],
  // ['/ai-product-researcher', 'ai_product_researcher'], // hidden — re-enable when ready
  // Booking-settings APIs are partners-gated (same population as Discovery
  // Calls), so these must come before the generic '/api/settings' owner-only
  // catch-all below — first startsWith match wins.
  ['/api/settings/availability',      'partners'],
  ['/api/settings/booking-fields',    'partners'],
  ['/api/settings/google-calendar',   'partners'],
  ['/api/settings/bookings-overview', 'partners'],
['/settings',         '_owner'], // owner-only flag
['/api/settings',     '_owner'], // owner-only flag
['/command-center',   '_owner'], // owner-only flag — personal CEO tool (Goldie)
['/api/command-center', '_owner'], // owner-only flag
];

// Always returns a Uint8Array backed by a real ArrayBuffer (never SharedArrayBuffer),
// which is what TypeScript's strict BufferSource typing for the Web Crypto API requires.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Verifies the HMAC signature (Edge-compatible, uses Web Crypto API) before trusting the payload.
async function verifySession(token: string): Promise<{ role: string; permissions: string[] } | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', toArrayBuffer(encoder.encode(APP_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, toArrayBuffer(base64urlToBytes(signature)), toArrayBuffer(encoder.encode(payload))
    );
    if (!valid) return null;

    const jsonStr = new TextDecoder().decode(base64urlToBytes(payload));
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths and static assets
  if (
    PUBLIC.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/favicon.ico' ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(pathname) // static images at the root (logos, etc.)
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // No session → login
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const user = await verifySession(token);
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Check route-level permission
  for (const [route, module_] of ROUTE_MODULES) {
    if (pathname.startsWith(route)) {
      if (module_ === '_owner' && user.role !== 'owner') {
        return NextResponse.redirect(new URL('/', request.url));
      }
      if (module_ !== '_owner' && !user.permissions.includes(module_) && user.role !== 'owner') {
        return NextResponse.redirect(new URL('/', request.url));
      }
      break;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|public/).*)'],
};
