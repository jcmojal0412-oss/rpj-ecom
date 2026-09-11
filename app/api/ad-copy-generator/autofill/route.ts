import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { analyzeProductImage, AdCopyGeneratorError } from '@/lib/ad-copy-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { image_base64, image_media_type } = body;

    if (!image_base64 || typeof image_base64 !== 'string') {
      return NextResponse.json({ error: 'Product image is required.' }, { status: 400 });
    }

    const result = await analyzeProductImage(image_base64, image_media_type || 'image/jpeg');
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ad-copy-generator] autofill error:', e?.message);
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Could not analyze the image. Please try again.' }, { status: 500 });
  }
}
