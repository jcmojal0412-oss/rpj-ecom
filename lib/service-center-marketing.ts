// Shared between the marketing-expenses API routes and the CEO Overview
// client component — no server-only imports here, so it's safe to pull
// into the browser bundle.
export const MARKETING_CATEGORIES = [
  'Facebook Ads', 'Boosted Post', 'Influencer / Content', 'Flyers / Printing', 'Ground Marketing', 'Other',
] as const;
export type MarketingCategory = typeof MARKETING_CATEGORIES[number];

export interface MarketingExpense {
  id: number;
  expense_date: string;
  category: string;
  amount: number;
  description: string | null;
  reference: string | null;
  created_at: string;
}
