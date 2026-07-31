import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

const PROMPT = `Extract sale information from this financing/payment screenshot.
It will be a screenshot from one of these PH financing/payment apps: Skyro, Billease, Salmon, Home Credit, or a POS Terminal (card/QR terminal) receipt.
Return ONLY valid JSON (no markdown, no prose) with exactly these keys:
{
  "provider": one of ["SKYRO","BILLEASE","SALMON","HOME CREDIT","POS TERMINAL"] — identify from the app branding/logo/text in the screenshot, or "POS TERMINAL" if it looks like a generic card/QR terminal receipt with no financing branding,
  "date": "YYYY-MM-DD or null",
  "amount": number in PHP or null,
  "customer_name": "the customer/buyer name if shown, or null",
  "reference_no": "transaction/reference/approval number or null"
}
For amounts, extract the numeric value in PHP only (no currency symbols, no commas). If unclear, use null.
For dates, always output YYYY-MM-DD format.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  try {
    const body = await req.json();
    let base64: string = body.base64;
    let mediaType: string = body.mediaType || 'image/jpeg';
    if (!SUPPORTED_TYPES.includes(mediaType)) mediaType = 'image/jpeg';
    if (!base64) return NextResponse.json({ error: 'No image data received.' }, { status: 400 });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[financing-scan] Anthropic error:', res.status, err.slice(0, 300));
      return NextResponse.json({ error: `AI error (${res.status}): ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'Could not extract data from image.' }, { status: 422 });

    const parsed = JSON.parse(match[0]);
    if (!PROVIDERS.includes(parsed.provider)) parsed.provider = 'POS TERMINAL';

    return NextResponse.json({ sale: parsed });
  } catch (e: any) {
    console.error('[financing-scan] error:', e?.message, e?.stack?.slice(0, 300));
    return NextResponse.json({ error: e?.message || 'Failed to scan image.' }, { status: 500 });
  }
}
