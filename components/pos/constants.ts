export interface Business { id: number; name: string; }

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  srp: number | null;
  quantity: number;
}

export interface CartLine {
  product_id: number;
  name: string;
  sku: string;
  unit_price: number;
  quantity: number;
  stock: number;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface Sale {
  id: number;
  business_id: number | null;
  business_name: string | null;
  sale_date: string;
  subtotal: number;
  discount: number;
  additional_fee: number;
  tax_percent: number;
  tax_amount: number;
  service_charge: number;
  delivery_fee: number;
  total: number;
  cash_amount: number;
  online_amount: number;
  change_due: number;
  payment_method: string | null;
  reference_no: string | null;
  status: 'Completed' | 'Voided';
  cashier_id: number | null;
  cashier_name: string | null;
  notes: string | null;
  created_at: string;
}

export const CASH_PRESETS = [1, 5, 10, 20, 50, 100, 500, 1000];

// Grouped to match the reference POS's exact card layout: a 4-across row,
// a standalone full-width row, then a 5-across row. These are display
// labels only — no real payment-gateway integration behind any of them.
export const PAYMENT_METHOD_GROUPS: string[][] = [
  ['Cash', 'GCash', 'Salmon', 'Cash + GCash'],
  ['Credit Card'],
  ['Maya', 'Sodexo', 'Bank Transfer', 'Skyro', 'Billease'],
];
