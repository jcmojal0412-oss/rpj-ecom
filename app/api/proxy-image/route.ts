import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = [
  'down-ph.img.susercontent.com',
  'down.img.susercontent.com',
  'cf.shopee.ph',
  'cf.shopee.sg',
  'sg-live.slatic.net',
  'ph-live.slatic.net',
  'img.lazada.com.ph',
  'laz-img-cdn.alicdn.com',
  'ae01.alicdn.com',
  'ae02.alicdn.com',
  'ae03.alicdn.com',
  'ae04.alicdn.com',
  'm.media-amazon.com',
  'images-na.ssl-images-amazon.com',
  'i.tiktokcdn.com',
  'p16-sign-sg.tiktokcdn.com',
  'p77-sign-sg.tiktokcdn.com',
  'p16-amd-va.tiktokcdn.com',
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.some(h => parsed.hostname.endsWith(h))) {
    console.warn('[proxy-image] blocked host:', parsed.hostname);
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://shopee.ph/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e: any) {
    console.error('[proxy-image] fetch failed:', e?.message);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
  }
}
