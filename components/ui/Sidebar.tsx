'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard, Package, ShoppingCart,
  FlaskConical, BarChart3, Menu, X, Tag,
  LogOut, Users, Wallet, Calculator, Handshake, TrendingUp, PhoneCall,
  Sparkles, ShoppingBag, Music2, Vault, LineChart,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { AVATAR_HEX } from '@/lib/auth-helpers';
import type { SessionUser } from '@/lib/auth-helpers';

const NAV_GROUPS = [
  {
    label: 'MAIN',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, module: 'dashboard' },
    ],
  },
  {
    label: 'CATALOG',
    items: [
      { label: 'Products',        href: '/products',         icon: Tag,           module: 'products'         },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { label: 'Inventory',       href: '/inventory',       icon: Package,       module: 'inventory'       },
      { label: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart,  module: 'purchase_orders' },
    ],
  },
  {
    label: 'REPORTS',
    items: [
      { label: 'Reports',           href: '/reports',     icon: BarChart3,  module: 'reports'   },
      { label: 'Monthly Expenses',  href: '/expenses',    icon: Wallet,     module: 'expenses'  },
    ],
  },
  {
    label: 'PARTNERS',
    items: [
      { label: 'Discovery Calls', href: '/discovery-calls', icon: PhoneCall,  module: 'partners' },
      { label: 'SEDO Partners',   href: '/partners',         icon: Handshake,  module: 'partners' },
      { label: 'Gross Sales',     href: '/gross-sales',      icon: TrendingUp, module: 'partners' },
    ],
  },
  // AI PRODUCT RESEARCHER group hidden — re-add when ready
  {
    label: 'TOOLS',
    items: [
      { label: 'Ecom Calculator',  href: '/calculator',       icon: Calculator,   module: 'calculator'       },
      { label: 'Product Research', href: '/product-research', icon: FlaskConical, module: 'product_research' },
    ],
  },
];

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUser(u); });
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const hasAccess = (module: string) =>
    !user || user.role === 'owner' || user.permissions.includes(module);

  const NavContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-100">

      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-center bg-white">
        <Image src="/logo.png" alt="RPJ Corp" width={130} height={65} className="object-contain" priority />
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(item => hasAccess(item.module));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label} className="mb-4">
              <p className="text-[10px] font-bold tracking-widest text-blue-500 px-3 mb-1.5">
                {group.label}
              </p>
              {visibleItems.map((item) => {
                const Icon   = item.icon;
                const active = item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mb-0.5 ${
                      active
                        ? 'bg-orange-500 text-white shadow-sm shadow-orange-200'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon size={17} className={active ? 'text-white' : 'text-gray-400'} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* Owner only */}
        {user?.role === 'owner' && (
          <div className="mb-4">
            <p className="text-[10px] font-bold tracking-widest text-blue-500 px-3 mb-1.5">
              SETTINGS
            </p>
            <Link
              href="/settings/users"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                pathname.startsWith('/settings')
                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Users size={17} className={pathname.startsWith('/settings') ? 'text-white' : 'text-gray-400'} />
              User Management
            </Link>
          </div>
        )}
      </nav>

      {/* User + Logout */}
      {user && (
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: AVATAR_HEX[user.avatar_color] ?? '#3b82f6' }}
            >
              {initials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{user.name}</p>
              <p className="text-[10px] text-gray-400 capitalize">{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="px-5 py-2.5 border-t border-gray-100">
        <p className="text-[10px] text-gray-400">© 2026 RPJ Corp.</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex flex-col w-56 h-screen shrink-0">
        <NavContent />
      </aside>

      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white border border-gray-200 text-gray-700 shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <aside className="flex flex-col w-56 h-full shadow-2xl">
            <NavContent />
          </aside>
          <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
