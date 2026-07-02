import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Mirror the same upload dir logic as /api/upload/receipt
const UPLOAD_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'receipts')
  : path.join(process.cwd(), 'public', 'receipts');

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
For amounts, extract the numeric value in PHP only. If unclear, use null.
For dates, always output YYYY-MM-DD format.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  try {
    let base64: string;
    let mediaType = 'image/jpeg';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();

      if (body.filename) {
        // Two-step flow: file was already uploaded, read from disk
        const safeName = path.basename(body.filename); // prevent path traversal
        const filePath = path.join(UPLOAD_DIR, safeName);
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
    return NextResponse.json({ expense: parsed });
  } catch (e: any) {
    console.error('[scan] error:', e?.message, e?.stack?.slice(0, 300));
    return NextResponse.json({ error: e?.message || 'Failed to scan image.' }, { status: 500 });
  }
}
