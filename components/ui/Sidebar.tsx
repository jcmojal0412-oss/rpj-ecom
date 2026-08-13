'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import {
  LayoutDashboard, Package, ShoppingCart,
  FlaskConical, BarChart3, Menu, X, Tag,
  LogOut, Users, Wallet, Calculator, Handshake, TrendingUp, PhoneCall,
  Sparkles, Wrench, CalendarClock, Landmark,
  ClipboardCheck, Contact, Banknote, Receipt, Settings, LayoutGrid, Compass, ChevronDown,
  MoreVertical,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { AVATAR_HEX } from '@/lib/auth-helpers';
import type { SessionUser } from '@/lib/auth-helpers';

// Self-hosted via next/font (no external request, no CSP/privacy concern) —
// scoped to just this component via inter.className below, not applied
// app-wide, per "redesign ONLY the sidebar UI."
const inter = Inter({ subsets: ['latin'], weight: ['500', '600', '700'], display: 'swap' });

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
      { label: 'Command Center', href: '/command-center', icon: Compass, module: '_owner' },
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
// groups in use. Muted, uppercase, small — quiet structure that stays out
// of the way of the links themselves, per the enterprise-sidebar spec.
function GroupHeader({ label, icon: Icon, collapsed, onToggle }: { label: string; icon: React.ElementType; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="group w-full flex items-center gap-2 px-3.5 h-7 rounded-md hover:bg-gray-50 transition-colors"
    >
      <Icon size={14} className="text-[#7B8797] group-hover:text-[#4B5768] shrink-0" />
      <span className="flex-1 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-[#7B8797] group-hover:text-[#4B5768]">
        {label}
      </span>
      <ChevronDown size={14} className={`text-[#9AA5B1] group-hover:text-[#4B5768] transition-transform duration-200 shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
    </button>
  );
}

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

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

  // Close the account menu on an outside click — it's an absolutely
  // positioned popover, not a native <select>, so there's no built-in
  // dismiss behavior.
  useEffect(() => {
    if (!profileMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [profileMenuOpen]);

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

  const itemClasses = (active: boolean) => `group flex items-center gap-3 h-[34px] px-3.5 rounded-md text-sm transition-colors duration-150 border-l-[3px] ${
    active
      ? 'font-semibold text-[#233653] bg-[#FBF8F1] border-l-[#B68B3C]'
      : 'font-medium text-[#5B6472] border-l-transparent hover:bg-gray-50 hover:text-[#233653]'
  }`;
  const iconClasses = (active: boolean) => active ? 'text-[#B68B3C] shrink-0' : 'text-[#9AA5B1] group-hover:text-[#4B5768] shrink-0';

  const NavContent = () => (
    <div className={`${inter.className} flex flex-col h-full bg-white border-r border-[#E8EBEF]`}>

      {/* Logo */}
      <div className="px-5 py-3 flex flex-col items-center justify-center border-b border-[#E8EBEF] shrink-0">
        <Image src="/logo.png" alt="RPJ Corp" width={88} height={44} className="object-contain" priority />
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7B8797]">E-Commerce System</p>
      </div>

      {/* Nav groups — independently scrollable; owner profile + footer below
          stay fixed since they're siblings outside this flex-1 scroll area. */}
      <nav className="sidebar-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(item => hasAccess(item.module));
          if (visibleItems.length === 0) return null;
          const isCollapsed = collapsedGroups.has(group.label);
          return (
            <div key={group.label} className="mb-5">
              <GroupHeader label={group.label} icon={group.groupIcon} collapsed={isCollapsed} onToggle={() => toggleGroup(group.label)} />
              {!isCollapsed && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon   = item.icon;
                    const active = item.href === '/'
                      ? pathname === '/'
                      : item.href !== '#' && pathname.startsWith(item.href);

                    if ((item as any).disabled) {
                      return (
                        <div
                          key={item.label}
                          title="Coming soon"
                          className="flex items-center justify-between gap-3 h-[34px] px-3.5 rounded-md text-sm font-medium text-gray-300 cursor-not-allowed border-l-[3px] border-l-transparent"
                        >
                          <span className="flex items-center gap-3">
                            <Icon size={18} className="text-gray-300" />
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
                        className={itemClasses(active)}
                      >
                        <Icon size={18} className={iconClasses(active)} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Owner only */}
        {user?.role === 'owner' && (
          <div className="mb-5">
            <GroupHeader label="SETTINGS" icon={Settings} collapsed={collapsedGroups.has('SETTINGS')} onToggle={() => toggleGroup('SETTINGS')} />
            {!collapsedGroups.has('SETTINGS') && (
              <div className="mt-0.5">
                <Link
                  href="/settings/users"
                  onClick={() => setMobileOpen(false)}
                  className={itemClasses(pathname.startsWith('/settings'))}
                >
                  <Users size={18} className={iconClasses(pathname.startsWith('/settings'))} />
                  User Management
                </Link>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Owner profile — small avatar + name/role + a three-dot menu that
          reveals Sign out, instead of always showing the logout icon. */}
      {user && (
        <div className="relative px-3 py-2.5 border-t border-[#E8EBEF] shrink-0" ref={profileRef}>
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: AVATAR_HEX[user.avatar_color] ?? '#233653' }}
            >
              {initials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#233653] truncate">{user.name}</p>
              <p className="text-[10.5px] font-medium text-[#7B8797] capitalize">{user.role}</p>
            </div>
            <button
              onClick={() => setProfileMenuOpen(o => !o)}
              className="p-1 rounded hover:bg-gray-200/70 transition-colors shrink-0 text-[#7B8797]"
              title="Account menu"
            >
              <MoreVertical size={16} />
            </button>
          </div>
          {profileMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-[#E8EBEF] rounded-lg shadow-md overflow-hidden">
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-left text-[#B8452E] hover:bg-red-50 transition-colors"
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-2 border-t border-[#E8EBEF] shrink-0">
        <p className="text-[10px] tracking-wide text-[#B0B7C1]">© 2026 RPJ CORPORATION</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex flex-col w-[210px] h-screen shrink-0">
        <NavContent />
      </aside>

      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white border border-[#E8EBEF] text-[#233653] shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <aside className="flex flex-col w-[210px] max-w-[85vw] h-full shadow-lg">
            <NavContent />
          </aside>
          <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
