'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import {
  LayoutDashboard, Package, ShoppingCart,
  FlaskConical, BarChart3, Menu, X, Tag,
  LogOut, Users, Wallet, Calculator, Handshake, TrendingUp, PhoneCall,
  Sparkles, Wrench, CalendarClock, Landmark, Megaphone,
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

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  module: string;
  // Opts a route out of prefix-matching — see isHrefActive() below.
  exact?: boolean;
}
interface NavGroup {
  label: string;
  groupIcon: React.ElementType;
  pinned?: boolean;
  items: NavItem[];
}

// `pinned` groups (MAIN, EXECUTIVE) are always visible, single-item primary
// destinations — no accordion toggle, icon kept on the item itself. Every
// other group is an accordion section: collapsed by default, one open at a
// time, auto-following whichever section holds the active route. SETTINGS
// lives here too (not as a separately-rendered block) so it participates in
// the same accordion state — gated by the '_owner' module sentinel below,
// same pattern as Command Center.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'MAIN',
    groupIcon: LayoutDashboard,
    pinned: true,
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, module: 'dashboard' },
    ],
  },
  {
    label: 'EXECUTIVE',
    groupIcon: Compass,
    pinned: true,
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
    label: 'MARKETING ANALYTICS',
    groupIcon: Megaphone,
    items: [
      { label: 'Performance Dashboard', href: '/marketing-analytics',         icon: Megaphone, module: 'marketing_analytics', exact: true },
      { label: 'Daily Records',         href: '/marketing-analytics/records', icon: Megaphone, module: 'marketing_analytics' },
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
  {
    label: 'SETTINGS',
    groupIcon: Settings,
    items: [
      { label: 'User Management', href: '/settings/users', icon: Users, module: '_owner' },
    ],
  },
];

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// Falls back to "Owner Account" only when the stored name is literally a
// duplicate of the role (e.g. an account whose name field was never set
// past its "Owner" default) — never a hardcoded name, just avoids the
// "Owner / Owner" double-up when the real name genuinely isn't set yet.
function profileDisplayName(user: SessionUser) {
  return user.name.trim().toLowerCase() === user.role.trim().toLowerCase() ? 'Owner Account' : user.name;
}

// `exact` opts a route out of prefix-matching — needed whenever a group has
// a sibling item whose href is itself a prefix of another item's href (e.g.
// '/marketing-analytics' vs '/marketing-analytics/records'), so only the
// page actually being viewed lights up, not both.
function isHrefActive(pathname: string, href: string, exact?: boolean) {
  if (href === '/') return pathname === '/';
  if (href === '#') return false;
  return exact ? pathname === href : pathname.startsWith(href);
}

// Static section label for pinned groups (MAIN, EXECUTIVE) — same quiet
// muted/uppercase treatment as the accordion header below, minus the
// button/chevron, since these never collapse.
function SectionLabel({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 px-3.5 h-8">
      <Icon size={14} className="text-[#B8C4D9] shrink-0" />
      <span className="flex-1 text-left text-[11px] font-bold uppercase tracking-[0.07em] text-[#B8C4D9] truncate" title={label}>
        {label}
      </span>
    </div>
  );
}

// Clickable accordion header — click anywhere on the row to open that
// section, which auto-closes whichever other section was open (single-open
// accordion, see openGroup state in Sidebar()). Bright + bold — reads as a
// real heading, clearly stronger than the (lighter) child links under it.
function GroupHeader({ label, icon: Icon, open, onToggle }: { label: string; icon: React.ElementType; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="group w-full flex items-center gap-2 px-3.5 h-8 rounded-md hover:bg-[#1F2234] transition-colors"
      aria-expanded={open}
    >
      <Icon size={14} className="text-[#B8C4D9] group-hover:text-[#F7F8FC] shrink-0" />
      <span className="flex-1 text-left text-[11px] font-bold uppercase tracking-[0.07em] text-[#B8C4D9] group-hover:text-[#F7F8FC] truncate" title={label}>
        {label}
      </span>
      <ChevronDown size={14} className={`text-[#B8C4D9] group-hover:text-[#F7F8FC] transition-transform duration-200 shrink-0 ${open ? '' : '-rotate-90'}`} />
    </button>
  );
}

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  // Single-open accordion — at most one non-pinned group's label is here at
  // a time. Re-derived from the active route below, so the section holding
  // the current page auto-expands on load and on every navigation; a plain
  // header click can still open a different group to browse without
  // navigating first.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUser(u); });
  }, []);

  useEffect(() => {
    const activeGroup = NAV_GROUPS.find(g => !g.pinned && g.items.some(item => isHrefActive(pathname, item.href)));
    setOpenGroup(activeGroup ? activeGroup.label : null);
  }, [pathname]);

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
    setOpenGroup(prev => prev === label ? null : label);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const hasAccess = (module: string) => {
    if (module === '_owner') return user?.role === 'owner'; // never granted via a staff permission string
    return module === '_any' || !user || user.role === 'owner' || user.permissions.includes(module);
  };

  // Pinned/top-level items (Dashboard, Command Center) keep their icon —
  // they read as primary nav, not as a collapsible section's children.
  const pinnedItemClasses = (active: boolean) => `group flex items-center gap-3 h-10 px-3 rounded-md text-sm transition-colors duration-150 border-l-[3px] ${
    active
      ? 'font-semibold text-[#FFFFFF] bg-[#202334] border-l-[#B68B3C]'
      : 'font-normal text-[#95AACF] border-l-transparent hover:bg-[#1F2234] hover:text-[#F7F8FC]'
  }`;
  const pinnedIconClasses = (active: boolean) => active ? 'text-[#B68B3C] shrink-0' : 'text-[#95AACF]/70 group-hover:text-[#F7F8FC] shrink-0';

  // Accordion children — no icon (avoids duplicating the section's own
  // icon), indented further than pinned items so parent vs. child is
  // unambiguous at a glance. Deliberately lighter-weight/dimmer than the
  // bold, bright section header above them — the header should read as the
  // stronger element, children as its quieter sub-items.
  const childItemClasses = (active: boolean) => `flex items-center h-10 pl-10 pr-3 rounded-md text-sm truncate transition-colors duration-150 border-l-[3px] ${
    active
      ? 'font-semibold text-[#FFFFFF] bg-[#202334] border-l-[#B68B3C]'
      : 'font-normal text-[#95AACF] border-l-transparent hover:bg-[#1F2234] hover:text-[#F7F8FC]'
  }`;

  // A plain JSX value, NOT a component function — defining this as
  // `const NavContent = () => (...)` (a new function on every render) made
  // React treat <NavContent /> as a brand-new component type on every
  // re-render (any accordion click, any navigation), so it unmounted and
  // remounted the whole <nav> subtree each time — silently resetting its
  // scroll position to 0. Reusing the same JSX value in both the desktop
  // and mobile drawer slots below avoids that: React reconciles the
  // existing DOM nodes instead of tearing them down.
  const navContent = (
    <div className={`${inter.className} flex flex-col h-full bg-[#171928] border-r border-white/[0.06]`}>

      {/* Logo — fixed, never part of the scroll area. The source file has a
          solid white background (no transparency), so it sits on a small
          white card rather than directly on the dark sidebar. */}
      <div className="px-5 py-3 flex flex-col items-center justify-center border-b border-white/[0.06] shrink-0">
        <div className="bg-white rounded px-2.5 py-1">
          <Image src="/logo.png" alt="RPJ Corp" width={72} height={36} className="object-contain" priority />
        </div>
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7F91AE]">E-Commerce System</p>
      </div>

      {/* Nav groups — independently scrollable; owner profile + footer below
          stay fixed since they're siblings outside this flex-1 scroll area.
          min-h-0 is required so this flex child can actually shrink and
          scroll instead of pushing the owner profile off-screen. */}
      <nav className="sidebar-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(item => hasAccess(item.module));
          if (visibleItems.length === 0) return null;

          if (group.pinned) {
            return (
              <div key={group.label} className="mb-4">
                <SectionLabel label={group.label} icon={group.groupIcon} />
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = isHrefActive(pathname, item.href, item.exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={pinnedItemClasses(active)}
                        title={item.label}
                      >
                        <Icon size={18} className={pinnedIconClasses(active)} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          const isOpen = openGroup === group.label;
          return (
            <div key={group.label} className="mb-4">
              <GroupHeader label={group.label} icon={group.groupIcon} open={isOpen} onToggle={() => toggleGroup(group.label)} />
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = isHrefActive(pathname, item.href, item.exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={childItemClasses(active)}
                        title={item.label}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Owner profile — small avatar + name/role + a three-dot menu that
          reveals Sign out, instead of always showing the logout icon. */}
      {user && (
        <div className="relative px-3 py-2.5 border-t border-white/[0.06] shrink-0" ref={profileRef}>
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[#1F2234] transition-colors">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: AVATAR_HEX[user.avatar_color] ?? '#233653' }}
            >
              {initials(profileDisplayName(user))}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#F7F8FC] truncate">{profileDisplayName(user)}</p>
              <p className="text-[10.5px] font-medium text-[#7F91AE] capitalize">{user.role}</p>
            </div>
            <button
              onClick={() => setProfileMenuOpen(o => !o)}
              className="p-1 rounded hover:bg-white/10 transition-colors shrink-0 text-[#7F91AE]"
              title="Account menu"
            >
              <MoreVertical size={16} />
            </button>
          </div>
          {profileMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-[#1F2234] border border-white/[0.06] rounded-lg shadow-md overflow-hidden">
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-left text-[#FF6B5B] hover:bg-white/5 transition-colors"
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-2 border-t border-white/[0.06] shrink-0">
        <p className="text-[10px] tracking-wide text-[#4B5468]">© 2026 RPJ CORPORATION</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex flex-col w-[270px] h-screen shrink-0">
        {navContent}
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
          <aside className="flex flex-col w-[270px] max-w-[85vw] h-full shadow-lg">
            {navContent}
          </aside>
          <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
