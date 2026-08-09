import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildAdPrompt, CREATIVE_STYLES, PRESET_PROMPTS, type AdFormat, type CreativeStyle, type PromptMode, type PresetKey } from '@/lib/ai-fb-ads';
import { generateAdImage, ImageGenerationConfigError, ImageGenerationApiError } from '@/lib/image-generation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Generation only — no DB/disk save here. Returns the raw AI-generated
// poster (see lib/ai-fb-ads.ts's V1.3 "full poster" prompt — the AI now
// renders Headline/Benefits/Offer/CTA text itself, verbatim, as part of
// the composition) as base64. The only thing deliberately kept OUT of the
// image is the numeric Price/Old Price/Discount — the client sends this
// straight through to POST /api/ai-fb-ads/save with no further compositing.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ai_fb_ads')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      product_name, headline, benefits, offer, cta, creative_style, format,
      reference_image_base64, reference_image_media_type,
      prompt_mode, preset_key, custom_prompt,
    } = body;

    if (!product_name?.trim()) {
      return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
    }
    if (!reference_image_base64) {
      return NextResponse.json({ error: 'Product image is required.' }, { status: 400 });
    }
    const validStyles = CREATIVE_STYLES.map(s => s.key);
    const style: CreativeStyle = validStyles.includes(creative_style) ? creative_style : 'auto';
    const adFormat: AdFormat = format === '1:1' ? '1:1' : '4:5';
    const mode: PromptMode = ['auto', 'preset', 'custom'].includes(prompt_mode) ? prompt_mode : 'auto';
    const validPresets = PRESET_PROMPTS.map(p => p.key);
    const preset: PresetKey | undefined = validPresets.includes(preset_key) ? preset_key : undefined;

    const prompt = buildAdPrompt({
      productName: product_name.trim(),
      headline: headline || undefined,
      benefits: Array.isArray(benefits) ? benefits.filter(Boolean).slice(0, 5) : undefined,
      offer: offer || undefined,
      cta: cta || undefined,
      creativeStyle: style,
      format: adFormat,
      promptMode: mode,
      presetKey: preset,
      customPrompt: mode === 'custom' ? custom_prompt : undefined,
    });

    const generated = await generateAdImage({
      prompt,
      referenceImageBase64: reference_image_base64,
      referenceImageMediaType: reference_image_media_type || 'image/jpeg',
      format: adFormat,
    });

    return NextResponse.json({
      background_base64: generated.imageBase64,
      background_media_type: generated.mediaType,
    });
  } catch (e: any) {
    console.error('[ai-fb-ads] generation error:', e?.message, e?.stack?.slice(0, 300));
    if (e instanceof ImageGenerationConfigError) {
      return NextResponse.json({ error: 'API configuration is missing.' }, { status: 500 });
    }
    if (e instanceof ImageGenerationApiError) {
      return NextResponse.json({ error: 'Image generation failed. Please try again.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Image generation failed. Please try again.' }, { status: 500 });
  }
}
