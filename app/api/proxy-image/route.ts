import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Blocked internal/private IP ranges to prevent SSRF
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal'];

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

  if (parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only HTTPS allowed' }, { status: 400 });
  }

  if (BLOCKED_HOSTNAMES.includes(parsed.hostname) || parsed.hostname.match(/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./)) {
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
      console.warn(`[proxy-image] upstream ${upstream.status} for ${parsed.hostname}`);
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      console.warn('[proxy-image] non-image content-type:', contentType, 'from', parsed.hostname);
      return NextResponse.json({ error: 'Not an image' }, { status: 422 });
    }

    const buffer = await upstream.arrayBuffer();
    console.log(`[proxy-image] ok ${parsed.hostname} (${buffer.byteLength}b)`);

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
