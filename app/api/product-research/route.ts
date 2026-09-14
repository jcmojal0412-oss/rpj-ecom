import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM product_research ORDER BY sort_order ASC, id ASC').all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const {
      product_name, image_ready, google_link, drive_link, cogs, srp,
      fb_page_name, fb_page_admin, status, supplier_details, objectives,
      webcake_warehouse, add_to_warehouse, gsheet_monitoring, promo,
      shipping_fee, ads_cost, rts_percent, done_botcake, done_webcake,
      bundle_price
    } = await req.json();

    const statusVal = status ?? 'For Research';
    // New cards join the bottom of their column, matching where the
    // "Add card" control that creates them actually sits.
    const nextOrder = (db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM product_research WHERE status = ?'
    ).get(statusVal) as { n: number }).n;

    const info = db.prepare(`
      INSERT INTO product_research
        (product_name, image_ready, google_link, drive_link, cogs, srp,
         fb_page_name, fb_page_admin, status, supplier_details, objectives,
         webcake_warehouse, add_to_warehouse, gsheet_monitoring, promo,
         shipping_fee, ads_cost, rts_percent, done_botcake, done_webcake,
         bundle_price, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      product_name, image_ready ? 1 : 0,
      google_link ?? null, drive_link ?? null,
      cogs ?? null, srp ?? null,
      fb_page_name ?? null, fb_page_admin ?? null,
      statusVal,
      supplier_details ?? null, objectives ?? null,
      webcake_warehouse ? 1 : 0, add_to_warehouse ? 1 : 0, gsheet_monitoring ? 1 : 0,
      promo ?? null,
      shipping_fee ?? 0, ads_cost ?? 0, rts_percent ?? 0,
      done_botcake ? 1 : 0, done_webcake ? 1 : 0,
      bundle_price ?? null, nextOrder
    );

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
