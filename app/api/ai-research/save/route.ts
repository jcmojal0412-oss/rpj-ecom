import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function slugify(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 20);
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { product, category, season } = await req.json();

    if (!product?.product_name) {
      return NextResponse.json({ error: 'Missing product data.' }, { status: 400 });
    }

    const sku = `AI-${slugify(product.product_name)}-${Date.now().toString(36).toUpperCase()}`;

    const info = db.prepare(`
      INSERT INTO products
        (sku, name, category, cogs, srp, ai_score, season, research_notes, decision, perceived_value_score, ai_research_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      sku,
      product.product_name,
      category ?? null,
      product.estimated_cogs ?? null,
      product.suggested_srp ?? null,
      product.overall_score ?? null,
      season ?? null,
      `${product.problem_solved ?? ''}\n\nWhy it sells now: ${product.why_it_sells_now ?? ''}`,
      product.decision ?? null,
      product.perceived_value_score ?? null,
      JSON.stringify(product)
    );

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
