import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM product_research WHERE id=?').get(params.id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const {
      product_name, image_ready, google_link, drive_link, cogs, srp,
      fb_page_name, fb_page_admin, status, supplier_details, objectives,
      webcake_warehouse, add_to_warehouse, gsheet_monitoring
    } = await req.json();

    db.prepare(`
      UPDATE product_research SET
        product_name=?, image_ready=?, google_link=?, drive_link=?, cogs=?, srp=?,
        fb_page_name=?, fb_page_admin=?, status=?, supplier_details=?, objectives=?,
        webcake_warehouse=?, add_to_warehouse=?, gsheet_monitoring=?
      WHERE id=?
    `).run(
      product_name, image_ready ? 1 : 0,
      google_link ?? null, drive_link ?? null,
      cogs ?? null, srp ?? null,
      fb_page_name ?? null, fb_page_admin ?? null,
      status,
      supplier_details ?? null, objectives ?? null,
      webcake_warehouse ? 1 : 0, add_to_warehouse ? 1 : 0, gsheet_monitoring ? 1 : 0,
      params.id
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM product_research WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
