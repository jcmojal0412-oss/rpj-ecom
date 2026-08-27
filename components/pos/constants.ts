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
  total: number;
  cash_amount: number;
  online_amount: number;
  change_due: number;
  status: 'Completed' | 'Voided';
  cashier_id: number | null;
  cashier_name: string | null;
  notes: string | null;
  created_at: string;
}

export const CASH_PRESETS = [20, 50, 100, 200, 500, 1000];
