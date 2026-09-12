// Repeated production timeouts at max settings (5 variants + 10 follow-ups)
// persisted even after raising the per-call timeout to 60s — the prior
// 'claude-sonnet-4-6' id is an older, slower generation than what's
// current. Switched to the current Sonnet model.
const ANTHROPIC_MODEL = 'claude-sonnet-5';

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
  productImageBase64?: string;
  productImageMediaType?: string;
}

export interface ProductAutofillResult {
  productName: string;
  description: string;
  keyFeatures: string[];
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

// Sourced from Meta's official Advertising Standards
// (transparency.meta.com/policies/ad-standards) — quoted/paraphrased
// directly from policy text, not general assumptions, so this stays
// accurate to what actually gets ads rejected/restricted.
const FB_ADS_COMPLIANCE_RULES = `Facebook/Meta Ads Policy compliance (this copy goes straight into Ads Manager — violations risk ad rejection or account restriction):
- Never assert or imply a personal attribute about the reader — Meta's Advertising Standards explicitly prohibit ads that assert or imply someone's physical or mental health (including medical conditions), age, disability, or similar traits. Don't phrase copy as if it's stating a fact about the reader (no "you have dark spots", "struggling with acne", "bakit ang taba mo") — talk about the PRODUCT's benefit, never the reader's condition.
- Never imply negative self-perception to sell a diet, weight-loss, beauty, or health-related product — Meta specifically bans "content implying or attempting to generate negative self-perception in order to promote diet, weight loss or other health related products."
- No exaggerated, curative, or guaranteed-outcome claims for health/beauty/supplement products — avoid "cure", "guaranteed", "miracle", or a definitive result within a specific timeframe (e.g. don't promise skin will look a certain way "in 2 weeks"); use "helps support" / "may help improve" instead.
- No deceptive or unrealistic claims — Meta prohibits "deceptive tactics to mislead people... for commercial or financial gain" and unrealistic reward claims. Only state the exact price/offer/stock info actually given in the input — never invent numbers, countdowns, or claims not provided.
- Avoid engagement-bait phrasing ("double tap", "tag a friend to win", "share this post") — a single "Comment [keyword]" CTA is fine.
- No ALL CAPS words (short acronyms like COD are fine) and no more than one exclamation point per line.`;

function buildAdContentPrompt(input: AdCopyInput): { system: string; user: string } {
  const system = `You are an expert Facebook Ads + Messenger chatbot copywriter for Filipino online sellers, writing content that will be pasted directly into Facebook Ads Manager and a BotCake AI Messenger automation setup.

${VOICE_RULES}
${input.productImageBase64 ? `- A photo of the actual product is attached — ground the copy in what it really looks like (color, form factor, material, size cues) instead of generic claims.` : ''}

${FB_ADS_COMPLIANCE_RULES}

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

interface ImageInput {
  base64: string;
  mediaType: string;
}

async function callClaude(system: string, userPrompt: string, maxTokens: number, image?: ImageInput): Promise<string> {
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
        // `temperature` is deprecated/rejected (400) for this model — the
        // Creativity slider is currently informational only, kept in the
        // UI for when/if a supported knob is reintroduced.
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{
          role: 'user',
          content: image
            ? [
                { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                { type: 'text', text: userPrompt },
              ]
            : userPrompt,
        }],
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
  // Don't blindly read content[0] — this model can prepend non-text blocks
  // (e.g. a "thinking" block) before the actual text block, which was
  // silently returning '' and surfacing as a confusing JSON-parse failure.
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const textBlock = blocks.find((b: any) => b?.type === 'text');
  return textBlock?.text ?? '';
}

// Vision extraction to auto-fill Product Name/Description/Key Features from
// an uploaded product photo — a separate, small call (not part of the main
// ad-copy generation) so the user can review/edit the extracted fields
// before generating.
export async function analyzeProductImage(imageBase64: string, mediaType: string): Promise<ProductAutofillResult> {
  const system = `You are an expert e-commerce product analyst for the Filipino market. Look at the product photo and extract marketable details a seller would use to list this product.

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "productName": "string — a short, marketable product name based on what's visible in the photo",
  "description": "string — a 1-2 sentence product description covering what it is and its main benefit",
  "keyFeatures": ["string", "string"] // up to 5 short key features/selling points visible or reasonably implied by the photo (material, function, design, included items, etc.)
}`;

  const raw = await callClaude(system, 'Analyze this product photo and extract the details.', 1024, { base64: imageBase64, mediaType });
  const parsed = extractJson(raw) as any;

  const productName = String(parsed?.productName ?? '');
  if (!productName.trim()) {
    throw new AdCopyGeneratorError('Could not identify a product from this image — try a clearer photo or fill in the details manually.');
  }

  return {
    productName,
    description: String(parsed?.description ?? ''),
    keyFeatures: Array.isArray(parsed?.keyFeatures) ? parsed.keyFeatures.slice(0, 5).map((f: any) => String(f)) : [],
  };
}

export async function generateAdCopy(input: AdCopyInput): Promise<AdCopyResult> {
  const adPrompt = buildAdContentPrompt(input);
  const botPrompt = buildBotContentPrompt(input);
  const productImage: ImageInput | undefined = input.productImageBase64
    ? { base64: input.productImageBase64, mediaType: input.productImageMediaType || 'image/jpeg' }
    : undefined;

  const [adRaw, botRaw] = await Promise.all([
    // Only the ad-facing content call gets the image — it's the one where
    // visual grounding (what the product actually looks like) matters for
    // headline/primary text quality. The BotCake system prompts are
    // behavioral, not visual, so skipping the image there avoids paying
    // for it twice.
    callClaude(adPrompt.system, adPrompt.user, 4096, productImage),
    callClaude(botPrompt.system, botPrompt.user, 4096),
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
