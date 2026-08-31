import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Blocked internal/private hosts to prevent SSRF. The previous version only
// matched the literal strings '127.0.0.1' and '::1' — every other loopback
// address (127.0.0.2, [::1] with brackets as URL.hostname actually returns
// for IPv6) sailed straight through. This is still a hostname-string check,
// not a resolved-IP check, so it doesn't defend against DNS rebinding (a
// domain that resolves to an internal address) — the https-only restriction
// and the image/* content-type check below meaningfully cap what's
// reachable/returnable, but a determined attacker with DNS control isn't
// fully blocked by this alone.
function isBlockedHost(rawHostname: string): boolean {
  // URL.hostname keeps the brackets for IPv6, e.g. "[::1]" — strip them so
  // the checks below compare the bare address either way.
  const h = rawHostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === 'metadata.google.internal') return true;
  if (/^127\./.test(h)) return true;              // entire 127.0.0.0/8 loopback range, not just .0.0.1
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;          // link-local, incl. the 169.254.169.254 cloud-metadata endpoint
  if (h === '::1' || h === '::') return true;       // IPv6 loopback/unspecified
  if (/^fc00:|^fd00:/.test(h)) return true;         // IPv6 unique-local
  if (/^fe80:/.test(h)) return true;                // IPv6 link-local
  return false;
}

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

  if (isBlockedHost(parsed.hostname)) {
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
