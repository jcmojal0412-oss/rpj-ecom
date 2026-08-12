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
- Kahit maikli, malabo, o parang tanong/pambungad ang input (hal. "test", "hello", isang salita lang) — ITUTURING mo pa rin itong TITULO na kailangang ayusin, HINDI mo ito sasagutin bilang chatbot at HINDI ka magtatanong pabalik o magbibigay ng paliwanag.
- Sumagot lang ng cleaned title mismo. Walang quotes, walang paliwanag, walang emoji, walang ibang text — kahit ano pa ang input.`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured — caller falls back to the free heuristic, save flow
    // never blocks on this. `reason: 'not_configured'` lets the UI show an
    // honest "not set up" message instead of a "try again" one that would
    // never actually help.
    return NextResponse.json({ cleaned: null, reason: 'not_configured' });
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
        // Token budget, not character budget — Taglish/mixed-language text
        // tokenizes less efficiently than plain English, so this leaves
        // headroom above the ~60-character title the prompt asks for
        // instead of risking a mid-word cutoff on longer garbled input.
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 500) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return NextResponse.json({ cleaned: null }); // silent fallback, not a hard error
    const data = await res.json();
    let cleaned = String(data?.content?.[0]?.text ?? '').trim().replace(/^["']+|["']+$/g, '');
    // Defense in depth against the prompt's "reply with only the title"
    // instruction slipping — seen live on a bare one-word input ("test"),
    // where the model answered conversationally instead ("I'm ready! Send
    // me..."). A title this long, or containing a question mark, is almost
    // certainly a chat reply, not a cleaned title — fall back rather than
    // risk saving a chatbot response as the task/reminder title.
    if (cleaned.length > 120 || cleaned.includes('?')) cleaned = '';
    return NextResponse.json({ cleaned: cleaned || null });
  } catch {
    return NextResponse.json({ cleaned: null }); // timeout/network — fall back, don't block the save
  } finally {
    clearTimeout(timeout);
  }
}
