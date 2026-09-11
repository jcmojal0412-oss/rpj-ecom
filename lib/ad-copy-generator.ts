const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export class AdCopyGeneratorError extends Error {}

export interface AdCopyInput {
  productName: string;
  description?: string;
  keyFeatures: string[];
  targetAudience?: string;
  language: 'Taglish' | 'English' | 'Filipino';
  tone: string;
  creativity: number; // 0–1, mapped to Claude's temperature
  variants: number; // 1–5, applies to adCreatives
  followUpCount: 0 | 5 | 10;
  shopName: string;
  price: string;
  promoOffer: string;
  deliveryTime?: string;
  paymentMethod?: string;
  legitimacyInfo?: string;
  additionalInstructions?: string;
}

export interface AdCreativeVariant {
  headline: string;
  primaryText: string;
  messagingTemplate: string;
  quickReplies: string[];
}

export interface AdCopyResult {
  mainFlowReply: string;
  adCreatives: AdCreativeVariant[];
  salesPrompt: string;
  afterSalesPrompt: string;
  followUpMessages: string[];
}

// Scans forward from the first '{' tracking brace depth (ignoring braces
// inside string literals) to find the matching closing '}' — unlike a
// greedy regex to the LAST '}' in the text, this is immune to trailing
// prose/commentary after the JSON object that happens to contain braces
// (e.g. the model mentioning the literal {{PRICING}} placeholder outside
// the JSON body).
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced — likely truncated (hit max_tokens mid-object)
}

function extractJson(text: string): unknown {
  const candidate = extractBalancedJsonObject(text);
  if (!candidate) {
    console.error('[ad-copy-generator] no balanced JSON object found in response text:', text.slice(0, 1000));
    throw new AdCopyGeneratorError('AI response was incomplete or did not contain valid JSON — try again, or lower the variant/follow-up counts.');
  }
  try {
    return JSON.parse(candidate);
  } catch (parseErr) {
    console.error('[ad-copy-generator] JSON.parse failed:', parseErr, 'raw match:', candidate.slice(0, 1000));
    throw new AdCopyGeneratorError('Failed to parse AI response as JSON.');
  }
}

const VOICE_RULES = `Voice rules:
- Hook in the first line. No generic openers like "Introducing" or "Are you tired of".
- Write in the requested language/dialect. Taglish means a natural mix of Tagalog and English the way real Filipino sellers post — not a stiff translation.
- Short paragraphs/line breaks the way real FB posts and Messenger chats look. Light, natural emoji use that fits the tone — don't overdo it.
- Always weave in the exact price, offer, and shop trust signals given — never invent numbers or claims.`;

function buildInputLines(input: AdCopyInput): string {
  const features = input.keyFeatures.filter(Boolean);
  const lines = [
    `Product/Service: ${input.productName}`,
    input.description ? `Description: ${input.description}` : null,
    features.length ? `Key Features:\n${features.map(f => `- ${f}`).join('\n')}` : null,
    input.targetAudience ? `Target Audience: ${input.targetAudience}` : null,
    `Language: ${input.language}`,
    `Tone: ${input.tone}`,
    `Shop Name: ${input.shopName}`,
    `Price: ${input.price}`,
    `Promo/Offer: ${input.promoOffer}`,
    input.deliveryTime ? `Delivery Time: ${input.deliveryTime}` : null,
    input.paymentMethod ? `Payment Method: ${input.paymentMethod}` : null,
    input.legitimacyInfo ? `Trust/Legitimacy Info (weave in naturally, don't just list it): ${input.legitimacyInfo}` : null,
    input.additionalInstructions ? `Additional Instructions: ${input.additionalInstructions}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

// Two independent, parallel-callable prompts instead of one big request —
// a single call asking for all 5 sections (up to 5 ad variants + 2 full
// markdown system prompts + up to 10 follow-ups) was measured to exceed
// 80s end-to-end against the live Anthropic API, well past what a single
// non-streaming request should take. Splitting roughly halves wall-clock
// latency (both run concurrently) and gives each call a comfortably sized
// max_tokens budget instead of one shared, easily-exhausted ceiling.

function buildAdContentPrompt(input: AdCopyInput): { system: string; user: string } {
  const system = `You are an expert Facebook Ads + Messenger chatbot copywriter for Filipino online sellers, writing content that will be pasted directly into Facebook Ads Manager and a BotCake AI Messenger automation setup.

${VOICE_RULES}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "mainFlowReply": "string — the FIRST auto-reply BotCake sends the instant someone comments or messages the ad. Greets them, restates the offer/price/promo, lists key features as short bullet lines, ends with a clear CTA to reply/order.",
  "adCreatives": [
    {
      "headline": "string — short FB Ads Manager headline, max ~40 chars, curiosity or benefit-led",
      "primaryText": "string — the FB ad's primary text/caption, 2-4 short lines, ends with an engagement prompt (e.g. Comment a keyword)",
      "messagingTemplate": "string — the message shown when someone clicks 'Send Message' on the ad, restating the offer and inviting them to ask questions",
      "quickReplies": ["string", "string", "string"] // 3 short quick-reply button labels a customer might tap, e.g. "Paano ito gumagana?", "May stock pa?", "Order na ako!"
    }
  ]
}

Generate exactly ${input.variants} entr${input.variants === 1 ? 'y' : 'ies'} in adCreatives.`;

  return { system, user: buildInputLines(input) };
}

function buildBotContentPrompt(input: AdCopyInput): { system: string; user: string } {
  const system = `You are an expert Filipino e-commerce chatbot prompt engineer, writing BotCake AI system prompts and Messenger broadcast copy for an online seller.

${VOICE_RULES}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "salesPrompt": "string — a complete BotCake AI system prompt (markdown with ## headers) that instructs the sales chatbot how to behave: role/identity for this specific shop and product, a Personality section (bullet traits like Friendly, Professional, Natural, Never sound robotic), a Key Features section, a Price section, a Responsibilities section (qualify interest, answer questions, handle objections, close the sale, ask for order details), written in simple Taglish guidance the way a real prompt-engineered assistant persona reads.",
  "afterSalesPrompt": "string — a complete BotCake AI system prompt (markdown with ## headers) for the AFTER-SALES assistant: role/identity, Personality section, Key Features recap, Price, and a Responsibilities section focused on post-purchase support only (order status, delivery updates, concerns, returns) — instruct it to understand the customer's concern before replying.",
  "followUpMessages": ["string", "string"] // a Messenger broadcast nurture sequence sent to someone who inquired but hasn't ordered yet. Each message must escalate urgency or add a new angle (limited stock, social proof, curiosity hook, reminder, last call) — never just repeat the same pitch. Use the literal placeholders {{first_name}} and {{PRICING}} inside these messages wherever a name or price would appear, so BotCake fills them in per-recipient at send time — do NOT write the actual price or a real name in these messages.
}

${input.followUpCount > 0
    ? `Generate exactly ${input.followUpCount} entries in followUpMessages, in send order (message 1 first, escalating from there).`
    : `Return an empty array for followUpMessages.`}`;

  return { system, user: buildInputLines(input) };
}

async function callClaude(system: string, userPrompt: string, temperature: number, maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AdCopyGeneratorError('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const controller = new AbortController();
  // Measured in production: even the smaller, post-split per-call content
  // (bot prompts + up to 10 follow-ups, or up to 5 ad creatives) routinely
  // took longer than 45s end-to-end against the live Anthropic API — 45s
  // was too aggressive. 60s per call, run in parallel via Promise.all in
  // generateAdCopy(), still keeps total wall-clock well under the route's
  // 75s maxDuration.
  const timeout = setTimeout(() => controller.abort(), 60000);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new AdCopyGeneratorError('Request to Anthropic API timed out.');
    }
    throw new AdCopyGeneratorError(`Network error calling Anthropic API: ${e?.message || e}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[ad-copy-generator] Anthropic API error (${res.status}): ${detail.slice(0, 500)}`);
    throw new AdCopyGeneratorError(`Anthropic API error (${res.status}).`);
  }

  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

export async function generateAdCopy(input: AdCopyInput): Promise<AdCopyResult> {
  const temperature = Math.min(1, Math.max(0, input.creativity));

  const adPrompt = buildAdContentPrompt(input);
  const botPrompt = buildBotContentPrompt(input);

  const [adRaw, botRaw] = await Promise.all([
    callClaude(adPrompt.system, adPrompt.user, temperature, 4096),
    callClaude(botPrompt.system, botPrompt.user, temperature, 4096),
  ]);

  const adParsed = extractJson(adRaw) as any;
  const botParsed = extractJson(botRaw) as any;

  const adCreatives: AdCreativeVariant[] = Array.isArray(adParsed?.adCreatives)
    ? adParsed.adCreatives.map((v: any) => ({
        headline: String(v?.headline ?? ''),
        primaryText: String(v?.primaryText ?? ''),
        messagingTemplate: String(v?.messagingTemplate ?? ''),
        quickReplies: Array.isArray(v?.quickReplies) ? v.quickReplies.map((q: any) => String(q)) : [],
      }))
    : [];
  const followUpMessages: string[] = Array.isArray(botParsed?.followUpMessages)
    ? botParsed.followUpMessages.map((m: any) => String(m))
    : [];

  const mainFlowReply = String(adParsed?.mainFlowReply ?? '');
  const salesPrompt = String(botParsed?.salesPrompt ?? '');
  const afterSalesPrompt = String(botParsed?.afterSalesPrompt ?? '');

  // All five sections are required by the two system prompts — treat a
  // missing one as a generation failure rather than silently returning a
  // blank section the user might paste into a live BotCake chatbot unnoticed.
  if (!adCreatives.length) {
    throw new AdCopyGeneratorError('AI did not return any ad creatives.');
  }
  if (!mainFlowReply.trim()) {
    throw new AdCopyGeneratorError('AI did not return a Main Flow reply.');
  }
  if (!salesPrompt.trim()) {
    throw new AdCopyGeneratorError('AI did not return a Sales Prompt.');
  }
  if (!afterSalesPrompt.trim()) {
    throw new AdCopyGeneratorError('AI did not return an After-Sales Prompt.');
  }

  // Best-effort — the model is only instructed via prose to match these
  // counts, so a mismatch isn't a hard failure (partial results are still
  // useful), but it's worth surfacing in logs rather than passing silently.
  if (adCreatives.length !== input.variants) {
    console.warn(`[ad-copy-generator] requested ${input.variants} ad creative variant(s), got ${adCreatives.length}`);
  }
  if (input.followUpCount > 0 && followUpMessages.length !== input.followUpCount) {
    console.warn(`[ad-copy-generator] requested ${input.followUpCount} follow-up message(s), got ${followUpMessages.length}`);
  }

  return { mainFlowReply, adCreatives, salesPrompt, afterSalesPrompt, followUpMessages };
}
