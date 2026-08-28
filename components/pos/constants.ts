export interface Business { id: number; name: string; }

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  srp: number | null;
  quantity: number;
}

// Service/fee cart lines (Labor Fee, Reservation Fee) are not inventory —
// no product_id, no stock, quantity is always 1, and the amount is entered
// at time of sale rather than looked up. `key` is the React list key and,
// for services, also distinguishes multiple same-named entries in one cart
// (each can carry a different amount) since there's no product_id to key by.
export interface CartLine {
  kind: 'product' | 'service';
  key: string;
  product_id?: number;
  name: string;
  sku?: string;
  unit_price: number;
  quantity: number;
  stock?: number;
}

export interface ServiceFeeItem { name: string; sku: string; }
export const SERVICE_FEE_ITEMS: ServiceFeeItem[] = [
  { name: 'Labor / Service Fee', sku: 'SVC-LABOR' },
  { name: 'Reservation Fee', sku: 'SVC-RSVP' },
];

export interface SaleItem {
  id: number;
  product_id: number | null;
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
  financing_provider: string | null;
  financing_amount: number;
  financing_reference: string | null;
  financing_status: 'Pending' | 'Settled' | 'Cancelled' | null;
  cashback_amount: number;
  downpayment_applied: number;
}

export interface ProductSalesRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  category: string | null;
  qty_sold: number;
  unit_cost: number;
  total_cost: number;
  unit_price: number;
  total_sales: number;
  total_discount: number;
  profit: number;
}

export interface RefundItem {
  id: number;
  sale_item_id: number;
  product_id: number | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Refund {
  id: number;
  sale_id: number;
  refund_date: string;
  total_refund: number;
  reason: string | null;
  cashier_id: number | null;
  cashier_name: string | null;
  created_at: string;
  items: RefundItem[];
}

export interface Shift {
  id: number;
  business_id: number | null;
  business_name: string | null;
  cashier_id: number | null;
  cashier_name: string | null;
  username: string | null;
  time_in: string;
  time_out: string | null;
  starting_cash: number;
  cash_sales: number | null;
  online_sales: number | null;
  financing_receivable: number | null;
  expected_cash: number | null;
  actual_cash: number | null;
  discrepancy: number | null;
  status: 'Open' | 'Closed';
  notes: string | null;
  created_at: string;
}

export interface FinancingByProvider { provider: string; amount: number; }

export const CASH_PRESETS = [1, 5, 10, 20, 50, 100, 500, 1000];

// A closed shift's |discrepancy| at or above this gets flagged in the
// Cashier's Report — the closest thing to an "owner alert" without building
// a push/SMS/email delivery channel: visible next time the report is opened.
export const LARGE_DISCREPANCY_THRESHOLD = 100;

// Salmon/Skyro/Billease are financing providers (they cover a financed
// balance, not an ordinary payment), so they live in their own list and are
// never offered as a normal Online/Split payment option.
export const FINANCING_PROVIDERS = ['Salmon', 'Skyro', 'Billease'];
