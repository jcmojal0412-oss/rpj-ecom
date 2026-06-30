import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, sku, name, category, cogs, srp, ai_score, season, research_notes, decision, perceived_value_score, ai_research_json, created_at
      FROM products
      WHERE ai_score IS NOT NULL
      ORDER BY created_at DESC
    `).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
