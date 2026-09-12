import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { regenerateVideoAdCreativeHook, AdCopyGeneratorError, AD_ANGLES, COPY_LENGTHS, CONTENT_TYPES, TONE_OPTIONS, type VideoAnalysis, type VideoAdCopyInput } from '@/lib/ad-copy-generator';

export const dynamic = 'force-dynamic';
// regenerateVideoAdCreativeHook()'s callClaude call uses an 80s internal
// timeout (same large accumulated system prompt as full generation) — 95s
// leaves margin for parsing/serialization.
export const maxDuration = 95;

// Powers both "Use This Hook" (selected_hook/selected_angle set) and
// "Generate 3 New Hooks" (omitted) for video mode — always text-only,
// reuses the saved VideoAnalysis, never re-sends video frames.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      analysis, product_name, selling_price, original_price, target_audience,
      language, tone, ad_objective, ad_angle, copy_length, hide_price_in_ad_copy, offer,
      selected_hook, selected_angle, previous_hooks,
    } = body;

    if (!analysis || typeof analysis !== 'object' || !analysis.productName) {
      return NextResponse.json({ error: 'Missing product analysis — re-analyze the video first.' }, { status: 400 });
    }

    const validLanguages = ['Taglish', 'English', 'Filipino'];
    const adAngle = (ad_angle === 'AUTO' || (AD_ANGLES as readonly string[]).includes(ad_angle))
      ? ad_angle as VideoAdCopyInput['adAngle']
      : 'AUTO';
    const copyLength = (COPY_LENGTHS as readonly string[]).includes(copy_length)
      ? copy_length as VideoAdCopyInput['copyLength']
      : 'Standard';
    const validatedTone = (TONE_OPTIONS as readonly string[]).includes(tone)
      ? tone as VideoAdCopyInput['tone']
      : 'Friendly & Persuasive';

    const input: VideoAdCopyInput = {
      productName: product_name?.trim() || undefined,
      sellingPrice: selling_price?.trim() || undefined,
      originalPrice: original_price?.trim() || undefined,
      targetAudience: target_audience?.trim() || undefined,
      language: validLanguages.includes(language) ? language : 'Taglish',
      tone: validatedTone,
      adObjective: ad_objective?.trim() || undefined,
      adAngle,
      copyLength,
      hidePriceInAdCopy: hide_price_in_ad_copy === false ? false : true,
      offer: {
        cod: !!offer?.cod,
        freeShipping: !!offer?.freeShipping,
        nationwideDelivery: !!offer?.nationwideDelivery,
        limitedStock: !!offer?.limitedStock,
        limitedTimeSale: !!offer?.limitedTimeSale,
        discountPercent: offer?.discountPercent?.trim() || undefined,
        customOffer: offer?.customOffer?.trim() || undefined,
      },
    };

    const validatedAnalysis: VideoAnalysis = {
      contentType: (CONTENT_TYPES as readonly string[]).includes(analysis.contentType) ? analysis.contentType : 'SINGLE PRODUCT',
      productName: String(analysis.productName ?? ''),
      productCategory: String(analysis.productCategory ?? ''),
      targetCustomer: String(analysis.targetCustomer ?? ''),
      mainProblem: String(analysis.mainProblem ?? ''),
      mainDesire: String(analysis.mainDesire ?? ''),
      mainBenefits: Array.isArray(analysis.mainBenefits) ? analysis.mainBenefits.map(String) : [],
      features: Array.isArray(analysis.features) ? analysis.features.map(String) : [],
      objections: Array.isArray(analysis.objections) ? analysis.objections.map(String) : [],
      visualHook: String(analysis.visualHook ?? ''),
      offer: String(analysis.offer ?? ''),
      financingInfo: String(analysis.financingInfo ?? ''),
      recommendedAngle: String(analysis.recommendedAngle ?? ''),
      whyAngle: String(analysis.whyAngle ?? ''),
      tone: String(analysis.tone ?? ''),
    };

    const forcedHook = selected_hook?.trim() && selected_angle?.trim()
      ? { hook: selected_hook.trim(), angle: selected_angle.trim() }
      : undefined;
    const previousHooks = Array.isArray(previous_hooks) ? previous_hooks.map(String) : undefined;

    const result = await regenerateVideoAdCreativeHook(validatedAnalysis, input, forcedHook, previousHooks);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ad-copy-generator] video hook regeneration error:', e?.message);
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Could not update the hook. Please try again.' }, { status: 500 });
  }
}
