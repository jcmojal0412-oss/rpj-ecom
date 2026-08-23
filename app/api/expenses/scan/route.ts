import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Mirror the same upload dir logic as /api/upload/receipt
const UPLOAD_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'receipts')
  : path.join(process.cwd(), 'public', 'receipts');

const PROMPT = `Extract expense payment information from this image — it could be a physical
receipt, a GCash/Maya/bank transfer screenshot, a supplier invoice, an FB/Meta
Ads payment screenshot, a payroll payment screenshot, or other proof of payment.

Return ONLY valid JSON (no markdown, no prose) with exactly these keys:
{
  "date": "YYYY-MM-DD or null",
  "amount": number in PHP or null,
  "paid_to": "the merchant, supplier, or recipient name or null",
  "reference_number": "transaction/reference number or null",
  "payment_method": one of ["Cash","GCash","Maya","Bank Transfer","Credit Card","Debit Card","Check","Other"] or null,
  "suggested_category": one of ["Products / Inventory","Payroll","FB Ads Spent","Loan","Rent","Bills","Others"] or null,
  "suggested_business": "Bodega ni Suki" or "RPJ ECOM" or null,
  "unable_to_detect": ["date","amount","paid_to","reference_number","payment_method","suggested_category"]
}

CRITICAL: Never guess or invent a value. If a field genuinely cannot be read
from the image, set it to null and add its key name to "unable_to_detect" —
"unable_to_detect" must ONLY ever contain values from this exact set, spelled
exactly like this (lowercase, underscores, no spaces): date, amount, paid_to,
reference_number, payment_method, suggested_category. Do not invent other
names, do not use spaces or capital letters, and only include a name there if
that exact field is null.
Only set "suggested_business" when the image explicitly names one of the two
businesses ("Bodega ni Suki" or "RPJ ECOM") — otherwise leave it null; do not
infer the business from the type of purchase alone.
For amounts, extract the numeric value in PHP only (no currency symbol/commas).
For dates, always output YYYY-MM-DD format.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  try {
    let base64: string;
    let mediaType = 'image/jpeg';
    let filePath: string | null = null;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();

      if (body.filename) {
        // Two-step flow: file was already uploaded, read from disk
        const safeName = path.basename(body.filename); // prevent path traversal
        filePath = path.join(UPLOAD_DIR, safeName);
        console.log(`[scan] reading file from disk: ${filePath}`);
        const buf = await readFile(filePath);
        base64 = buf.toString('base64');
        // Detect type from extension
        const ext = safeName.split('.').pop()?.toLowerCase();
        if (ext === 'png') mediaType = 'image/png';
        else if (ext === 'webp') mediaType = 'image/webp';
        else mediaType = 'image/jpeg';
      } else {
        // Inline base64 (legacy / small images)
        base64 = body.base64;
        mediaType = body.mediaType || 'image/jpeg';
      }
    } else {
      // Raw binary body
      const fileType = req.headers.get('x-file-type') || contentType || 'image/jpeg';
      mediaType = fileType;
      const buffer = await req.arrayBuffer();
      base64 = Buffer.from(buffer).toString('base64');
    }

    if (!SUPPORTED_TYPES.includes(mediaType)) mediaType = 'image/jpeg';
    if (!base64) return NextResponse.json({ error: 'No image data received.' }, { status: 400 });

    console.log(`[scan] mediaType=${mediaType} base64len=${base64.length}`);

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
      console.error('[scan] Anthropic error:', res.status, err.slice(0, 300));
      return NextResponse.json({ error: `AI error (${res.status}): ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'Could not extract data from image.' }, { status: 422 });

    const parsed = JSON.parse(match[0]);
    console.log('[scan] result:', parsed);

    // Unlike the old flow, the uploaded file is NOT deleted here — it's the
    // expense's permanent receipt attachment (saved via /api/upload/receipt
    // before this scan runs), not a disposable OCR scratch copy.

    return NextResponse.json({ expense: parsed });
  } catch (e: any) {
    console.error('[scan] error:', e?.message, e?.stack?.slice(0, 300));
    return NextResponse.json({ error: e?.message || 'Failed to scan image.' }, { status: 500 });
  }
}
