import { NextRequest } from 'next/server';

export function buildFreebieWhere(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const businessId = searchParams.get('business_id');
  const cashierId = searchParams.get('cashier_id');

  const clauses: string[] = [`i.is_freebie = 1`, `s.status != 'Voided'`];
  const params: (string | number)[] = [];
  if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
  if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
  if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
  if (cashierId) { clauses.push('s.cashier_id = ?'); params.push(Number(cashierId)); }

  return { where: clauses.join(' AND '), params };
}
