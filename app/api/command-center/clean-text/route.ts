import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Cheap, short-text-only Anthropic call — grammar/spelling fix + summarize
// for Goldie's task/reminder titles, NOT the same cost story as TTS (see
// CommandCenterClient.tsx's speak()). A garbled voice transcript like
// "Hey goldi an for the tas at 5:05 p.m check the mvids FB ads" gets turned
// into a clean, short title before it ever reaches a preview card or gets
// saved — the free summarizeTitle() heuristic in lib/command-center.ts
// stays as the fallback if this call fails or the API key isn't set.
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Ikaw ay si Goldie, ang AI secretary ng may-ari ng negosyo. Binibigyan ka ng malabo o garbled na resulta mula sa boses-hanggang-text (speech-to-text) o mabilis na pagsusulat. Trabaho mo: ayusin ang grammar at spelling, at gawing maikli, malinaw, at actionable na title (max 60 characters) — parang isang task o paalala na nakasulat nang maayos.

Panuntunan:
- Panatilihin ang orihinal na wika/pagkakahalo (Taglish manatiling Taglish, English manatiling English) — huwag i-translate.
- Alisin ang mga filler word ("hey goldie", "please", "paki", atbp.) at date/time mentions.
- Kung malinaw naman ang orihinal, panatilihin lang halos kapareho, i-clean lang ang grammar/spelling.
- Sumagot lang ng cleaned title mismo. Walang quotes, walang paliwanag, walang ibang text.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured — caller falls back to the free heuristic, save flow never blocks on this.
    return NextResponse.json({ cleaned: null });
  }

  let text: string;
  try {
    const body = await req.json();
    text = typeof body?.text === 'string' ? body.text.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'Text is required' }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 500) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return NextResponse.json({ cleaned: null }); // silent fallback, not a hard error
    const data = await res.json();
    const cleaned = String(data?.content?.[0]?.text ?? '').trim().replace(/^["']+|["']+$/g, '');
    return NextResponse.json({ cleaned: cleaned || null });
  } catch {
    return NextResponse.json({ cleaned: null }); // timeout/network — fall back, don't block the save
  } finally {
    clearTimeout(timeout);
  }
}
