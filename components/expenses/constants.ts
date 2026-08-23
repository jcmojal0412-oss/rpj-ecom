import { Package, Users, Megaphone, Landmark, Building2, Zap, MoreHorizontal } from 'lucide-react';

export const EXPENSE_CATEGORIES = [
  'Products / Inventory', 'Payroll', 'FB Ads Spent', 'Loan', 'Rent', 'Bills', 'Others',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const PAYMENT_METHODS = [
  'Cash', 'GCash', 'Maya', 'Bank Transfer', 'Credit Card', 'Debit Card', 'Check', 'Other',
] as const;

export const EXPENSE_STATUSES = ['Verified', 'For Review'] as const;
export type ExpenseStatus = typeof EXPENSE_STATUSES[number];

export const CATEGORY_ICON: Record<string, React.ElementType> = {
  'Products / Inventory': Package,
  'Payroll': Users,
  'FB Ads Spent': Megaphone,
  'Loan': Landmark,
  'Rent': Building2,
  'Bills': Zap,
  'Others': MoreHorizontal,
};

export const CATEGORY_COLOR: Record<string, { bg: string; text: string }> = {
  'Products / Inventory': { bg: 'bg-blue-50',   text: 'text-blue-500' },
  'Payroll':              { bg: 'bg-green-50',  text: 'text-green-600' },
  'FB Ads Spent':         { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  'Loan':                 { bg: 'bg-amber-50',  text: 'text-amber-600' },
  'Rent':                 { bg: 'bg-orange-50', text: 'text-orange-600' },
  'Bills':                { bg: 'bg-red-50',    text: 'text-red-500' },
  'Others':               { bg: 'bg-gray-100',  text: 'text-gray-500' },
};

// Raw hex for chart fills (recharts Cell needs a real color, not a Tailwind class) —
// kept in sync with CATEGORY_COLOR above.
export const CATEGORY_HEX: Record<string, string> = {
  'Products / Inventory': '#3B82F6',
  'Payroll':              '#16A34A',
  'FB Ads Spent':         '#4F46E5',
  'Loan':                 '#D97706',
  'Rent':                 '#EA580C',
  'Bills':                '#EF4444',
  'Others':               '#6B7280',
};

export interface Business { id: number; name: string; }

export interface Expense {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  category: string;
  reference_no: string | null;
  paid_to: string | null;
  payment_method: string | null;
  business_id: number | null;
  business_name: string | null;
  receipt_path: string | null;
  ai_processed: number;
  ai_confidence: string | null;
  status: ExpenseStatus;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}
