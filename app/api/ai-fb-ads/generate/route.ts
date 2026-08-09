import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildAdPrompt, CREATIVE_STYLES, type AdFormat, type CreativeStyle } from '@/lib/ai-fb-ads';
import { generateAdImage, ImageGenerationConfigError, ImageGenerationApiError } from '@/lib/image-generation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same persistent-storage convention as app/api/upload/receipt/route.ts —
// a folder next to the SQLite file on Railway (survives redeploys via the
// mounted volume), public/ai-fb-ads locally.
const UPLOAD_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'ai-fb-ads')
  : path.join(process.cwd(), 'public', 'ai-fb-ads');

function saveImage(base64: string, mediaType: string, prefix: string): Promise<string> {
  const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  return writeFile(filepath, Buffer.from(base64, 'base64')).then(() => filename);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ai_fb_ads')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      product_id, product_name, selling_price, old_price, offer, headline,
      benefits, cta, creative_style, format,
      reference_image_base64, reference_image_media_type,
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
    const benefitList: string[] = Array.isArray(benefits) ? benefits.filter(Boolean).slice(0, 5) : [];
    const ctaLabel: string = cta?.trim() || 'Shop Now';

    const prompt = buildAdPrompt({
      productName: product_name.trim(),
      price: selling_price ? `₱${selling_price}` : '',
      oldPrice: old_price ? `₱${old_price}` : undefined,
      offer: offer?.trim() || undefined,
      headline: headline?.trim() || undefined,
      benefits: benefitList,
      cta: ctaLabel,
      creativeStyle: style,
      format: adFormat,
    });

    let generated;
    try {
      generated = await generateAdImage({
        prompt,
        referenceImageBase64: reference_image_base64,
        referenceImageMediaType: reference_image_media_type || 'image/jpeg',
        format: adFormat,
      });
    } catch (e: any) {
      console.error('[ai-fb-ads] generation error:', e?.message);
      if (e instanceof ImageGenerationConfigError) {
        return NextResponse.json({ error: 'API configuration is missing.' }, { status: 500 });
      }
      if (e instanceof ImageGenerationApiError) {
        return NextResponse.json({ error: 'Image generation failed. Please try again.' }, { status: 502 });
      }
      return NextResponse.json({ error: 'Image generation failed. Please try again.' }, { status: 500 });
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const sourceFilename = await saveImage(reference_image_base64, reference_image_media_type || 'image/jpeg', 'source');
    const generatedFilename = await saveImage(generated.imageBase64, generated.mediaType, 'creative');

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO ai_fb_ad_creatives (
        product_id, product_name, selling_price, old_price, offer, benefits, headline, cta,
        creative_style, format, source_image_path, generated_image_path, created_by
      ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?)
    `).run(
      product_id || null, product_name.trim(), Number(selling_price) || null, Number(old_price) || null,
      offer?.trim() || null, JSON.stringify(benefitList), headline?.trim() || null, ctaLabel,
      style, adFormat, sourceFilename, generatedFilename, session.id
    );

    return NextResponse.json({
      id: Number(info.lastInsertRowid),
      image_path: `/api/ai-fb-ads/images/${generatedFilename}`,
    }, { status: 201 });
  } catch (e: any) {
    console.error('[ai-fb-ads] error:', e?.message, e?.stack?.slice(0, 300));
    return NextResponse.json({ error: 'Image generation failed. Please try again.' }, { status: 500 });
  }
}
