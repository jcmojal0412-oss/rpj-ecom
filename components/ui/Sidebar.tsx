'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard, Package, ShoppingCart,
  FlaskConical, BarChart3, Menu, X, Tag,
  LogOut, Users, Wallet, Calculator, Handshake, TrendingUp, PhoneCall,
  Sparkles, ShoppingBag, Music2, Vault, LineChart, Wrench, CalendarClock, Landmark,
  ClipboardCheck, Contact, Banknote, Receipt, Settings, LayoutGrid, Compass, ChevronDown,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { AVATAR_HEX } from '@/lib/auth-helpers';
import type { SessionUser } from '@/lib/auth-helpers';

const NAV_GROUPS = [
  {
    label: 'MAIN',
    groupIcon: LayoutDashboard,
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, module: 'dashboard' },
    ],
  },
  // Owner-only — '_owner' sentinel matches middleware.ts's gate on
  // /command-center, checked specially in hasAccess() below (never granted
  // via a staff permission string, unlike the other module keys).
  {
    label: 'EXECUTIVE',
    groupIcon: Compass,
    items: [
      { label: 'Command Center', href: '/command-center', icon: Compass, module: '_owner', gold: true },
    ],
  },
  {
    label: 'CATALOG',
    groupIcon: Tag,
    items: [
      { label: 'Products',        href: '/products',         icon: Tag,           module: 'products'         },
      { label: 'AI FB Ads',       href: '/ai-fb-ads',        icon: Sparkles,      module: 'ai_fb_ads'        },
    ],
  },
  {
    label: 'INVENTORY',
    groupIcon: Package,
    items: [
      { label: 'Inventory',       href: '/inventory',       icon: Package,       module: 'inventory'       },
      { label: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart,  module: 'purchase_orders' },
    ],
  },
  {
    label: 'REPORTS',
    groupIcon: BarChart3,
    items: [
      { label: 'Reports',           href: '/reports',     icon: BarChart3,  module: 'reports'   },
      { label: 'Monthly Expenses',  href: '/expenses',    icon: Wallet,     module: 'expenses'  },
    ],
  },
  {
    label: 'SERVICE CENTER',
    groupIcon: Wrench,
    items: [
      { label: 'Repair Monitoring', href: '/service-center', icon: Wrench, module: 'service_center' },
    ],
  },
  {
    label: 'PARTNERS',
    groupIcon: Handshake,
    items: [
      { label: 'Discovery Calls', href: '/discovery-calls', icon: PhoneCall,  module: 'partners' },
      { label: 'SEDO Bookings',   href: '/sedo-bookings',   icon: CalendarClock, module: 'partners' },
      { label: 'SEDO Partners',   href: '/partners',         icon: Handshake,  module: 'partners' },
      { label: 'Gross Sales',     href: '/gross-sales',      icon: TrendingUp, module: 'partners' },
    ],
  },
  {
    label: 'FINANCING',
    groupIcon: Landmark,
    items: [
      { label: 'Financing Sales', href: '/financing-sales', icon: Landmark, module: 'financing' },
    ],
  },
  // Simple HR Mode: main navigation only shows the 5 everyday screens
  // (HR Dashboard, Employees, Attendance, Payroll, Payslips) plus My
  // Attendance (every employee's own self-service clock, not an HR/admin
  // concern) and HR Settings (one consolidated home for shift templates,
  // attendance rules, holidays, leave types, and test mode — see
  // components/hr/HrSettingsClient.tsx). Nothing was removed, only moved —
  // Leave Management's tabs are all still reachable from HR Settings.
  {
    label: 'HR & PAYROLL',
    groupIcon: Contact,
    items: [
      { label: 'HR Dashboard',     href: '/hr-dashboard',  icon: LayoutGrid,     module: 'attendance' },
      { label: 'Employees',        href: '/employees',     icon: Contact,        module: 'employees' },
      { label: 'Attendance',       href: '/attendance',    icon: ClipboardCheck, module: 'attendance' },
      { label: 'Payroll',          href: '/payroll',       icon: Banknote,       module: 'payroll' },
      { label: 'Payslips',         href: '/payslips',      icon: Receipt,        module: '_any' },
      { label: 'HR Settings',      href: '/hr-settings',   icon: Settings,       module: 'attendance' },
    ],
  },
  // AI PRODUCT RESEARCHER group hidden — re-add when ready
  {
    label: 'TOOLS',
    groupIcon: Calculator,
    items: [
      { label: 'Ecom Calculator',  href: '/calculator',       icon: Calculator,   module: 'calculator'       },
      { label: 'Product Research', href: '/product-research', icon: FlaskConical, module: 'product_research' },
    ],
  },
];

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const COLLAPSE_STORAGE_KEY = 'rpj-sidebar-collapsed-groups';

// Clickable group header with an icon + chevron on the right — click
// anywhere on the row to collapse/expand that group's links, so a long
// sidebar (Inventory, Catalog, Reports, etc.) can be shortened to just the
// groups in use. Neutral slate tone (not the orange brand accent, which is
// reserved for the active-page state) keeps headers as quiet structure
// rather than competing for attention with the links themselves.
function GroupHeader({ label, icon: Icon, collapsed, onToggle }: { label: string; icon: React.ElementType; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="group w-full flex items-center gap-2 px-3 py-1.5 mb-0.5 rounded-md hover:bg-slate-50 transition-colors"
    >
      <Icon size={13} className="text-slate-400 group-hover:text-slate-500 shrink-0" />
      <span className="flex-1 text-left text-[10.5px] font-semibold tracking-[0.09em] text-slate-400 group-hover:text-slate-600">
        {label}
      </span>
      <ChevronDown size={13} className={`text-slate-300 group-hover:text-slate-500 transition-transform duration-200 shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
    </button>
  );
}

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUser(u); });
  }, []);

  // Read saved collapse state after hydration (not during initial render,
  // to keep the server-rendered and first client-rendered markup identical).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (saved) setCollapsedGroups(new Set(JSON.parse(saved)));
    } catch { /* ignore malformed/unavailable storage */ }
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const hasAccess = (module: string) => {
    if (module === '_owner') return user?.role === 'owner'; // never granted via a staff permission string
    return module === '_any' || !user || user.role === 'owner' || user.permissions.includes(module);
  };

  const NavContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-100">

      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-center bg-white">
        <Image src="/logo.png" alt="RPJ Corp" width={124} height={62} className="object-contain" priority />
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-3.5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(item => hasAccess(item.module));
          if (visibleItems.length === 0) return null;
          const isCollapsed = collapsedGroups.has(group.label);
          return (
            <div key={group.label} className="mb-3.5">
              <GroupHeader label={group.label} icon={group.groupIcon} collapsed={isCollapsed} onToggle={() => toggleGroup(group.label)} />
              {!isCollapsed && visibleItems.map((item) => {
                const Icon   = item.icon;
                const isGold = (item as any).gold === true;
                const active = item.href === '/'
                  ? pathname === '/'
                  : item.href !== '#' && pathname.startsWith(item.href);

                if ((item as any).disabled) {
                  return (
                    <div
                      key={item.label}
                      title="Coming soon"
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-0.5 text-gray-300 cursor-not-allowed"
                    >
                      <span className="flex items-center gap-3">
                        <Icon size={17} className="text-gray-300" />
                        {item.label}
                      </span>
                      <span className="text-[9px] font-bold tracking-wide bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">SOON</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-0.5 transition-all duration-150 ${
                      active
                        ? isGold
                          ? 'bg-gradient-to-r from-[#8A6A1E] to-[#AD8526] text-white shadow-sm shadow-amber-200/70'
                          : 'bg-orange-500 text-white shadow-sm shadow-orange-200/70'
                        : isGold
                          ? 'text-[#8A6A1E] bg-[#F4E9CC]/40 hover:bg-[#F4E9CC]/70'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon size={17} className={active ? 'text-white' : isGold ? 'text-[#AD8526]' : 'text-gray-400'} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* Owner only */}
        {user?.role === 'owner' && (
          <div className="mb-3.5">
            <GroupHeader label="SETTINGS" icon={Settings} collapsed={collapsedGroups.has('SETTINGS')} onToggle={() => toggleGroup('SETTINGS')} />
            {!collapsedGroups.has('SETTINGS') && (
              <Link
                href="/settings/users"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  pathname.startsWith('/settings')
                    ? 'bg-orange-500 text-white shadow-sm shadow-orange-200/70'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Users size={17} className={pathname.startsWith('/settings') ? 'text-white' : 'text-gray-400'} />
                User Management
              </Link>
            )}
          </div>
        )}
      </nav>

      {/* User + Logout */}
      {user && (
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition-colors">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white shadow-sm"
              style={{ backgroundColor: AVATAR_HEX[user.avatar_color] ?? '#3b82f6' }}
            >
              {initials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{user.name}</p>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{user.role}</p>
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
        <p className="text-[10px] text-slate-300 tracking-wide">© 2026 RPJ CORPORATION</p>
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
