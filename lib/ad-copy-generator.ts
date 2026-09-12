import { logAiUsage } from './db';

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

// Proven direct-response techniques that increase conversion WITHOUT
// tripping the compliance rules above — the two sections work together:
// compliance sets the hard boundaries, this is how to persuade hard within
// them (real specificity/social proof/friction-removal instead of fake
// urgency or reader-attribute claims).
const HIGH_CONVERSION_TECHNIQUES = `High-conversion techniques (apply all of these within the compliance rules above):
- Open with a pattern-interrupt hook about the PRODUCT or a common situation — a bold specific claim, a relatable scenario, or a genuine question — never an assertion about the reader's own body/health/condition.
- Lead with the single sharpest, most specific benefit using the REAL numbers given (exact price, exact feature) — one sharp specific claim converts better than several vague ones.
- Weave in the real social proof from Trust/Legitimacy Info if given (exact review count, years in business, certifications) — specific proof beats generic "trusted by many."
- Actively remove buying friction: mention COD/no-advance-payment, how simple ordering is, and any return/warranty info given — an unspoken objection killed early closes more sales than one left unaddressed.
- End every piece with exactly ONE unmistakable next action — tell them precisely what to type or click, never stack multiple competing CTAs.
- If a real promo/offer was given, state its actual terms with confidence — let urgency come from truth (e.g. "sa ngayon lang available ang promo price na ito") rather than invented countdowns or fabricated stock numbers.`;

function buildAdContentPrompt(input: AdCopyInput): { system: string; user: string } {
  const system = `You are an expert Facebook Ads + Messenger chatbot copywriter for Filipino online sellers, writing content that will be pasted directly into Facebook Ads Manager and a BotCake AI Messenger automation setup.

${VOICE_RULES}
${input.productImageBase64 ? `- A photo of the actual product is attached — ground the copy in what it really looks like (color, form factor, material, size cues) instead of generic claims.` : ''}

${FB_ADS_COMPLIANCE_RULES}

${HIGH_CONVERSION_TECHNIQUES}

HOOK ENGINE: before writing a headline/primaryText, silently consider several hook angles for this product (visual scroll-stopper, curiosity, desire, problem/pain, product demonstration, price/value, gift, lifestyle, social status, before/after) and pick the strongest one — do not default to a generic question-opener ("Ilang beses mo na ba naisip...", "Looking for the perfect product?", "Are you tired of...?", "Introducing our amazing...") unless it's genuinely the strongest option for this product, which should be rare. If ${input.variants} variant(s) are requested, each must center on one clearly different big idea/angle, not the same ad reworded. Convert features into benefits in plain conversational language — never a supplier-catalog or spec-sheet tone (avoid "ornate", "filigree", "meticulously crafted", "sophisticated", "exquisite" unless truly unavoidable).

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "mainFlowReply": "string — the FIRST auto-reply BotCake sends the instant someone comments or messages the ad. Greets them, restates the offer/price/promo, lists key features as short bullet lines, ends with a clear CTA to reply/order.",
  "adCreatives": [
    {
      "headline": "string — short FB Ads Manager headline, max ~40 chars, from the hook engine above",
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
  "salesPrompt": "string — a complete BotCake AI system prompt (markdown with ## headers) that instructs the sales chatbot how to behave: role/identity for this specific shop and product, a Personality section (bullet traits like Friendly, Professional, Natural, Never sound robotic), a Key Features section, a Price section, and a Responsibilities section written as a real closing playbook, not generic advice — instruct it to: (1) build desire by walking through the strongest benefits BEFORE stating price, (2) proactively pre-empt the top 2-3 objections a buyer would have about this specific product (price, trust/legitimacy, delivery) using the real info given, (3) use an assumptive-close style once interest is confirmed (ask for order details as the natural next step, not 'do you want to order?'), (4) if the customer hesitates, offer the real promo/guarantee/COD terms as reassurance rather than inventing a new discount, (5) ask for full name, address, and contact number to close. All written in simple Taglish guidance the way a real prompt-engineered sales persona reads — this is an internal chatbot instruction, not public ad copy, so it can be direct and assertive about closing the sale as long as it never invents facts not given in the input.",
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

async function callClaude(feature: string, system: string, userPrompt: string, maxTokens: number, images?: ImageInput[]): Promise<string> {
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
          content: images?.length
            ? [
                ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
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

  const inputTokens = Number(data?.usage?.input_tokens) || 0;
  const outputTokens = Number(data?.usage?.output_tokens) || 0;
  try {
    logAiUsage(feature, inputTokens, outputTokens);
  } catch (e) {
    // Never let usage logging break the actual generation.
    console.error('[ad-copy-generator] failed to log AI usage:', e);
  }

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
export async function analyzeProductImage(imageBase64: string, mediaType: string, language: 'Taglish' | 'English' | 'Filipino' = 'Taglish'): Promise<ProductAutofillResult> {
  const system = `You are an e-commerce listing writer for ordinary Filipino Facebook sellers and buyers — NOT a supplier catalog or product spec sheet. Look at the product photo and extract details a real seller would post to sell this on Facebook.

Key Features rules — this is the part that most needs to sound human, not like a catalog:
- Maximum 5 features, each only 3-10 words. One idea per feature. No full paragraphs.
- Write the way an ordinary buyer talks, not a product datasheet. Never use words like "ornate", "filigree", "aesthetic centerpiece", "meticulously crafted", "intricate detailing", "sophisticated", "exquisite", or "premium craftsmanship" unless truly unavoidable.
- Convert technical description into what the customer actually gets. "Ornate silver-tone filigree border with smaller evil eye beads" becomes "Elegant silver & blue details". "Golden metal bells that create soft chime sounds when hung" becomes "Soft chime sound from golden bells". "Ideal for home, garden, car, or gift-giving" becomes "Great for home, balcony, garden or as a gift".
- Prioritize, in order, whichever apply: (1) the main visual feature, (2) the main functional benefit, (3) design/appearance, (4) where it can be used, (5) gift/lifestyle angle.
- Language: ${language === 'Taglish' ? 'write in natural Taglish the way a real Filipino seller posts (e.g. "🧿 Lucky Eye design na eye-catching", "🔔 Soft chime sound kapag nahahanginan", "🏡 Pang-room, balcony, garden o home décor") — do not translate word-for-word from English, write it naturally' : language === 'Filipino' ? 'write in natural conversational Filipino, not stiff/formal textbook Filipino' : 'write in simple, plain e-commerce English a casual buyer would read in seconds, not formal or technical English'}.
- A buyer should understand what the product is and why they'd want it within 3-5 seconds of reading the features.

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "productName": "string — a short, marketable product name based on what's visible in the photo",
  "description": "string — a 1-2 sentence product description in the same simple, conversational tone as the features (not catalog language)",
  "keyFeatures": ["string", "string"] // up to 5, following the Key Features rules above exactly
}`;

  const raw = await callClaude('photo_autofill', system, 'Analyze this product photo and extract the details.', 1024, [{ base64: imageBase64, mediaType }]);
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
  const productImage: ImageInput[] | undefined = input.productImageBase64
    ? [{ base64: input.productImageBase64, mediaType: input.productImageMediaType || 'image/jpeg' }]
    : undefined;

  const [adRaw, botRaw] = await Promise.all([
    // Only the ad-facing content call gets the image — it's the one where
    // visual grounding (what the product actually looks like) matters for
    // headline/primary text quality. The BotCake system prompts are
    // behavioral, not visual, so skipping the image there avoids paying
    // for it twice.
    callClaude('text_ad_content', adPrompt.system, adPrompt.user, 4096, productImage),
    callClaude('text_bot_content', botPrompt.system, botPrompt.user, 4096),
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

// ── Video Ad Copy (v1) ──────────────────────────────────────────────────────
// Upload a product video → extract frames server-side (lib/video-frames.ts)
// → analyze once, save the analysis → generate ad copy from the analysis.
// The expensive step (analyzing frames) happens once; "Regenerate" and future
// rewrite actions reuse the saved VideoAnalysis instead of re-sending frames.

export const AD_ANGLES = [
  'Pain/Problem', 'Problem-Solution', 'Fear/Loss Aversion', 'Curiosity', 'Masa/Sulit',
  'Premium', 'Mommy/Family', 'Lifestyle', 'Before/After', 'Convenience',
  'Social Proof', 'Urgency', 'Hard Sell', 'Soft Sell', 'UGC Style', 'Retargeting',
] as const;

export interface VideoOfferInput {
  cod?: boolean;
  freeShipping?: boolean;
  nationwideDelivery?: boolean;
  limitedStock?: boolean;
  limitedTimeSale?: boolean;
  discountPercent?: string;
  customOffer?: string;
}

export const COPY_LENGTHS = ['Short', 'Standard', 'Long'] as const;

export interface VideoAdCopyInput {
  productName?: string;
  sellingPrice?: string;
  originalPrice?: string;
  targetAudience?: string;
  language: 'Taglish' | 'English' | 'Filipino';
  adObjective?: string;
  adAngle: 'AUTO' | typeof AD_ANGLES[number];
  copyLength: typeof COPY_LENGTHS[number];
  offer: VideoOfferInput;
}

export interface VideoAnalysis {
  productName: string;
  productCategory: string;
  targetCustomer: string;
  mainProblem: string;
  mainDesire: string;
  mainBenefits: string[];
  features: string[];
  objections: string[];
  visualHook: string;
  offer: string;
  recommendedAngle: string;
  whyAngle: string;
  tone: string;
}

export interface VideoAdVersion {
  angle: string;
  hook: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
}

export interface VideoExtraHook {
  category: 'Curiosity' | 'Problem' | 'Benefit' | 'Desire' | 'Sales' | 'UGC';
  hook: string;
}

export interface VideoAdCopyResult {
  versions: VideoAdVersion[];
  extraHooks: VideoExtraHook[];
}

function describeOffer(offer: VideoOfferInput): string | null {
  const parts: string[] = [];
  if (offer.cod) parts.push('Cash on Delivery');
  if (offer.freeShipping) parts.push('Free Shipping');
  if (offer.nationwideDelivery) parts.push('Nationwide Delivery');
  if (offer.limitedStock) parts.push('Limited Stock');
  if (offer.limitedTimeSale) parts.push('Limited-Time Sale');
  if (offer.discountPercent) parts.push(`${offer.discountPercent}% OFF`);
  if (offer.customOffer) parts.push(offer.customOffer);
  return parts.length ? parts.join(', ') : null;
}

function buildVideoInputLines(input: VideoAdCopyInput): string {
  const offerText = describeOffer(input.offer);
  const lines = [
    input.productName ? `Product Name (user-provided): ${input.productName}` : null,
    input.sellingPrice ? `Selling Price: ${input.sellingPrice}` : null,
    input.originalPrice ? `Original Price: ${input.originalPrice}` : null,
    input.targetAudience ? `Target Audience: ${input.targetAudience}` : null,
    `Language: ${input.language}`,
    input.adObjective ? `Ad Objective: ${input.adObjective}` : null,
    input.adAngle !== 'AUTO' ? `Required Ad Angle: ${input.adAngle}` : `Ad Angle: AUTO — choose the strongest angle yourself.`,
    offerText ? `Offer (use ONLY these terms, exactly — do not add or infer any other offer): ${offerText}` : `Offer: none given — do not state any price, discount, or promo unless it is visibly on-screen in the video.`,
  ].filter(Boolean);
  return lines.join('\n');
}

// Deterministic, code-built allow-list — NOT AI-inferred — of every trust/
// offer claim this specific request is actually allowed to state. This is
// the single source of truth the copy prompt is told to obey; anything not
// on this list (registered business, permit, 100% original, FDA approved,
// doctor recommended, warranty, guarantee, discount %, free shipping, COD,
// limited stock, etc.) must not appear unless it's here.
function buildVerifiedClaims(input: VideoAdCopyInput): string {
  const claims: string[] = [];
  if (input.sellingPrice) claims.push(`Price: ${input.sellingPrice}`);
  if (input.originalPrice) claims.push(`Original Price (for showing a discount): ${input.originalPrice}`);
  if (input.offer.cod) claims.push('Cash on Delivery (COD) available');
  if (input.offer.freeShipping) claims.push('Free Shipping');
  if (input.offer.nationwideDelivery) claims.push('Nationwide Delivery');
  if (input.offer.limitedStock) claims.push('Limited Stock (user-confirmed, real)');
  if (input.offer.limitedTimeSale) claims.push('Limited-Time Sale (user-confirmed, real)');
  if (input.offer.discountPercent) claims.push(`${input.offer.discountPercent}% OFF`);
  if (input.offer.customOffer) claims.push(input.offer.customOffer);
  return claims.length ? claims.join('; ') : 'NONE — no offer, discount, guarantee, certification, or trust claim was provided for this request.';
}

// Analyzes the video ONCE (this is the expensive, image-heavy call) and
// returns a structured analysis. The AI must never fabricate facts — if a
// detail isn't visible or given, it should say so plainly rather than guess.
export async function analyzeProductVideo(frames: ImageInput[], input: VideoAdCopyInput): Promise<VideoAnalysis> {
  const system = `You are RPJ ECOM's senior direct-response ecommerce advertising strategist and Facebook Ads copywriter, specializing in Philippine ecommerce. You are analyzing ${frames.length} frames sampled evenly from beginning to end of a short product video, to build a structured product analysis before any ad copy is written.

Be conservative and honest: only state what you can actually see in the frames or what's explicitly given below. NEVER invent facts, health claims, certifications, guarantees, discounts, or promotions. If a detail is unknown, leave it blank rather than guessing.

Write "mainBenefits" and "features" the way an ordinary Filipino buyer talks, NOT like a supplier catalog or spec sheet — 3-10 words each, one idea per entry. Never use words like "ornate", "filigree", "aesthetic centerpiece", "meticulously crafted", "intricate detailing", "sophisticated", "exquisite", or "premium craftsmanship" unless truly unavoidable. Convert technical description into what the customer gets: "Ornate silver-tone filigree border with beads" becomes "Elegant silver & blue details"; "Golden metal bells that create soft chime sounds" becomes "Soft chime sound from golden bells". A buyer should understand the product within 3-5 seconds of reading these.

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "productName": "string",
  "productCategory": "string — short category label",
  "targetCustomer": "string — who this realistically is for, based on what's shown",
  "mainProblem": "string — the core problem/pain point this product addresses, if apparent from the video (empty string if not apparent)",
  "mainDesire": "string — the core desire/outcome the customer wants",
  "mainBenefits": ["string", ...] // up to 5, strongest benefits actually shown or demonstrated on screen, in plain customer language (see rules above)
  "features": ["string", ...] // up to 5, concrete features visible in the frames, in plain customer language (see rules above)
  "objections": ["string", ...] // up to 3, realistic buyer objections for this kind of product (price, trust, doubt)
  "visualHook": "string — the single most attention-grabbing visual moment or on-screen text seen in the frames",
  "offer": "string — ONLY price/discount/promo actually visible on-screen or given in the input below; empty string if none",
  "recommendedAngle": "string — exactly one of: ${AD_ANGLES.join(', ')} — the strongest angle for this specific product, or the Required Ad Angle given below if one was specified",
  "whyAngle": "string — ONE short sentence explaining why this angle is the strongest fit, referencing what's actually visible in the video",
  "tone": "string — the tone this video suggests (e.g. playful, premium, practical, homey)"
}`;

  const raw = await callClaude('video_analysis', system, buildVideoInputLines(input), 2048, frames);
  const parsed = extractJson(raw) as any;

  const productName = String(parsed?.productName ?? input.productName ?? '');
  if (!productName.trim()) {
    throw new AdCopyGeneratorError('Could not identify a product from this video — try a clearer video or fill in the product name manually.');
  }

  return {
    productName,
    productCategory: String(parsed?.productCategory ?? ''),
    targetCustomer: String(parsed?.targetCustomer ?? ''),
    mainProblem: String(parsed?.mainProblem ?? ''),
    mainDesire: String(parsed?.mainDesire ?? ''),
    mainBenefits: Array.isArray(parsed?.mainBenefits) ? parsed.mainBenefits.slice(0, 5).map((x: any) => String(x)) : [],
    features: Array.isArray(parsed?.features) ? parsed.features.slice(0, 5).map((x: any) => String(x)) : [],
    objections: Array.isArray(parsed?.objections) ? parsed.objections.slice(0, 3).map((x: any) => String(x)) : [],
    visualHook: String(parsed?.visualHook ?? ''),
    offer: String(parsed?.offer ?? ''),
    recommendedAngle: String(parsed?.recommendedAngle ?? (input.adAngle !== 'AUTO' ? input.adAngle : '')),
    whyAngle: String(parsed?.whyAngle ?? ''),
    tone: String(parsed?.tone ?? ''),
  };
}

const COPY_LENGTH_GUIDANCE: Record<typeof COPY_LENGTHS[number], string> = {
  Short: 'primaryText should run about 40-80 words — a tight hook, one core idea, one CTA. Do not pad to hit a count.',
  Standard: 'primaryText should run about 80-150 words — room for the hook, the core idea, a couple supporting points, and the CTA.',
  Long: 'primaryText should run about 150-250 words — enough room for a fuller story/demonstration, but every sentence must still earn its place. Never pad with filler to reach the length.',
};

// Cheap, text-only step — reuses the saved VideoAnalysis instead of the
// video frames, so "Regenerate"/rewrite actions never re-pay for vision.
export async function generateVideoAdCopy(analysis: VideoAnalysis, input: VideoAdCopyInput, extraInstruction?: string): Promise<VideoAdCopyResult> {
  const angleInstruction = input.adAngle !== 'AUTO'
    ? `All 3 versions must use the "${input.adAngle}" angle as the ONE big idea — vary the hook and execution across versions, not the underlying angle.`
    : `Each version must be built around exactly ONE big advertising idea, and the three ideas must be genuinely different from each other — not the same ad paraphrased three times. For example: Version 1 could be a Lifestyle/Decor angle, Version 2 a Gift angle, Version 3 a Curiosity/Product-Discovery angle. Pick whichever three angles are actually strongest for THIS product — don't force a template if a different combination fits better.`;

  const ctaGuidance = `CTA must match the Ad Objective given below, not default to "comment":
- "Sales / Conversion": a direct buying CTA — "Message us to order", "Order Now", or "Shop Now" — pick whichever fits how this specific ad is meant to convert (most Filipino ecommerce Messenger ads convert through a message, so default to a message-based CTA unless the objective clearly implies a shop link).
- "Engagement": a comment-based CTA, e.g. "Comment '[a short word]' and we'll send you the details" — used ONLY for this objective, not by default.
- "Retargeting": a direct, assume-familiarity closing CTA — "Order Now", "Claim Yours Today" — this audience already knows the product.
- "Product Awareness": a lower-commitment CTA — "Learn More", "See More", "Message us for details".
If no Ad Objective is given, default to a direct message-based CTA.`;

  const system = `You are RPJ ECOM's senior direct-response ecommerce advertising strategist specializing in Philippine Facebook and Meta advertising.

Your job is not to summarize products. Your job is to identify the strongest reason a customer would stop scrolling, care about the product, and take action. Analyze the product analysis, audience, and offer given below. Find the strongest advertising angle first. Then write concise, specific, and natural advertising copy around ONE big idea. Never fabricate product facts, offers, guarantees, certifications, or trust claims. Your copy should feel human-written, commercially sharp, mobile-friendly, and appropriate for Philippine ecommerce.

${VOICE_RULES}

${FB_ADS_COMPLIANCE_RULES}

HOOK ENGINE — do this before writing anything else:
Internally brainstorm at least 10 candidate hooks for this product, drawing from a mix of these categories: Visual Scroll Stopper, Curiosity, Desire, Problem, Pain, Product Demonstration, Price/Value, Gift, Convenience, Lifestyle, Emotional, Social Status, Before/After, Loss Aversion, Pattern Interrupt, Product Discovery. Silently score each for how likely it is to stop a Filipino Facebook scroller for THIS specific product, then keep only the strongest for the final ads — do not show your brainstorming, only the final selected hooks. Do NOT default to a generic question-opener ("Ilang beses mo na ba naisip...", "Looking for the perfect product?", "Are you tired of...?", "Introducing our amazing...") unless, after genuinely comparing it to the other categories, it really is the strongest option for this product — that should be rare, not the default.

ONE AD = ONE BIG IDEA:
${angleInstruction}
Do not cram every feature, benefit, and selling point into one ad — pick the single strongest idea for each version and build around it.

BENEFIT OVER FEATURE:
Convert relevant features into what the customer actually gets, in plain conversational language — never a supplier-catalog or spec-sheet tone. Avoid words like "ornate", "filigree", "aesthetic centerpiece", "meticulously crafted", "intricate detailing", "sophisticated", "exquisite", "premium craftsmanship" unless truly unavoidable. Example: "Golden bells with soft chime" → "Soft golden-bell chimes add a relaxing accent to your balcony, room or garden." Never invent a benefit not reasonably supported by the analysis below.

HUMAN, NATURAL VOICE:
Write like a real Filipino ecommerce marketer, not a translated template. Use natural Taglish when Taglish is selected — avoid stiff/awkward translation. Vary sentence structure; short punchy sentences are good. Avoid robotic phrasing, avoid excessive emojis, and avoid overusing "perfect pang gift", "something cute", "order yours now" unless genuinely the best fit here.

VERIFIED CLAIMS ONLY — this is critical: NEVER state a registered-business claim, permit, "100% original", "authentic", FDA approval, doctor recommendation, money-back guarantee, free shipping, COD, a discount percentage, limited stock, or warranty UNLESS it appears in the Verified Claims list below. If Verified Claims says NONE, write copy with zero such claims — sell on the product's actual demonstrated merits instead.

${ctaGuidance}

FLEXIBLE STRUCTURE — pick whichever fits the angle best, don't force one template every time. Examples: (Hook → Desire → Product → Benefit → Offer → CTA), (Hook → Product Demonstration → Why It Matters → Offer → CTA), (Hook → Problem → Product → Solution → CTA), (Hook → Gift Occasion → Product → Emotional Benefit → Offer → CTA).

LENGTH: ${COPY_LENGTH_GUIDANCE[input.copyLength]}

INTERNAL QUALITY BAR before finalizing each version, silently score 1-10 on: Hook Strength, Specificity, Customer Desire, Product Relevance, Clarity, Naturalness, Offer Clarity, CTA Strength, Scroll-Stopping Potential, Compliance Risk. Don't finalize a version with Hook Strength, Naturalness, or Product Relevance below 8 unless the product analysis genuinely doesn't give you enough to do better — rewrite it internally first. The loudest ad is not necessarily the strongest one: prioritize specificity, clarity, customer desire, and natural language over ALL CAPS, "!!!", 🔥🔥🔥, fake urgency, or unverified scarcity.

${extraInstruction ? `Rewrite instruction for this specific request: ${extraInstruction}` : ''}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "versions": [
    {
      "angle": "string — the ONE big idea/angle name used for this version",
      "hook": "string — the scroll-stopping opening line, from the hook engine above",
      "primaryText": "string — the full FB primary text/caption, structure chosen per FLEXIBLE STRUCTURE above, length per LENGTH above",
      "headline": "string — 3-10 words, not all-caps",
      "description": "string — short Meta Ads description line",
      "cta": "string — chosen per the CTA guidance above"
    }
  ], // exactly 3 entries, each a genuinely different big idea (or genuinely different execution of the same required angle)
  "extraHooks": [
    {"category": "Curiosity", "hook": "string"},
    {"category": "Problem", "hook": "string"},
    {"category": "Benefit", "hook": "string"},
    {"category": "Desire", "hook": "string"},
    {"category": "Sales", "hook": "string"},
    {"category": "UGC", "hook": "string"}
  ] // exactly 10 entries spanning these 6 categories (not necessarily even per category) — each genuinely different, not filler
}`;

  const analysisLines = [
    `Product Name: ${analysis.productName}`,
    analysis.productCategory ? `Category: ${analysis.productCategory}` : null,
    analysis.targetCustomer ? `Target Customer: ${analysis.targetCustomer}` : null,
    analysis.mainProblem ? `Main Problem: ${analysis.mainProblem}` : null,
    analysis.mainDesire ? `Main Desire: ${analysis.mainDesire}` : null,
    analysis.mainBenefits.length ? `Main Benefits:\n${analysis.mainBenefits.map(b => `- ${b}`).join('\n')}` : null,
    analysis.features.length ? `Features:\n${analysis.features.map(f => `- ${f}`).join('\n')}` : null,
    analysis.objections.length ? `Likely Objections:\n${analysis.objections.map(o => `- ${o}`).join('\n')}` : null,
    analysis.visualHook ? `Visual Hook Seen In Video: ${analysis.visualHook}` : null,
    analysis.tone ? `Tone: ${analysis.tone}` : null,
  ].filter(Boolean).join('\n');

  const user = `${analysisLines}\n\n${buildVideoInputLines(input)}\n\nVerified Claims (the ONLY offer/trust claims allowed in this copy): ${buildVerifiedClaims(input)}`;

  // Raised from 4096 — the hook-engine + internal quality-scoring
  // instructions above ask the model to reason more before finalizing
  // (Sonnet 5 runs adaptive thinking by default), so the old budget was
  // tight for that plus the actual 3-version + 10-hook JSON output.
  const raw = await callClaude('video_copy', system, user, 8192);
  const parsed = extractJson(raw) as any;

  const versions: VideoAdVersion[] = Array.isArray(parsed?.versions)
    ? parsed.versions.slice(0, 3).map((v: any) => ({
        angle: String(v?.angle ?? ''),
        hook: String(v?.hook ?? ''),
        primaryText: String(v?.primaryText ?? ''),
        headline: String(v?.headline ?? ''),
        description: String(v?.description ?? ''),
        cta: String(v?.cta ?? ''),
      }))
    : [];
  const extraHooks: VideoExtraHook[] = Array.isArray(parsed?.extraHooks)
    ? parsed.extraHooks.slice(0, 10).map((h: any) => ({
        category: (['Curiosity', 'Problem', 'Benefit', 'Desire', 'Sales', 'UGC'].includes(h?.category) ? h.category : 'Sales') as VideoExtraHook['category'],
        hook: String(h?.hook ?? ''),
      }))
    : [];

  if (!versions.length) {
    throw new AdCopyGeneratorError('AI did not return any ad copy versions.');
  }

  return { versions, extraHooks };
}
