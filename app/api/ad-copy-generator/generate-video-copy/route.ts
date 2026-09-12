import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateVideoAdCopy, AdCopyGeneratorError, AD_ANGLES, COPY_LENGTHS, type VideoAnalysis, type VideoAdCopyInput } from '@/lib/ad-copy-generator';

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
    const { analysis, product_name, selling_price, original_price, target_audience, language, ad_objective, ad_angle, copy_length, offer, extra_instruction } = body;

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

    const input: VideoAdCopyInput = {
      productName: product_name?.trim() || undefined,
      sellingPrice: selling_price?.trim() || undefined,
      originalPrice: original_price?.trim() || undefined,
      targetAudience: target_audience?.trim() || undefined,
      language: validLanguages.includes(language) ? language : 'Taglish',
      adObjective: ad_objective?.trim() || undefined,
      adAngle,
      copyLength,
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
      recommendedAngle: String(analysis.recommendedAngle ?? ''),
      whyAngle: String(analysis.whyAngle ?? ''),
      tone: String(analysis.tone ?? ''),
    };

    const result = await generateVideoAdCopy(validatedAnalysis, input, extra_instruction?.trim() || undefined);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ad-copy-generator] video copy generation error:', e?.message);
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Ad copy generation failed. Please try again.' }, { status: 500 });
  }
}
