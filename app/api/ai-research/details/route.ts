import { NextRequest, NextResponse } from 'next/server';
import { generateProductDetails, AIResearchError } from '@/lib/ai-research';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { product, criteria } = await req.json();
    if (!product?.product_name || !criteria) {
      return NextResponse.json({ error: 'Missing product or criteria.' }, { status: 400 });
    }

    const details = await generateProductDetails(product, criteria);
    return NextResponse.json({ details });
  } catch (e) {
    if (e instanceof AIResearchError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
