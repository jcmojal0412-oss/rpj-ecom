// Ordered list of {module, href} — first match against the user's own
// permissions wins. Mirrors the top-to-bottom visual order of
// components/ui/Sidebar.tsx's NAV_GROUPS (MAIN/Dashboard deliberately
// excluded — a staff account should land on the first real module it can
// actually use, not the owner-oriented overview, even if 'dashboard' also
// happens to be checked for them). Used only to pick where a just-logged-in
// user lands; kept as its own small list rather than deriving it from
// Sidebar's NAV_GROUPS since that array carries icons/grouping this doesn't
// need — small, rarely-changed duplication, not worth a bigger refactor.
export const MODULE_LANDING_PRIORITY: { module: string; href: string }[] = [
  { module: 'pos', href: '/pos' },
  { module: 'pos_reports', href: '/pos/reports' },
  { module: 'products', href: '/products' },
  { module: 'ai_fb_ads', href: '/ai-fb-ads' },
  { module: 'inventory', href: '/inventory' },
  { module: 'purchase_orders', href: '/purchase-orders' },
  { module: 'calculator', href: '/calculator' },
  { module: 'product_research', href: '/product-research' },
  { module: 'expenses', href: '/expenses' },
  { module: 'financing', href: '/financing-sales' },
  { module: 'reports', href: '/reports' },
  { module: 'marketing_analytics', href: '/marketing-analytics' },
  { module: 'service_center', href: '/service-center' },
  { module: 'partners', href: '/discovery-calls' },
  { module: 'attendance', href: '/hr-dashboard' },
  { module: 'employees', href: '/employees' },
  { module: 'payroll', href: '/payroll' },
];

// Owner always lands on the Dashboard. A staff account lands on the first
// module it actually has, in the priority order above. / itself now
// requires the 'dashboard' permission (see middleware.ts) — a staff
// account with no module assigned at all falls back to /no-access rather
// than /, since landing there would just bounce them straight into
// middleware's own dashboard-permission redirect.
export function resolveLandingPath(role: string, permissions: string[]): string {
  if (role === 'owner') return '/';
  const match = MODULE_LANDING_PRIORITY.find(m => permissions.includes(m.module));
  return match ? match.href : '/no-access';
}
