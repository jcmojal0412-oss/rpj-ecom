import type { RepairStatus, CustomerPaymentStatus, TechPayoutStatus } from '@/lib/service-center';

export interface Repair {
  id: number;
  repair_date: string;
  repair_details: string | null;
  unit_model: string | null;
  customer_name: string | null;
  contact_number: string | null;
  technician_name: string | null;
  order_no: string | null;
  receipt_no: string | null;
  notes: string | null;
  repair_amount: number;
  cogs: number;
  labor_amount: number;
  bns_share: number;
  tech_earnings: number;
  repair_status: RepairStatus;
  collected: number;
  balance: number;
  customer_payment_status: CustomerPaymentStatus;
  last_payment_date: string | null;
  paid_out: number;
  tech_payable: number;
  tech_payout_status: TechPayoutStatus;
  created_at: string;
}

export interface Payment {
  id: number; amount: number; payment_date: string; payment_method: string | null; reference_notes: string | null; created_at: string;
}
export interface Payout {
  id: number; amount: number; payment_date: string; payment_method: string | null; reference_notes: string | null;
  processed_by: number | null; processed_by_name: string | null; created_at: string;
}

export const REPAIR_STATUS_COLOR: Record<RepairStatus, string> = {
  'Received': 'bg-gray-100 text-gray-700',
  'Diagnosing': 'bg-blue-100 text-blue-700',
  'Waiting for Parts': 'bg-orange-100 text-orange-700',
  'Repairing': 'bg-amber-100 text-amber-700',
  'Ready for Pickup': 'bg-blue-100 text-blue-700',
  'Completed': 'bg-green-100 text-green-700',
  'Cancelled': 'bg-red-100 text-red-700',
};

export const CUSTOMER_STATUS_COLOR: Record<CustomerPaymentStatus, string> = {
  'Unpaid': 'bg-red-100 text-red-700',
  'Partial': 'bg-amber-100 text-amber-700',
  'Paid': 'bg-green-100 text-green-700',
};

export const PAYOUT_STATUS_COLOR: Record<TechPayoutStatus, string> = {
  'Not Due': 'bg-gray-100 text-gray-500',
  'Due': 'bg-amber-100 text-amber-700',
  'Paid': 'bg-green-100 text-green-700',
};

export const ONGOING_REPAIR_STATUSES: RepairStatus[] = [
  'Received', 'Diagnosing', 'Waiting for Parts', 'Repairing', 'Ready for Pickup',
];
