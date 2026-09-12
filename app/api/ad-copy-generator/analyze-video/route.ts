import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { analyzeProductVideo, AdCopyGeneratorError, AD_ANGLES, COPY_LENGTHS, TONE_OPTIONS, type VideoAdCopyInput } from '@/lib/ad-copy-generator';
import { extractVideoFrames, VideoProcessingError } from '@/lib/video-frames';

export const dynamic = 'force-dynamic';
// Frame extraction (ffmpeg, several short subprocess calls) + one
// multi-image Claude call — generous but bounded budget for a 15-60s clip.
export const maxDuration = 90;

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
const ACCEPTED_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('video') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Product video is required.' }, { status: 400 });
    }

    const ext = ACCEPTED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported video format. Please upload MP4, MOV, or WEBM.' }, { status: 400 });
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: 'Video is too large (max 100MB).' }, { status: 400 });
    }

    const adAngleRaw = String(formData.get('ad_angle') || 'AUTO');
    const adAngle = (adAngleRaw === 'AUTO' || (AD_ANGLES as readonly string[]).includes(adAngleRaw))
      ? adAngleRaw as VideoAdCopyInput['adAngle']
      : 'AUTO';
    const validLanguages = ['Taglish', 'English', 'Filipino'];
    const languageRaw = String(formData.get('language') || 'Taglish');
    const copyLengthRaw = String(formData.get('copy_length') || 'Standard');
    const copyLength = (COPY_LENGTHS as readonly string[]).includes(copyLengthRaw)
      ? copyLengthRaw as VideoAdCopyInput['copyLength']
      : 'Standard';
    const toneRaw = String(formData.get('tone') || 'Friendly & Persuasive');
    const tone = (TONE_OPTIONS as readonly string[]).includes(toneRaw)
      ? toneRaw as VideoAdCopyInput['tone']
      : 'Friendly & Persuasive';

    const input: VideoAdCopyInput = {
      productName: (formData.get('product_name') as string)?.trim() || undefined,
      sellingPrice: (formData.get('selling_price') as string)?.trim() || undefined,
      originalPrice: (formData.get('original_price') as string)?.trim() || undefined,
      targetAudience: (formData.get('target_audience') as string)?.trim() || undefined,
      language: validLanguages.includes(languageRaw) ? (languageRaw as VideoAdCopyInput['language']) : 'Taglish',
      tone,
      adObjective: (formData.get('ad_objective') as string)?.trim() || undefined,
      adAngle,
      copyLength,
      offer: {
        cod: formData.get('offer_cod') === 'true',
        freeShipping: formData.get('offer_free_shipping') === 'true',
        nationwideDelivery: formData.get('offer_nationwide_delivery') === 'true',
        limitedStock: formData.get('offer_limited_stock') === 'true',
        limitedTimeSale: formData.get('offer_limited_time_sale') === 'true',
        discountPercent: (formData.get('offer_discount_percent') as string)?.trim() || undefined,
        customOffer: (formData.get('offer_custom') as string)?.trim() || undefined,
      },
    };

    const videoBuffer = Buffer.from(await file.arrayBuffer());
    const { frames, durationSec } = await extractVideoFrames(videoBuffer, ext, 8);

    const analysis = await analyzeProductVideo(
      frames.map(f => ({ base64: f.base64, mediaType: f.mediaType })),
      input
    );

    return NextResponse.json({ analysis, durationSec, frameCount: frames.length });
  } catch (e: any) {
    console.error('[ad-copy-generator] video analysis error:', e?.message);
    if (e instanceof VideoProcessingError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Unable to analyze the video. Please try again.' }, { status: 500 });
  }
}
