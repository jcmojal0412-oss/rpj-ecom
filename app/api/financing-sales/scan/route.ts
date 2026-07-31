import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

const PROMPT = `Extract sale information from this financing/payment screenshot.

It may be EITHER of these two shapes:
1. A single screenshot from one of these PH financing/payment apps: Skyro, Billease, Salmon, Home Credit, or a POS Terminal (card/QR terminal) receipt — one transaction.
2. A chat/text summary message (e.g. from a cashier reporting the day's sales) listing MULTIPLE sales across different providers, like:
   "Financing 7/31/26
   Skyro - 8999
   Billease - 39,698.00
   Salmon- 8,099
   Total- 56,796.00"
   In this case extract EVERY distinct provider/amount line as its own separate entry — do NOT include the "Total" line as a sale, and do NOT merge lines together.

Return ONLY valid JSON (no markdown, no prose) with exactly this shape:
{
  "sales": [
    {
      "provider": one of ["SKYRO","BILLEASE","SALMON","HOME CREDIT","POS TERMINAL"] — match the provider name in the text/branding (e.g. "Billease"→"BILLEASE"), or "POS TERMINAL" if it's a generic card/QR terminal receipt with no financing branding,
      "date": "YYYY-MM-DD or null — if a single date/header applies to the whole message (e.g. a date at the top), use that same date for every line under it",
      "amount": number in PHP or null,
      "customer_name": "the customer/buyer name if shown, or null",
      "reference_no": "transaction/reference/approval number if shown, or null"
    }
  ]
}
Include one array entry per distinct sale found — a single-transaction screenshot produces an array of exactly one entry.
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
        max_tokens: 1024,
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
    const sales = Array.isArray(parsed.sales) ? parsed.sales : [];
    for (const s of sales) {
      if (!PROVIDERS.includes(s.provider)) s.provider = 'POS TERMINAL';
    }

    if (!sales.length) return NextResponse.json({ error: 'No sales found in image.' }, { status: 422 });

    return NextResponse.json({ sales });
  } catch (e: any) {
    console.error('[financing-scan] error:', e?.message, e?.stack?.slice(0, 300));
    return NextResponse.json({ error: e?.message || 'Failed to scan image.' }, { status: 500 });
  }
}
