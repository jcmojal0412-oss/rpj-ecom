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

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[ad-copy-generator] no JSON found in response text:', text.slice(0, 1000));
    throw new AdCopyGeneratorError('AI response did not contain valid JSON.');
  }
  try {
    return JSON.parse(match[0]);
  } catch (parseErr) {
    console.error('[ad-copy-generator] JSON.parse failed:', parseErr, 'raw match:', match[0].slice(0, 1000));
    throw new AdCopyGeneratorError('Failed to parse AI response as JSON.');
  }
}

function buildPrompt(input: AdCopyInput): { system: string; user: string } {
  const system = `You are an expert Facebook Ads + Messenger chatbot copywriter for Filipino online sellers, writing content that will be pasted directly into a BotCake AI Messenger automation setup and into Facebook Ads Manager.

Voice rules:
- Hook in the first line. No generic openers like "Introducing" or "Are you tired of".
- Write in the requested language/dialect. Taglish means a natural mix of Tagalog and English the way real Filipino sellers post — not a stiff translation.
- Short paragraphs/line breaks the way real FB posts and Messenger chats look. Light, natural emoji use that fits the tone — don't overdo it.
- Always weave in the exact price, offer, and shop trust signals given — never invent numbers or claims.

You must produce FIVE pieces of content, and respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "mainFlowReply": "string — the FIRST auto-reply BotCake sends the instant someone comments or messages the ad. Greets them, restates the offer/price/promo, lists key features as short bullet lines, ends with a clear CTA to reply/order.",
  "adCreatives": [
    {
      "headline": "string — short FB Ads Manager headline, max ~40 chars, curiosity or benefit-led",
      "primaryText": "string — the FB ad's primary text/caption, 2-4 short lines, ends with an engagement prompt (e.g. Comment a keyword)",
      "messagingTemplate": "string — the message shown when someone clicks 'Send Message' on the ad, restating the offer and inviting them to ask questions",
      "quickReplies": ["string", "string", "string"] // 3 short quick-reply button labels a customer might tap, e.g. "Paano ito gumagana?", "May stock pa?", "Order na ako!"
    }
  ],
  "salesPrompt": "string — a complete BotCake AI system prompt (markdown with ## headers) that instructs the sales chatbot how to behave: role/identity for this specific shop and product, a Personality section (bullet traits like Friendly, Professional, Natural, Never sound robotic), a Key Features section, a Price section, a Responsibilities section (qualify interest, answer questions, handle objections, close the sale, ask for order details), written in simple Taglish guidance the way a real prompt-engineered assistant persona reads.",
  "afterSalesPrompt": "string — a complete BotCake AI system prompt (markdown with ## headers) for the AFTER-SALES assistant: role/identity, Personality section, Key Features recap, Price, and a Responsibilities section focused on post-purchase support only (order status, delivery updates, concerns, returns) — instruct it to understand the customer's concern before replying.",
  "followUpMessages": ["string", "string"] // a Messenger broadcast nurture sequence sent to someone who inquired but hasn't ordered yet. Each message must escalate urgency or add a new angle (limited stock, social proof, curiosity hook, reminder, last call) — never just repeat the same pitch. Use the literal placeholders {{first_name}} and {{PRICING}} inside these messages wherever a name or price would appear, so BotCake fills them in per-recipient at send time — do NOT write the actual price or a real name in these messages.
}

Generate exactly ${input.variants} entr${input.variants === 1 ? 'y' : 'ies'} in adCreatives.
${input.followUpCount > 0
    ? `Generate exactly ${input.followUpCount} entries in followUpMessages, in send order (message 1 first, escalating from there).`
    : `Return an empty array for followUpMessages.`}`;

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

  return { system, user: lines.join('\n') };
}

async function callClaude(system: string, userPrompt: string, temperature: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AdCopyGeneratorError('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const controller = new AbortController();
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
        max_tokens: 4096,
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
  const { system, user } = buildPrompt(input);
  const temperature = Math.min(1, Math.max(0, input.creativity));
  const raw = await callClaude(system, user, temperature);
  const parsed = extractJson(raw) as any;

  const adCreatives: AdCreativeVariant[] = Array.isArray(parsed?.adCreatives)
    ? parsed.adCreatives.map((v: any) => ({
        headline: String(v?.headline ?? ''),
        primaryText: String(v?.primaryText ?? ''),
        messagingTemplate: String(v?.messagingTemplate ?? ''),
        quickReplies: Array.isArray(v?.quickReplies) ? v.quickReplies.map((q: any) => String(q)) : [],
      }))
    : [];
  const followUpMessages: string[] = Array.isArray(parsed?.followUpMessages)
    ? parsed.followUpMessages.map((m: any) => String(m))
    : [];

  if (!adCreatives.length) {
    throw new AdCopyGeneratorError('AI did not return any ad creatives.');
  }

  return {
    mainFlowReply: String(parsed?.mainFlowReply ?? ''),
    adCreatives,
    salesPrompt: String(parsed?.salesPrompt ?? ''),
    afterSalesPrompt: String(parsed?.afterSalesPrompt ?? ''),
    followUpMessages,
  };
}
