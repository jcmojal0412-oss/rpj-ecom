import { NextRequest, NextResponse } from 'next/server';
import { generateProductDetails, AIResearchError } from '@/lib/ai-research';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { product, criteria } = await req.json();
    if (!product?.product_name || !criteria) {
      console.log('[ai-research/details] missing product or criteria');
      return NextResponse.json({ error: 'Missing product or criteria.' }, { status: 400 });
    }

    console.log('[ai-research/details] generating for', product.product_name);
    const details = await generateProductDetails(product, criteria);
    console.log(`[ai-research/details] success in ${Date.now() - startedAt}ms`);
    return NextResponse.json({ details });
  } catch (e) {
    console.error(`[ai-research/details] failed after ${Date.now() - startedAt}ms:`, e);
    if (e instanceof AIResearchError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
