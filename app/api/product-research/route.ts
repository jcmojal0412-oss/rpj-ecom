import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM product_research ORDER BY created_at DESC').all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { product_name, image_ready, google_link, cogs, srp, fb_page_name, fb_page_admin, status } =
      await req.json();

    const info = db.prepare(`
      INSERT INTO product_research
        (product_name, image_ready, google_link, cogs, srp, fb_page_name, fb_page_admin, status)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      product_name, image_ready ? 1 : 0, google_link ?? null,
      cogs ?? null, srp ?? null, fb_page_name ?? null,
      fb_page_admin ?? null, status ?? 'For Research'
    );

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
