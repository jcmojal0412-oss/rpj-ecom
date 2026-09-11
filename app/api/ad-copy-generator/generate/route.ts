import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateAdCopy, AdCopyGeneratorError, type AdCopyInput } from '@/lib/ad-copy-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      product_name, description, key_features, target_audience,
      language, tone, creativity, variants, follow_up_count,
      shop_name, price, promo_offer, delivery_time, payment_method, legitimacy_info,
      additional_instructions,
    } = body;

    if (!product_name?.trim()) {
      return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
    }
    if (!shop_name?.trim()) {
      return NextResponse.json({ error: 'Shop name is required.' }, { status: 400 });
    }
    if (!price?.trim()) {
      return NextResponse.json({ error: 'Price is required.' }, { status: 400 });
    }
    if (!promo_offer?.trim()) {
      return NextResponse.json({ error: 'Promo/Offer is required.' }, { status: 400 });
    }

    const validLanguages = ['Taglish', 'English', 'Filipino'];
    const followUpAllowed = [0, 5, 10];

    const input: AdCopyInput = {
      productName: product_name.trim(),
      description: description?.trim() || undefined,
      keyFeatures: Array.isArray(key_features) ? key_features.filter(Boolean).slice(0, 5) : [],
      targetAudience: target_audience?.trim() || undefined,
      language: validLanguages.includes(language) ? language : 'Taglish',
      tone: tone?.trim() || 'Friendly at persuasive',
      creativity: typeof creativity === 'number' ? creativity : 0.7,
      variants: Math.min(5, Math.max(1, Number(variants) || 1)),
      followUpCount: (followUpAllowed.includes(Number(follow_up_count)) ? Number(follow_up_count) : 0) as 0 | 5 | 10,
      shopName: shop_name.trim(),
      price: price.trim(),
      promoOffer: promo_offer.trim(),
      deliveryTime: delivery_time?.trim() || undefined,
      paymentMethod: payment_method?.trim() || undefined,
      legitimacyInfo: legitimacy_info?.trim() || undefined,
      additionalInstructions: additional_instructions?.trim() || undefined,
    };

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
