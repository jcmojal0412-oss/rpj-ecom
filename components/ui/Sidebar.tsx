'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard, Package, ShoppingCart,
  FlaskConical, BarChart3, Menu, X, Tag, LogOut, Users,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AVATAR_HEX } from '@/lib/auth-helpers';
import type { SessionUser } from '@/lib/auth-helpers';

const ALL_NAV = [
  { label: 'Dashboard',        href: '/',                 icon: LayoutDashboard, module: 'dashboard'        },
  { label: 'Products',         href: '/products',         icon: Tag,             module: 'products'         },
  { label: 'Inventory',        href: '/inventory',        icon: Package,         module: 'inventory'        },
  { label: 'Purchase Orders',  href: '/purchase-orders',  icon: ShoppingCart,    module: 'purchase_orders'  },
  { label: 'Product Research', href: '/product-research', icon: FlaskConical,    module: 'product_research' },
  { label: 'Reports',          href: '/reports',          icon: BarChart3,       module: 'reports'          },
];

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// Light blue sidebar color palette
const SIDEBAR_BG    = '#dce8f5';
const SIDEBAR_HOVER = 'rgba(30,80,160,0.09)';
const SIDEBAR_BORDER= 'rgba(30,80,160,0.12)';
const TEXT_MAIN     = '#1e3a8a';
const TEXT_MUTED    = '#5b7ab5';

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUser(u); });
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const navItems = ALL_NAV.filter(item =>
    !user || user.role === 'owner' || user.permissions.includes(item.module)
  );

  const NavContent = () => (
    <div className="flex flex-col h-full" style={{ background: SIDEBAR_BG }}>

      {/* Logo */}
      <div className="px-4 py-4 flex items-center justify-center" style={{ borderBottom: `1px solid ${SIDEBAR_BORDER}` }}>
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f1f4a', padding: '6px' }}>
          <Image src="/logo.png" alt="RPJ Corp" width={130} height={65} className="object-contain" priority />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon   = item.icon;
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: active ? '#f97316' : 'transparent',
                color:      active ? '#ffffff' : TEXT_MAIN,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = SIDEBAR_HOVER; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}

        {/* Owner-only: User Management */}
        {user?.role === 'owner' && (
          <>
            <div className="my-3" style={{ borderTop: `1px solid ${SIDEBAR_BORDER}` }} />
            <Link
              href="/settings/users"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: pathname.startsWith('/settings') ? '#f97316' : 'transparent',
                color:      pathname.startsWith('/settings') ? '#ffffff' : TEXT_MUTED,
              }}
              onMouseEnter={e => { if (!pathname.startsWith('/settings')) (e.currentTarget as HTMLElement).style.background = SIDEBAR_HOVER; }}
              onMouseLeave={e => { if (!pathname.startsWith('/settings')) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Users size={18} />
              User Management
            </Link>
          </>
        )}
      </nav>

      {/* Current user + logout */}
      {user && (
        <div className="px-3 py-3" style={{ borderTop: `1px solid ${SIDEBAR_BORDER}` }}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(30,80,160,0.07)' }}>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: AVATAR_HEX[user.avatar_color] ?? '#3b82f6' }}
            >
              {initials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: TEXT_MAIN }}>{user.name}</p>
              <p className="text-[10px] capitalize" style={{ color: TEXT_MUTED }}>{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: TEXT_MUTED }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.background = '#fee2e2'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = TEXT_MUTED; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="px-5 py-3" style={{ borderTop: `1px solid ${SIDEBAR_BORDER}` }}>
        <p className="text-[10px] font-medium" style={{ color: TEXT_MUTED }}>© 2026 RPJ Corp.</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex flex-col w-56 h-screen shrink-0" style={{ background: SIDEBAR_BG }}>
        <NavContent />
      </aside>

      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg shadow-lg"
        style={{ background: '#1e3a8a', color: '#fff' }}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <aside className="flex flex-col w-56 h-full shadow-2xl" style={{ background: SIDEBAR_BG }}>
            <NavContent />
          </aside>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
