import { NextRequest, NextResponse } from 'next/server';
import { AIResearchError } from '@/lib/ai-research';

export const dynamic = 'force-dynamic';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

async function findProductImage(productName: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AIResearchError('ANTHROPIC_API_KEY is not configured.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-fetch-2025-09-10',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system: `You are a product image finder. Given a product name, use web_search to find ONE real product photo URL (ending in .jpg, .jpeg, .png, or .webp) from Shopee PH, Lazada PH, AliExpress, or Amazon. Search for it now and return ONLY a JSON object with one key: { "url": "<image_url_or_null>" }. No prose, no markdown.`,
        messages: [{ role: 'user', content: `Find a product image for: ${productName}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AIResearchError(`Anthropic API error (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const textBlocks = (data?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text as string);
  const text = textBlocks.join('\n');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed.url === 'string' ? parsed.url : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { product_name } = await req.json();
    if (!product_name) return NextResponse.json({ url: null });

    console.log('[ai-research/image] searching for:', product_name);
    const url = await findProductImage(product_name);
    console.log(`[ai-research/image] found in ${Date.now() - startedAt}ms:`, url);
    return NextResponse.json({ url });
  } catch (e) {
    console.error(`[ai-research/image] failed after ${Date.now() - startedAt}ms:`, e);
    return NextResponse.json({ url: null });
  }
}
