import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'rpj_session';
const APP_SECRET = 'rpj-corp-ecom-2026-local'; // must match lib/auth-helpers.ts

const PUBLIC = ['/login', '/api/auth/login', '/book', '/api/public'];

// Route → required module permission
const ROUTE_MODULES: [string, string][] = [
  ['/products',         'products'],
  ['/inventory',        'inventory'],
  ['/purchase-orders',  'purchase_orders'],
  ['/product-research', 'product_research'],
  ['/reports',          'reports'],
  ['/expenses',         'expenses'],
  ['/discovery-calls',  'partners'],
  ['/partners',         'partners'],
  ['/gross-sales',      'partners'],
  ['/calculator',       'calculator'],
  ['/service-center',   'service_center'],
  // ['/ai-product-researcher', 'ai_product_researcher'], // hidden — re-enable when ready
['/settings',         '_owner'], // owner-only flag
['/api/settings',     '_owner'], // owner-only flag
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
