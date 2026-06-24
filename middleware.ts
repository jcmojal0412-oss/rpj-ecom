import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'rpj_session';

const PUBLIC = ['/login', '/api/auth/login'];

// Route → required module permission
const ROUTE_MODULES: [string, string][] = [
  ['/products',         'products'],
  ['/inventory',        'inventory'],
  ['/purchase-orders',  'purchase_orders'],
  ['/product-research', 'product_research'],
  ['/reports',          'reports'],
  ['/settings',         '_owner'], // owner-only flag
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths and static assets
  if (
    PUBLIC.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/logo.png' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // No session → login
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Decode session (base64url JSON)
  let user: { role: string; permissions: string[] } | null = null;
  try {
    user = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }

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
