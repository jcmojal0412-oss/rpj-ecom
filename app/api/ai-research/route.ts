import { NextRequest, NextResponse } from 'next/server';
import { generateProductRecommendations, AIResearchError } from '@/lib/ai-research';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { season, cogs, srp, category, market, margin, notes } = body;

    if (!season || !cogs || !srp || !category) {
      return NextResponse.json({ error: 'Season, COGS, SRP, and Category are required.' }, { status: 400 });
    }

    const recommendations = await generateProductRecommendations({
      season,
      cogs: Number(cogs),
      srp: Number(srp),
      category,
      market: market || 'Philippines COD',
      margin: Number(margin) || 0,
      notes,
    });

    return NextResponse.json({ recommendations });
  } catch (e) {
    if (e instanceof AIResearchError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
