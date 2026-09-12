import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateAdCopy, parseAdCopyInputBody, AdCopyGeneratorError } from '@/lib/ad-copy-generator';

export const dynamic = 'force-dynamic';
// generateAdCopy() issues two Claude calls in parallel (ad content +
// BotCake content). text_ad_content now uses a 100s internal timeout (its
// system prompt grew large enough to genuinely need it, same as video's
// text_ad_content-equivalent) — 115s leaves margin for both to resolve
// plus JSON parsing/response serialization.
export const maxDuration = 115;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.product_image_base64 || typeof body.product_image_base64 !== 'string') {
      return NextResponse.json({ error: 'Product image is required.' }, { status: 400 });
    }
    if (!body.product_name?.trim()) {
      return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
    }
    if (!body.shop_name?.trim()) {
      return NextResponse.json({ error: 'Shop name is required.' }, { status: 400 });
    }
    if (!body.price?.trim()) {
      return NextResponse.json({ error: 'Price is required.' }, { status: 400 });
    }
    if (!body.promo_offer?.trim()) {
      return NextResponse.json({ error: 'Promo/Offer is required.' }, { status: 400 });
    }

    const input = parseAdCopyInputBody(body);
    const result = await generateAdCopy(input);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ad-copy-generator] generation error:', e?.message);
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Ad copy generation failed. Please try again.' }, { status: 500 });
  }
}
