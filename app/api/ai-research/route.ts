import { NextRequest, NextResponse } from 'next/server';
import { generateProductRecommendations, AIResearchError } from '@/lib/ai-research';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  console.log('[ai-research] request received, ANTHROPIC_API_KEY set?', !!process.env.ANTHROPIC_API_KEY);
  try {
    const body = await req.json();
    const { season, cogs, srp, category, market, margin, notes } = body;

    if (!season || !cogs || !srp || !category) {
      console.log('[ai-research] missing required fields', { season, cogs, srp, category });
      return NextResponse.json({ error: 'Season, COGS, SRP, and Category are required.' }, { status: 400 });
    }

    console.log('[ai-research] calling Anthropic...', { season, cogs, srp, category, market, margin });
    const recommendations = await generateProductRecommendations({
      season,
      cogs: Number(cogs),
      srp: Number(srp),
      category,
      market: market || 'Philippines COD',
      margin: Number(margin) || 0,
      notes,
    });

    console.log(`[ai-research] success in ${Date.now() - startedAt}ms, ${recommendations.length} products`);
    return NextResponse.json({ recommendations });
  } catch (e) {
    console.error(`[ai-research] failed after ${Date.now() - startedAt}ms:`, e);
    if (e instanceof AIResearchError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
