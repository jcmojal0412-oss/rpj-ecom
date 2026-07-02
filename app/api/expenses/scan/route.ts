import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const PROMPT = `Extract payment information from this bank transfer or receipt screenshot.
Return ONLY valid JSON (no markdown, no prose) with exactly these keys:
{
  "date": "YYYY-MM-DD or null",
  "amount": number in PHP or null,
  "description": "brief description or null",
  "category": one of ["Supplier Payment","Ads Budget","Shipping Fee","Utilities","Salary","Rent","Office Supplies","Others"],
  "reference_no": "transaction/reference number or null",
  "bank_from": "sender bank or account name or null",
  "bank_to": "recipient bank or account name or null",
  "supplier_name": "the name of the person or business being paid (recipient name) or null"
}
For amounts, extract the numeric value in PHP only. If unclear, use null.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  try {
    let base64: string;
    let mediaType: string;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // iOS-safe path: client sends { base64, mediaType }
      const body = await req.json();
      base64 = body.base64;
      mediaType = body.mediaType || 'image/jpeg';
    } else {
      // Fallback: multipart FormData (desktop browsers)
      const formData = await req.formData();
      const file = formData.get('image') as File | null;
      if (!file) return NextResponse.json({ error: 'No image provided.' }, { status: 400 });
      const buffer = await file.arrayBuffer();
      base64 = Buffer.from(buffer).toString('base64');
      mediaType = file.type || 'image/jpeg';
    }

    // Normalize unsupported types (e.g. image/heic from iPhone) to jpeg
    if (!SUPPORTED_TYPES.includes(mediaType)) mediaType = 'image/jpeg';

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
      return NextResponse.json({ error: `AI error: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'Could not extract data from image.' }, { status: 422 });

    const parsed = JSON.parse(match[0]);
    console.log('[expenses/scan] extracted:', parsed);
    return NextResponse.json({ expense: parsed });
  } catch (e: any) {
    console.error('[expenses/scan] error:', e?.message);
    return NextResponse.json({ error: e?.message || 'Failed to scan image.' }, { status: 500 });
  }
}
