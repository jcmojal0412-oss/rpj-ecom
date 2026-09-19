import type { getDb } from '@/lib/db';

type Db = ReturnType<typeof getDb>;

export interface CountLogInput {
  productId: number;
  expected: number;
  counted: number;
  unitCost: number;
  reason?: string | null;
  note?: string | null;
  source: 'single' | 'bulk';
  countedBy: number | null;
}

// Shared by the single-item count and the bulk count sheet so both feed the
// same variance log / accuracy figures.
export function logInventoryCount(db: Db, c: CountLogInput) {
  db.prepare(`
    INSERT INTO inventory_counts (product_id, expected_qty, counted_qty, variance, unit_cost, reason, note, source, counted_by)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(c.productId, c.expected, c.counted, c.counted - c.expected, c.unitCost, c.reason ?? null, c.note ?? null, c.source, c.countedBy);
}
