import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Same persistent-storage convention as app/api/upload/receipt/route.ts.
const UPLOAD_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'ai-fb-ads')
  : path.join(process.cwd(), 'public', 'ai-fb-ads');

function saveImage(base64: string, mediaType: string, prefix: string): Promise<string> {
  const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(base64, 'base64')).then(() => filename);
}

// Persists the FINAL creative — the AI background with Product Name/Price/
// Discount/Headline/Benefits/CTA already composited on top by the client
// (see AiFbAdsClient.tsx). Called only after the client has produced that
// composite; this route never talks to the image-generation API itself.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ai_fb_ads')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      product_id, product_name, selling_price, old_price, offer, headline, benefits, cta,
      creative_style, format, reference_image_base64, reference_image_media_type,
      final_image_base64, final_image_media_type,
    } = body;

    if (!product_name?.trim()) return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
    if (!final_image_base64) return NextResponse.json({ error: 'Generated image is required.' }, { status: 400 });

    await mkdir(UPLOAD_DIR, { recursive: true });
    const sourceFilename = reference_image_base64
      ? await saveImage(reference_image_base64, reference_image_media_type || 'image/jpeg', 'source')
      : null;
    const finalFilename = await saveImage(final_image_base64, final_image_media_type || 'image/png', 'creative');

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO ai_fb_ad_creatives (
        product_id, product_name, selling_price, old_price, offer, benefits, headline, cta,
        creative_style, format, source_image_path, generated_image_path, created_by
      ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?)
    `).run(
      product_id || null, product_name.trim(), Number(selling_price) || null, Number(old_price) || null,
      offer?.trim() || null, JSON.stringify(Array.isArray(benefits) ? benefits.filter(Boolean).slice(0, 5) : []),
      headline?.trim() || null, cta?.trim() || 'Shop Now',
      creative_style || 'auto', format === '1:1' ? '1:1' : '4:5', sourceFilename, finalFilename, session.id
    );

    return NextResponse.json({
      id: Number(info.lastInsertRowid),
      image_path: `/api/ai-fb-ads/images/${finalFilename}`,
    }, { status: 201 });
  } catch (e: any) {
    console.error('[ai-fb-ads] save error:', e?.message);
    return NextResponse.json({ error: 'Failed to save the creative. Please try again.' }, { status: 500 });
  }
}
