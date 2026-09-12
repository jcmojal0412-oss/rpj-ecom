import { logAiUsage } from './db';

// Repeated production timeouts at max settings (5 variants + 10 follow-ups)
// persisted even after raising the per-call timeout to 60s — the prior
// 'claude-sonnet-4-6' id is an older, slower generation than what's
// current. Switched to the current Sonnet model.
const ANTHROPIC_MODEL = 'claude-sonnet-5';

export class AdCopyGeneratorError extends Error {}

export const TEXT_AD_OBJECTIVES = ['Messages', 'Comment Automation', 'Website Sales', 'Engagement'] as const;

// Shared Tone preset — one list, one behavior set, used identically by both
// the Image/Photo and Video generators (see TONE_CONFIGS below) so a given
// Tone produces consistent copywriting behavior regardless of which
// generator it's used from. Tone is independent of Ad Angle: Angle picks
// the selling idea, Tone picks how it's said.
export const TONE_OPTIONS = [
  'Friendly & Persuasive',
  'Minimalist',
  'Premium / Yayamanin',
  'Aggressive Sale',
  'Masa / Sulit',
  'UGC / Casual',
  'Emotional',
  'Curiosity / Scroll Stopper',
  'Trust / Straightforward',
  'Playful / Fun',
] as const;

export interface AdCopyInput {
  productName: string;
  description?: string;
  keyFeatures: string[];
  targetAudience?: string;
  language: 'Taglish' | 'English' | 'Filipino';
  tone: typeof TONE_OPTIONS[number];
  creativity: number; // 0–1, mapped to Claude's temperature
  variants: number; // 1–5, applies to adCreatives
  followUpCount: 0 | 5 | 10;
  adObjective: typeof TEXT_AD_OBJECTIVES[number];
  copyLength: typeof COPY_LENGTHS[number];
  hidePriceInAdCopy: boolean; // hides exact price from Hook/Headline/Caption to drive inquiries — price still appears in Main Flow/Messaging Template
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

export interface AdHookOption {
  hook: string;
  angle: string;
  isBestPick: boolean;
}

export interface AdCreativeVariant {
  hook: string;
  angle: string;
  headline: string;
  primaryText: string;
  messagingTemplate: string;
  quickReplies: string[];
}

export interface AdCopyResult {
  mainFlowReply: string;
  adCreatives: AdCreativeVariant[];
  hookOptions: AdHookOption[]; // 3 alternate hooks for adCreatives[0] only
  detectedAudience: string; // the audience actually used — given or inferred
  strongestSellingPoint: string; // one-sentence "why buy" summary for the AI Ad Strategy panel
  salesPrompt: string;
  afterSalesPrompt: string;
  followUpMessages: string[];
}

// ── Verified Claims (text/photo flow) ───────────────────────────────────────
// Deterministic, code-built — NOT AI-inferred. The three specific trust
// phrases below are exactly what the Legitimacy Info quick-add chips insert
// (see AdCopyGeneratorClient.tsx), so a substring match here reliably means
// the seller actually opted into that claim, not that the AI invented it.
export interface TextVerifiedClaims {
  cod: boolean;
  freeShipping: boolean;
  original: boolean;
  registeredBusiness: boolean;
  permit: boolean;
  moneyBackGuarantee: boolean;
  warranty: boolean;
  fdaApproved: boolean;
}

function buildTextVerifiedClaims(input: AdCopyInput): TextVerifiedClaims {
  const legit = (input.legitimacyInfo || '').toLowerCase();
  const payment = (input.paymentMethod || '').toLowerCase();
  const promo = (input.promoOffer || '').toLowerCase();
  return {
    cod: payment.includes('cod') || payment.includes('cash on delivery') || promo.includes('cod') || promo.includes('cash on delivery'),
    freeShipping: promo.includes('free shipping') || legit.includes('free shipping'),
    original: legit.includes('original and legit') || legit.includes('100% original') || legit.includes('authentic'),
    registeredBusiness: legit.includes('registered business') || legit.includes('business registered'),
    permit: legit.includes('permit'),
    moneyBackGuarantee: legit.includes('money-back guarantee') || legit.includes('money back guarantee'),
    warranty: legit.includes('warranty'),
    fdaApproved: legit.includes('fda'),
  };
}

function describeVerifiedClaims(c: TextVerifiedClaims): string {
  const on: string[] = [];
  if (c.cod) on.push('Cash on Delivery (COD)');
  if (c.freeShipping) on.push('Free Shipping');
  if (c.original) on.push('100% Original / Authentic');
  if (c.registeredBusiness) on.push('Registered Business');
  if (c.permit) on.push('Business Permit');
  if (c.moneyBackGuarantee) on.push('Money-Back Guarantee');
  if (c.warranty) on.push('Warranty');
  if (c.fdaApproved) on.push('FDA Approved');
  return on.length ? on.join(', ') : 'NONE — do not state ANY trust/legitimacy/guarantee claim (no "original", "legit", "registered", "permit", "guarantee", "warranty", "FDA", etc.).';
}

// Second line of defense on top of the prompt instruction — strips known
// unverified-claim phrases out of generated text if their guard is false,
// so a prompt-following slip doesn't reach the user. Broadened to catch
// standalone "legit"/"trusted seller" phrasing, not just "original and
// legit" — a seller-audit found these slipping through unstripped.
const CLAIM_STRIP_RULES: { active: (c: TextVerifiedClaims) => boolean; patterns: RegExp[] }[] = [
  { active: c => !c.original, patterns: [/100%\s*original[^.\n]*\.?/gi, /\boriginal\s*(and|at)\s*legit\b[^.\n]*\.?/gi, /\bauthentic\s*product\b[^.\n]*\.?/gi, /\b100%\s*legit\b[^.\n]*\.?/gi, /\btrusted\s*seller\b[^.\n]*\.?/gi] },
  { active: c => !c.moneyBackGuarantee, patterns: [/money[\s-]?back guarantee[^.\n]*\.?/gi] },
  { active: c => !c.registeredBusiness, patterns: [/registered business[^.\n]*\.?/gi] },
  { active: c => !c.permit, patterns: [/\bwith permit\b[^.\n]*\.?/gi, /\bbusiness permit\b[^.\n]*\.?/gi] },
  { active: c => !c.fdaApproved, patterns: [/fda[\s-]?approved[^.\n]*\.?/gi] },
  { active: c => !c.warranty, patterns: [/\bwarranty\b[^.\n]*\.?/gi] },
  { active: c => !c.freeShipping, patterns: [/free shipping[^.\n]*\.?/gi] },
  { active: c => !c.cod, patterns: [/\bcod\b[^.\n]*\.?/gi, /cash on delivery[^.\n]*\.?/gi] },
];

function stripUnverifiedClaims(text: string, claims: TextVerifiedClaims): string {
  if (!text) return text;
  let result = text;
  for (const { active, patterns } of CLAIM_STRIP_RULES) {
    if (!active(claims)) continue;
    for (const p of patterns) result = result.replace(p, '');
  }
  return result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[✅•\-•]\s*$/.test(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

// Tight, phrase-only variant of CLAIM_STRIP_RULES for SHORT fields (hooks,
// quick replies) — the sentence-consuming `[^.\n]*\.?` suffix above is
// designed for multi-sentence body copy; on a short one-line field with no
// trailing period it would greedily eat the rest of the line, potentially
// wiping the entire hook/reply instead of just the unverified phrase.
// Bare-word patterns (legit/authentic/permit/warranty with no surrounding
// phrase) risk false-positiving on benign Taglish usage that isn't a trust
// claim at all (e.g. "legit" as slang for "for real", "walang permit
// kailangan dito" denying a permit is needed) — narrowed to the actual
// claim-shaped phrasing instead of the bare word, except "warranty" which
// has no common non-claim usage in this context.
const SHORT_FIELD_CLAIM_PATTERNS: { active: (c: TextVerifiedClaims) => boolean; patterns: RegExp[] }[] = [
  { active: c => !c.original, patterns: [/100%\s*original\b/gi, /\boriginal\s*(and|at)\s*legit\b/gi, /\bauthentic\b/gi, /100%\s*legit\b/gi, /\blegit\s*(na)?\s*(seller|tindahan|shop|store|business)\b/gi, /\btrusted\s*seller\b/gi] },
  { active: c => !c.moneyBackGuarantee, patterns: [/money[\s-]?back guarantee\b/gi] },
  { active: c => !c.registeredBusiness, patterns: [/registered business\b/gi] },
  { active: c => !c.permit, patterns: [/\bwith permit\b/gi, /\bbusiness permit\b/gi] },
  { active: c => !c.fdaApproved, patterns: [/fda[\s-]?approved\b/gi] },
  { active: c => !c.warranty, patterns: [/\bwarranty\b/gi] },
  { active: c => !c.freeShipping, patterns: [/free shipping\b/gi] },
  { active: c => !c.cod, patterns: [/\bcod\b/gi, /cash on delivery\b/gi] },
];

// Only applies the whitespace/punctuation cleanup pass when a pattern
// actually matched — returning the untouched original otherwise. Without
// this, the cleanup (trimming a trailing period/comma) ran unconditionally,
// so finalizeQuickReply()'s `scrubbed === original` check misfired on any
// reply ending in ordinary punctuation even when no claim was stripped,
// discarding a perfectly valid reply for the generic fallback.
function scrubShortField(text: string, claims: TextVerifiedClaims): string {
  if (!text) return text;
  let result = text;
  let changed = false;
  for (const { active, patterns } of SHORT_FIELD_CLAIM_PATTERNS) {
    if (!active(claims)) continue;
    for (const p of patterns) {
      const next = result.replace(p, '');
      if (next !== result) changed = true;
      result = next;
    }
  }
  if (!changed) return text;
  return result.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '').trim();
}

// If a quick reply mentioned an unverified claim (e.g. "Paano mag-COD?" when
// COD was never confirmed), don't ship the scrubbed-but-broken fragment
// ("Paano mag-?") — replace the whole reply with a safe, generic fallback.
function finalizeQuickReply(raw: unknown, claims: TextVerifiedClaims): string {
  const original = String(raw ?? '').trim();
  const scrubbed = scrubShortField(original, claims);
  return scrubbed === original ? original : 'Paano umorder?';
}

// Code-level backstop for "Hide Price in Ad Copy" — only matches an actual
// currency-marked amount (₱, PHP, "pesos") or a per-month amount, never a
// bare number, so promo mechanics like "Buy 1 Take 1" or "2 pcs" are never
// touched. Two tiers, same rationale as the claim scrubbers above: short
// fields (headline, description, CTA) get a tight phrase-only removal;
// primaryText (multi-sentence body copy) gets the sentence-consuming
// version since a price mention is usually embedded in a full sentence and
// leaving a half-sentence behind would look broken. Compiled once at module
// scope rather than per call (this runs per field per ad variant per
// request).
const EXACT_PRICE_PATTERN_SOURCE = String.raw`(₱\s*[\d,]+(?:\.\d+)?|\bphp\s*[\d,]+(?:\.\d+)?\b|\b[\d,]+(?:\.\d+)?\s*pesos?\b|\b[\d,]+(?:\.\d+)?\s*(?:\/|per)\s*month\b)`;
const EXACT_PRICE_PATTERN_SHORT = new RegExp(EXACT_PRICE_PATTERN_SOURCE, 'gi');
const EXACT_PRICE_PATTERN_LONG = new RegExp(`[^.\\n]*${EXACT_PRICE_PATTERN_SOURCE}[^.\\n]*\\.?`, 'gi');

function stripExactPriceShort(text: string): string {
  if (!text) return text;
  return text.replace(EXACT_PRICE_PATTERN_SHORT, '').replace(/\s{2,}/g, ' ').replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '').trim();
}

function stripExactPriceLong(text: string): string {
  if (!text) return text;
  return text
    .replace(EXACT_PRICE_PATTERN_LONG, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[✅•\-•]\s*$/.test(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// EXACT_PRICE_PATTERN_SOURCE only matches a CURRENCY-marked amount (₱/PHP/
// pesos), deliberately never a bare number — a generic bare-number strip
// would corrupt promo mechanics like "Buy 1 Take 1" or "2 pcs". But the
// app's own Price/Selling Price field is stored as a bare number (e.g.
// "499"), so if the model echoes that literal value with no currency
// marker ("499 na lang"), the currency-only patterns above miss it. This
// closes that gap safely: it only strips the SPECIFIC price value the
// seller actually entered (word-boundary exact match), never an arbitrary
// number, so unrelated digits (quantities, promo counts) are untouched.
function stripLiteralPriceShort(text: string, priceValues: (string | undefined)[]): string {
  let result = text;
  for (const v of priceValues) {
    const trimmed = v?.trim();
    if (!trimmed || !/\d/.test(trimmed)) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'g'), '');
  }
  if (result === text) return text;
  return result.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '').trim();
}

function stripLiteralPriceLong(text: string, priceValues: (string | undefined)[]): string {
  let result = text;
  for (const v of priceValues) {
    const trimmed = v?.trim();
    if (!trimmed || !/\d/.test(trimmed)) continue;
    result = result.replace(new RegExp(`[^.\\n]*\\b${escapeRegExp(trimmed)}\\b[^.\\n]*\\.?`, 'g'), '');
  }
  if (result === text) return text;
  return result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[✅•\-•]\s*$/.test(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

// Applies the "Hide Price in Ad Copy" backstop when enabled — a no-op
// otherwise. 'short' = headline/description/CTA (tight phrase removal),
// 'long' = primaryText/body (sentence-level removal). literalPriceValues
// (the seller's actual price/sellingPrice/originalPrice input) additionally
// catches the model echoing that exact number with no currency marker,
// which the currency-only patterns above can't see.
function applyPriceVisibility(
  text: string,
  hidePriceInAdCopy: boolean,
  tier: 'short' | 'long',
  literalPriceValues: (string | undefined)[] = [],
): string {
  if (!hidePriceInAdCopy || !text) return text;
  const currencyStripped = tier === 'short' ? stripExactPriceShort(text) : stripExactPriceLong(text);
  if (!literalPriceValues.length) return currencyStripped;
  return tier === 'short'
    ? stripLiteralPriceShort(currencyStripped, literalPriceValues)
    : stripLiteralPriceLong(currencyStripped, literalPriceValues);
}

// A hook is one short line, so unlike stripUnverifiedClaims (which removes
// whole sentences/bullets), removing a price substring here would just leave
// a broken fragment — not safe to auto-fix. This only detects and logs, so a
// prompt-instruction slip is visible instead of silently shipping to the UI.
// Deliberately does NOT flag "Buy 1 Take 1"/promo-mechanic mentions — those
// are allowed in hooks even with price hiding on; only an actual peso
// amount or percentage discount counts as "price" here.
const PRICE_IN_HOOK_PATTERN = /₱\s*\d|(?<!\d)\d+\s*%\s*(off|discount)/i;

function warnIfHookHasPrice(hook: string, context: string): void {
  if (hook && PRICE_IN_HOOK_PATTERN.test(hook)) {
    console.warn(`[ad-copy-generator] hook still contains price/offer language (${context}): ${hook}`);
  }
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
- Weave in the offer and shop trust signals given — never invent numbers or claims. Whether the exact price itself belongs in the public ad copy is governed by the PRICE VISIBILITY rule elsewhere in this prompt — don't assume it always belongs there.`;

// Shared by both generators — governs whether the exact selling price may
// appear in the public-facing ad copy (hook/headline/body/description) or
// must stay hidden to drive curiosity/inquiries. The hook NEVER gets price
// regardless of this setting (that's an older, unconditional rule) — this
// only changes headline/body/description, which previously always included
// price. Verified promo mechanics (Buy 1 Take 1, bundle, free gift, etc.)
// stay mentionable either way, since they aren't the exact price.
function buildPriceVisibilityGuidance(hidePriceInAdCopy: boolean, promoText: string): string {
  if (!hidePriceInAdCopy) {
    return 'PRICE VISIBILITY: Hide Price in Ad Copy is OFF for this ad — you may state the real price/offer naturally in the headline and body copy as usual (the hook itself still never carries price, per the hook rules above).';
  }
  const promoLine = promoText.trim()
    ? `Verified promo mechanics may still be mentioned naturally since they were actually given ("${promoText.trim()}") — e.g. "BUY 1 TAKE 1 AVAILABLE 🎁🔥", "MAY BUNDLE PROMO PA. ✨" — but never combine a promo mechanic with the exact peso amount ("BUY 1 TAKE 1 FOR ₱999" is NOT allowed; "BUY 1 TAKE 1 AVAILABLE 🎁🔥" is).`
    : 'No promo mechanic was given, so do not invent or imply one (no "may promo pa" if none was confirmed) — build curiosity from the product/benefit itself instead.';
  return `PRICE VISIBILITY — HIDE PRICE IN AD COPY IS ON: the goal of this ad is to create curiosity and drive inquiries, not to close the sale on price alone. Do NOT state the exact price anywhere in the headline, primaryText/body, description, or CTA — no "₱599", "PHP 599", "599 pesos", "only ₱999", a monthly price, or an exact installment amount. This includes the CTA itself — never write "Order now for ₱599," an inquiry CTA should never contain a number. ${promoLine} Build natural curiosity instead: describe the benefit/promo teaser, then let the CTA invite a message to learn the price. The exact price may (and should) still appear in mainFlowReply and any messaging/chat template, since those only reach someone who already engaged — that's the intended funnel: Ad (curiosity) → Message (price revealed).`;
}

// Shared hook-writing style — the single rule set both the Image/Photo and
// Video generators use for every hook they produce (3 Main Hook Options,
// Extra Hooks, regenerated hooks, and the AI Best Pick). Keeping this in one
// place is what keeps the two generators' hooks from drifting apart in
// style, since both prompt builders splice this same block into their HOOK
// ENGINE section.
const HOOK_STYLE_RULES = `HOOK WRITING STYLE — applies to EVERY hook you write (the 3 main hook options, extra hooks, and any regenerated hook). Technically-correct-but-flat hooks are not acceptable — a hook that just restates a fact ("Ito ang box na pwedeng maging start ng forever niyo", "Hawak mo lang, alam mo nang may nakatagong ring sa loob", "Order lang, deliver na sa harap niyo, walang advance kailangan") must be rewritten, not shipped.

SIMPLE, EVERYDAY TAGLISH (when Language = Taglish): write the way an ordinary Filipino sounds on Facebook, not the way a textbook, brochure, or news article sounds. Avoid deep/formal/literary Filipino words — if a simpler Taglish or English word exists, use it. Blacklist words/phrasing to avoid when a simpler alternative exists: "ipagpaliban", "tahanan", "handog", "kagamitan", "makabuluhan", "kaakit-akit", "kapaki-pakinabang", "natatangi", "pagmamay-ari", "pakinabang", "maituturing", "mainam", "maaliwalas", "kaaya-aya", "taglay", "hatid", "makapagbigay", "maging simula ng forever niyo", "nakatagong singsing/ring sa loob", "maihatid sa inyong tahanan". Preferred everyday vocabulary: ganda, sulit, easy, upgrade, pang-gift, pang-bahay, pang-mommy, pang-araw-araw, ang sosyal, ang linis tingnan, ang convenient, ang cute, ang useful, ang handy, ready, instant, perfect, swak, worth it, nakaka-excite, kilig, game changer. Mix in natural English words/phrases the way real Filipino online sellers do ("GAME CHANGER", "INSTANT UPGRADE", "SO WORTH IT", "WAIT TIL YOU SEE THIS", "DELIVERED STRAIGHT TO YOU", "PERFECT PANG-PROPOSE") instead of forcing an awkward Filipino translation.

HARD REQUIREMENT — REAL EMOTION: before finalizing any hook, silently ask "Anong mararamdaman ng customer sa hook na ito?" (what would the customer actually feel reading this?). If the honest answer is "nothing specific," rewrite it. Every hook must clearly trigger at least one of: excitement, curiosity, desire, kilig, surprise, relief, urgency, FOMO, aspiration, gifting emotion, convenience-relief, or delight. Match the emotion to the angle, don't just describe the angle:
- Gift/Emotional angle → lead with kilig, meaning, surprise, the recipient's reaction, a special moment — not a dry description of what's inside the box.
- Feature/Product Demonstration angle → lead with surprise, curiosity, "wait for it," a visual reveal — not a spec-style statement of what the feature is.
- Convenience angle → lead with relief, ease, "ready na," less hassle — not logistics-documentation phrasing ("may COD", "may payment options available").

DESCRIPTIVE IS NOT THE SAME AS EMOTIONAL: a hook that describes what the product looks like or is made of (e.g. naming its materials/components as the whole sentence) is a spec description wearing a hook's clothing — it belongs in the body copy, not the opening line. Test: does the hook lead with a FEELING, or does it lead with a physical description that happens to end on a feeling word? If it's the latter, rewrite it to lead with the feeling itself, stated simply.

HARD REQUIREMENT — EMOJIS: every hook must contain at least 1 emoji, ideally 1-2, chosen to match the actual emotion and product/angle — never random or unrelated ones (this is enforced in code as a backstop, but you must include the right emoji yourself, not rely on the backstop). Pick from whichever fits, e.g.: Romantic/Engagement/Gift 💍 ❤️ 🥹 ✨ 🎁 💛, Curiosity 👀 😱 ✨, Gadget 📱 🔥 ✨, Home 🏠 😍 ✨, Christmas 🎄 ✨ ❤️, Beauty ✨ 😍 💖, general delight/desire 😍 ✨ 🔥 ⭐, urgency 🔥 😱, convenience 🚚 ⭐. Do not overload with more than 2.

SHORT AND PUNCHY: 4-12 words is the sweet spot, 15 words is the hard ceiling where practical. One strong thought only — no semicolons, no stacked clauses, no explaining. The hook is the emotional punch; the explanation belongs in the body copy, not the hook.

DIFFERENT ANGLES, EACH EMOTIONALLY ALIVE: when writing multiple hooks (the 3 main options, or the extra hooks), each angle must carry its own distinct emotional flavor, not just a different topic stated flatly — e.g. a Curiosity hook should feel like a tease, a Gift hook should feel warm, a Desire hook should feel aspirational. Extra Hooks follow this exact same bar as the 3 main hooks — never a lower-quality fallback list.

THE SOCIAL-MEDIA GUT-CHECK: before finalizing any hook, silently ask "would a real Filipino ecommerce seller actually post this on Facebook or TikTok?" It should feel like a Facebook ad, a TikTok caption, or a UGC opener — never a product brochure, formal Filipino, a supplier listing, a chatbot sentence, or a school essay. If it reads that way, rewrite it simpler and warmer.

TONE MATCHES ENERGY: the TONE CONFIGURATION block elsewhere in this prompt is the authority on hook energy, word choice, and emoji count for the selected Tone — follow it exactly for the hook, don't fall back to a generic energy level.

INTERNAL HOOK SCORING (do not show this reasoning, only the final hooks): before choosing your final 3 (or 10, for extra hooks), internally brainstorm at least 9 candidate hooks across different angles, then silently score each 1-10 on: Emotional Impact, Scroll-Stop Potential, Natural Taglish, Product Relevance, Angle Fit, Simplicity, Emoji Fit, Curiosity/Desire, and Ad Objective Fit. Only keep candidates scoring at least 8/10 on Emotional Impact, Natural Taglish, AND Product Relevance — if your best candidate for an angle scores below 8 on any of those three, rewrite it before including it, don't ship it anyway.

These style rules layer on top of (never override) the no-price-in-hook, no-financial-shaming, no-overclaim, verified-claims, and scarcity-gating rules elsewhere in this prompt.`;

// Shared with both generators (like HOOK_STYLE_RULES above) — angle
// discipline and anti-"poetic AI" guidance for the headline and body copy,
// not just the hook. Written after seller feedback that generated ads were
// mixing unrelated angles mid-ad and using brochure/greeting-card English
// ("A Touch of Golden Fortune at Home", "brings positive energy into your
// space") instead of sounding like a real Facebook seller.
const NATURAL_COPY_RULES = `NATURAL, NON-POETIC COPY — applies to the headline and body copy (the hook has its own style rules above):

ONE AD = ONE ANGLE, KEPT CONSISTENT THROUGHOUT: once an angle is chosen for an ad, every field (hook, headline, body) must stay inside that angle's lane end to end. Do not drift into a different angle mid-ad — e.g. a Gift/Emotional ad suddenly mentioning home décor positioning, scarcity, financing, premium/luxury framing, or trust/permit claims — unless that detail genuinely supports the chosen angle. Example for Gift/Emotional: hook = the gift feeling, headline = gift-positioned, body = why it's a meaningful gift + the relevant feature(s) + where/how the recipient enjoys it + the verified offer + one CTA. Nothing else gets mixed in.

HEADLINES MUST SOUND LIKE ECOMMERCE, NOT POETRY: headlines are normally 3-8 words and should sound like something a real Shopee/Facebook seller would type, not a greeting card or brochure line. Avoid poetic/formal English like "A Touch of Golden Fortune at Home" — prefer plain, specific phrasing like "Lucky Vibes for Your Home" or "Meaningful Gift Idea." A more elevated/aspirational register is only earned when Tone is Premium / Yayamanin — never by default.

NO POETIC AI FILLER ANYWHERE IN THE AD: avoid lines like "a touch of fortune," "brings positive energy into your space," or a Filipino equivalent like "parang tahimik na paalala na may magandang bagay na paparating" — these read as AI-written, not like a real seller talking to a customer. Write simple, specific, relatable, sales-focused language instead — every sentence should sound like it could appear in an actual FB Marketplace post.

FINAL GUT CHECK before finalizing any ad: does this sound like a real Facebook seller wrote it, or like a brochure, greeting card, or AI-generated advertisement? If the latter, rewrite it — don't ship copy you wouldn't believe came from a real seller.`;

// Shared by both generators — governs the Caption/Primary Text's internal
// structure and how product features get folded into it. Written after
// feedback that captions either omitted features entirely or dumped every
// feature verbatim; the fix is a curated, scannable bullet block sized to
// the chosen angle, not a spec-sheet dump.
const CAPTION_STRUCTURE_RULES = `CAPTION / PRIMARY TEXT STRUCTURE:
Hook → one short emotional/desire paragraph (do NOT repeat or paraphrase the hook here — say something new) → 3-4 feature/benefit bullets → verified promo teaser (if any) → CTA. Not every ad needs every piece in this exact order, but the feature bullets are not optional for a normal ecommerce ad — skip them only if the content genuinely has no distinct features to list (e.g. a pure service/consultation ad).

INCLUDE 3-4 CURATED FEATURES, NOT A FULL DUMP: never list every feature/key-feature given — select only the 3-4 STRONGEST ones that support the chosen angle. Gift/Emotional angle → features that support gifting, design, meaning, or recipient appeal. Lifestyle angle → features that support appearance, experience, use case. Feature/Product Demonstration angle → the most visually or functionally interesting features. The caption should feel curated, like a seller picked the best points, not copied from a spec sheet.

FEATURE BULLETS MUST BE SHORT AND SCANNABLE: format as short bullet lines, 4-10 words each, one relevant emoji per bullet (never the same emoji repeated, never unrelated to that specific feature). Convert technical/catalog phrasing into plain customer language — "Golden metal construction with hanging bell components" becomes "✨ Golden finish na sosyal tingnan" / "🔔 Soft chime kapag nahahanginan," never copied word-for-word from the input features.

EMOJI BALANCE: for a Standard-length caption, target roughly 4-7 relevant emojis total as a baseline — the exact total is then governed by the TONE CONFIGURATION above (e.g. Minimalist runs leaner at 0-3, Aggressive Sale runs hotter at 5-8). Never force an emoji after every sentence and never spam (no "🔥🔥🔥" stacks, no repeating the same emoji multiple times in one caption) — the goal is emotion, scanability, and native Facebook-feed feel, not visual clutter. If a draft caption feels too plain for its tone's range, add relevant emojis; if it's overloaded past the range, cut down.

EMOJI PLACEMENT across the caption: Hook 1-2, intro/body paragraph 0-1 (only if it lands naturally, never forced), feature bullets 1 per bullet, promo/offer teaser 0-1, CTA 0-1. Every emoji must be relevant to the specific line it's attached to and match the product/category — e.g. gadgets 📱💻🎧🔥👀, appliances ❄️🏠⚡🛒, gift 🎁❤️💛✨, home décor 🏡✨😍, beauty ✨💖😍, Christmas 🎄✨🎁, service/repair 🔧📱💻📍 — never a random emoji that doesn't fit the product or angle.

PROMO TEASER: if a verified promo mechanic exists (Buy 1 Take 1, bundle, free gift, etc.), tease it briefly after the feature bullets — e.g. "May BUY 1 TAKE 1 promo pa. 🎁🔥" — never reveal the exact price here if price is hidden (see PRICE VISIBILITY elsewhere in this prompt). If no promo was given, skip this line entirely rather than inventing one.`;

// One shared Tone configuration for BOTH generators — Tone controls HOW the
// copy is said (word choice, sentence length, emotional intensity, emoji
// count/style, hook/primaryText/headline/CTA feel); Ad Angle stays a
// completely separate control for WHAT selling idea is used. Deliberately
// detailed per-tone (not just the tone name dropped into the prompt) so
// each preset produces genuinely different copywriting behavior, not the
// same copy with a label attached.
const TONE_CONFIGS: Record<typeof TONE_OPTIONS[number], string> = {
  'Friendly & Persuasive': 'Natural and approachable, conversational Taglish. Moderate emotional energy — warm but not over-the-top. Word choice: everyday, friendly words, never stiff or corporate. Sentence length: short-to-medium, easy to read. Emoji count for the hook: 1-2. Total emojis across the whole caption: 3-6. Primary Text: builds interest conversationally, then persuades gently, never pushy. Headline: warm and inviting. CTA: a friendly invitation to act, not a hard push. This is the safe general-purpose default.',
  'Minimalist': 'Short, clean, direct — cut every unnecessary word. Word choice: plain, no filler adjectives, no hype words. Sentence length: very short, fragments are fine. Emoji count for the hook: 0-1, only if it adds real value. Total emojis across the whole caption: 0-3. Primary Text: a few tight lines, zero padding. Headline: 3-6 words, clean. CTA: short and plain ("Order now.", "Shop now."). Avoid excessive hype entirely.',
  'Premium / Yayamanin': 'Aspirational and elegant but still easy to understand — never stiff or corporate. Word choice: "sosyal", "premium-looking", "elegant", "classy", "expensive-looking" — never deep/formal Filipino, never an exaggerated quality claim ("best quality", "world-class") that isn\'t verified. Sentence length: medium, polished, unhurried. Emotional intensity: quietly confident, aspirational, never loud. Emoji count for the hook: 0-2, elegant choices (✨💎) over loud ones (🔥😱). Total emojis across the whole caption: 2-4, elegant choices throughout. Primary Text: paints a lifestyle/status feeling. Headline: elegant and aspirational. CTA: composed, e.g. "Reserve yours today" — only if reservation/scarcity is actually verified, otherwise a composed inquiry CTA.',
  'Aggressive Sale': 'High-energy ecommerce sales tone — urgency, a strong CTA, offer emphasis, FOMO ONLY when verified by the Verified Claims/offer flags (never invent "Limited Stock", "Today Only", "Last Chance"). Word choice: punchy, action-driven. Sentence length: short and punchy. Emotional intensity: high energy (loud tone, not loud formatting — body copy still follows the ALL CAPS/exclamation-point compliance rules elsewhere in this prompt). Emoji count for the hook: 1-3, higher-energy choices (🔥😱🛒💥), never spammed. Total emojis across the whole caption: 5-8 maximum. Primary Text: drives hard toward the offer/CTA using only verified urgency. Headline: bold, benefit + urgency. CTA: strong and direct, e.g. "Order Now!", "Grab Yours Today!"',
  'Masa / Sulit': 'Very simple, everyday Taglish, relatable to the average Filipino shopper. Word choice: "sulit", "panalo", "ang mura", "worth it", "okay na okay" — practical and value-focused, never formal. Sentence length: short, plain, spoken-language rhythm. Emotional intensity: warm, relatable, down-to-earth excitement. Emoji count for the hook: 1-2, simple and warm (💛🔥). Total emojis across the whole caption: 4-7. Primary Text: emphasizes value, practicality, everyday usefulness. Headline: value-forward. CTA: simple and direct, e.g. "Order na, sulit na sulit!"',
  'UGC / Casual': 'Sounds like a real customer, creator, or TikTok/Facebook user talking — not a seller. Word choice: casual filler phrases ("wait...", "grabe", "honestly", "ang ganda pala nito", "di ko inexpect..."). Sentence length: short, conversational, can trail off naturally. Emotional intensity: genuine surprise/reaction energy, never scripted-sounding. Emoji count for the hook: 1-2, natural reaction emojis (😍👀). Total emojis across the whole caption: 4-7. Primary Text: reads like a spontaneous reaction, not an ad script. Headline: casual, reaction-style. CTA: soft and peer-to-peer, e.g. "Check niyo na rin, sobrang worth it."',
  'Emotional': 'Leans into kilig, family, gifting, care, special moments, nostalgia, desire, surprise. Word choice: warm and heartfelt, sincere, never cheesy or over-dramatic. Sentence length: medium, lets the feeling breathe. Emotional intensity: warm and touching but restrained — do not overdo the drama. Emoji count for the hook: 1-3, emotional choices (❤️🥹🎁💛✨). Total emojis across the whole caption: 4-7. Primary Text: centers the feeling/relationship/moment. Headline: heartfelt. CTA: a warm invitation tied to the emotion.',
  'Curiosity / Scroll Stopper': 'Prioritizes information gaps and pattern interrupts that make people want to keep reading/watching. Word choice: teasing, intriguing, open-loop phrasing ("wait til you see this", "akala mo normal lang..."). Sentence length: short, punchy, often trails into a reveal. Emotional intensity: high curiosity/surprise — never fake clickbait the body copy doesn\'t pay off. Emoji count for the hook: 1-2 (👀😱✨). Total emojis across the whole caption: 3-6. Primary Text: opens a gap, then genuinely resolves it with the real product benefit. Headline: intriguing, not fully explained. CTA: "See it for yourself — message us."',
  'Trust / Straightforward': 'Clear, specific, low-hype — for customers who want direct information, not a sales pitch. Word choice: plain and factual, no exaggeration. Sentence length: clear and complete, no dramatic fragments. Emotional intensity: calm and confident, not hyped. Emoji count for the hook: 0-1, minimal. Total emojis across the whole caption: 1-4. Primary Text: plainly states what the product is, what it does, the main benefit, and the verified offer. Headline: descriptive, not clickbait. CTA: direct and low-pressure, e.g. "Message us for details."',
  'Playful / Fun': 'Energetic, witty, light-hearted. Word choice: playful Taglish, light humor, natural wordplay — never childish unless the product itself is for kids/toys. Sentence length: short-to-medium, bouncy rhythm. Emotional intensity: upbeat and fun, energetic without being aggressive. Emoji count for the hook: 1-2, fun/playful choices. Total emojis across the whole caption: 5-8. Primary Text: light and entertaining while still landing the benefit and CTA. Headline: witty. CTA: fun and inviting.',
};

function buildToneGuidance(tone: typeof TONE_OPTIONS[number]): string {
  return `TONE CONFIGURATION — Tone controls HOW you write (word choice, sentence length, emotional intensity, emoji usage, hook/primaryText/headline/CTA feel); it is completely independent from Ad Angle, which controls WHAT selling idea is used. Do not just drop the tone name into the copy — write with genuinely different behavior per tone, as specified:
Selected Tone: ${tone}
${TONE_CONFIGS[tone]}`;
}

// Broad Unicode ranges covering the emoji this prompt asks the model to use
// (emoticons, dingbats/hearts, transport, supplemental symbols, misc
// symbols & arrows) — used as a code-level backstop, not the primary
// mechanism (the prompt above is): if a model slip ships a hook with zero
// emoji, we deterministically append one instead of silently displaying a
// flat hook, mirroring this file's existing pattern of never trusting a
// "hard requirement" to the prompt alone (see stripUnverifiedClaims).
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

// Keyword → emoji fallback, checked against the hook's angle/category name.
// Order matters (first match wins); falls back to a neutral ✨ if nothing
// matches, so a hook is never displayed with zero emoji.
const FALLBACK_EMOJI_RULES: [RegExp, string][] = [
  [/gift|regalo|surpris/i, '🎁💛'],
  [/romantic|engagement|propose|wedding/i, '💍❤️'],
  [/curiosity|reveal|discover/i, '👀✨'],
  [/gadget|tech|phone|device/i, '📱✨'],
  [/home|decor|bahay/i, '🏠✨'],
  [/christmas|pasko|holiday/i, '🎄✨'],
  [/beauty|skin|glow/i, '✨💖'],
  [/urgency|scarcity|loss/i, '🔥😱'],
  [/convenience|delivery|ugc/i, '🚚⭐'],
];

function pickFallbackEmoji(angleOrCategory: string): string {
  for (const [pattern, emoji] of FALLBACK_EMOJI_RULES) {
    if (pattern.test(angleOrCategory)) return emoji;
  }
  return '✨';
}

// Single shared finish-line for every hook this file generates (Image/Photo
// AND Video, main hook options, extra hooks, and regenerated hooks): scrubs
// any unverified trust/offer claim that slipped into the hook itself
// (hooks were previously excluded from claim stripping entirely), applies
// the mandatory ALL CAPS formatting, warns (doesn't silently fix) if a price
// slipped through, and deterministically appends a fallback emoji if the
// model shipped a hook with none — so the "every hook has emoji" hard
// requirement holds even when a prompt instruction is missed, without
// paying for an extra regeneration round-trip.
function finalizeHook(raw: unknown, angleOrCategory: string, context: string, claims: TextVerifiedClaims): string {
  let hook = scrubShortField(String(raw ?? '').trim(), claims);
  warnIfHookHasPrice(hook, context);
  if (hook && !EMOJI_PATTERN.test(hook)) {
    hook = `${hook} ${pickFallbackEmoji(angleOrCategory)}`;
    console.warn(`[ad-copy-generator] hook had no emoji, appended fallback (${context}): ${hook}`);
  }
  return hook.toUpperCase();
}

// The prompt tells the model "the ad must be built around whichever hook you
// flag isBestPick" but nothing enforced that the model actually kept those
// two things in sync — a model slip could mark hookOptions[1] best while
// building the ad around hookOptions[0]'s hook, showing an "AI BEST PICK"
// badge on a card that isn't the "Active" one. Deterministically resync
// isBestPick to whichever option matches the hook actually used, so the UI
// badge and the active-hook indicator can never disagree.
function normalizeHookOptions(hookOptions: AdHookOption[], activeHook: string): AdHookOption[] {
  if (!hookOptions.length) return hookOptions;
  const matched = hookOptions.some(h => h.hook === activeHook);
  return hookOptions.map((h, i) => ({ ...h, isBestPick: matched ? h.hook === activeHook : i === 0 }));
}

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

const TEXT_COPY_LENGTH_GUIDANCE: Record<typeof COPY_LENGTHS[number], string> = {
  Short: 'primaryText should run about 40-80 words.',
  Standard: 'primaryText should run about 70-130 words — hook, one short product/desire paragraph, 2-4 relevant benefits, the verified offer, and one CTA. Do not turn this into a long product essay.',
  Long: 'primaryText should run about 150-250 words — every sentence must still earn its place, never pad with filler.',
};

function buildTextCtaGuidance(hidePriceInAdCopy: boolean): string {
  const inquiryNote = hidePriceInAdCopy
    ? `\nPrice is hidden from this ad's copy, so for "Messages"/"Comment Automation" objectives prefer an inquiry-driving CTA instead of an order-driving one — e.g. "Message us para malaman ang promo price. 💬", "PM us for today's promo details. 🔥", "Message us para ma-send namin ang details.", "Type 'PROMO' para malaman ang current offer." Avoid a bare "Message us to order" here — there's nothing to order on yet, only something to ask about. Keep it natural, never fake urgency.`
    : '';
  return `CTA must match the Ad Objective given below:
- "Messages": "Message us to order", "Send us a message for ordering details."
- "Comment Automation": a comment-keyword CTA, e.g. 'Comment "LUCKY" and we'll send you the details.'
- "Website Sales": "Tap Shop Now to order."
- "Engagement": an engagement-appropriate CTA suited to the product, not a hard sell.
Do not default to "Comment ___" for every objective — only use it when the objective is Comment Automation.${inquiryNote}`;
}

function buildAdContentPrompt(
  input: AdCopyInput,
  forcedHook?: { hook: string; angle: string },
  previousHooks?: string[],
  // Callers that only want ONE ad creative back (both "Use This Hook" AND
  // "Generate 3 New Hooks" in regenerateAdCreativeHook) must pass this
  // explicitly true — deriving it from `!!forcedHook` alone was a bug: with
  // forcedHook omitted ("Generate 3 New Hooks"), this fell through to the
  // full `input.variants`-entry adCreatives schema while the caller still
  // only budgeted 4096 tokens and only ever read adCreatives[0].
  singleAdOnly: boolean = !!forcedHook,
): { system: string; user: string } {
  const verifiedClaims = buildTextVerifiedClaims(input);

  const system = `You are RPJ ECOM's senior direct-response ecommerce advertising strategist and Facebook/Meta Ads copywriter specializing in Philippine ecommerce.

Your job is NOT to simply summarize a product. Your job is to identify the strongest reason a customer would stop scrolling, care about the product, understand its value, and take action. Analyze the product information, key features, target audience, price, and offer given below. Find the strongest advertising angle FIRST. Then create specific, natural, persuasive, mobile-friendly advertising copy around ONE BIG IDEA. Write like a skilled Filipino ecommerce marketer, not a corporate copywriter or generic AI assistant. Never fabricate product information, offers, guarantees, certifications, discounts, or trust claims.

${VOICE_RULES}
${input.productImageBase64 ? `- A photo of the actual product is attached — ground the copy in what it really looks like (color, form factor, material, size cues) instead of generic claims.` : ''}

${buildToneGuidance(input.tone)}

${FB_ADS_COMPLIANCE_RULES}
(Exception: the "hook" field below is deliberately written in full caps by the application after you return it — write it as a normal short sentence, do not add your own caps or extra punctuation for this.)

${HIGH_CONVERSION_TECHNIQUES}

${forcedHook ? `USE THIS EXACT HOOK AND ANGLE (already chosen by the user — do not change it): HOOK: "${forcedHook.hook}" / ANGLE: ${forcedHook.angle}. Rewrite primaryText, headline, messagingTemplate, and quickReplies so the ENTIRE ad coheres around this specific angle — e.g. Gift → focus on recipient appeal/occasions/meaning; Feature/Product Demonstration → focus on what happens when used/visual experience/functional benefit; Loss Aversion → what the customer overlooks/misses by not having it; Scarcity → the verified availability/deadline only. Do not just swap the opening line and leave the rest generic. The price/offer still belongs in primaryText/headline as usual — this rule only governs the hook line itself, which stays as given above.

${HOOK_STYLE_RULES}` : `
HOOK ENGINE — do this before writing anything:
Identify the likely buyer and the strongest customer desire/problem/buying motivation. Choose exactly 3 STRATEGICALLY DIFFERENT angles from this list — never 3 variations of the same angle:
- Loss Aversion (what the customer may miss/regret/overlook by ignoring it — never fake fear)
- Feature/Product Demonstration (turn the single most visually interesting or functional feature into a scroll-stopping observation, not a spec statement)
- Scarcity/Urgency (ONLY if the Promo/Offer or Additional Instructions below explicitly states limited stock, a sale end date, or limited release — otherwise exclude this angle entirely; never invent "unti na lang stock", "last chance", "hanggang today lang")
- Gift/Emotional, Curiosity (create an information gap), Visual Scroll Stopper, Pain/Problem (genuine, not manufactured insecurity), Problem-Solution, Desire/Lifestyle, Convenience, Benefit (not a restated feature), Pattern Interrupt, UGC/Natural (sounds like a real customer/creator, not a formal ad), Symbolic/Meaning (conservative, never presents superstition as fact)

${HOOK_STYLE_RULES}

For the 3 chosen angles, draft candidate hooks per the style rules above and silently score them on scroll-stop potential, product relevance, clarity, specificity, customer desire, curiosity, naturalness, originality, emotional impact, natural Taglish/Filipino feel, Facebook feed fit, emoji fit, simplicity, and compliance risk. Reject any candidate that is too formal, too deep/literary in Filipino, too long, or emotionally flat — even if it is technically correct. Do not show this reasoning — only the final selected hooks.
HOOK CONTENT RULES: the hook is for ATTENTION and MOTIVATION only — it must NEVER contain the exact selling price, a discount amount, a peso/₱ amount, a shipping fee, or a percentage discount. A verified promo mechanic (e.g. "Buy 1 Take 1 available") MAY appear in the hook per the PRICE VISIBILITY rule elsewhere in this prompt — it is the exact price/amount that's always excluded from the hook, not the promo mechanic itself. The exact price always belongs later, in primaryText/headline/the Offer section — never in the hook itself.
Avoid defaulting to question hooks ("Looking for...?", "Have you ever...?", "Pagod ka na ba...?", "Gusto mo ba...?", "Ilang beses mo na ba naisip...?") — use them only when genuinely the strongest option. Avoid generic hooks ("Introducing our amazing...", "The perfect product for you...", "Something cute pero useful...", "Order yours today...") as openers.
Return exactly 3 hookOptions, one per chosen angle (genuinely different directions, not paraphrases — e.g. NOT "ganda nito sa balcony" / "ganda nito sa bahay" / "ganda nito pang-regalo", which are the same angle three times). Mark exactly one as isBestPick based on product fit, target audience, and scroll-stop/conversion potential, using the AI Best Pick criteria above — do NOT default to whichever angle happens to be Offer/Value/hard-sell just because it mentions the deal loudest. adCreatives[0] must be built around the isBestPick hook/angle, with the price/offer introduced afterward in primaryText/headline as normal.`}

DO NOT TURN KEY FEATURES INTO THE AD VERBATIM. Key Features are input data, not the advertisement. For each relevant feature, ask "why should the customer care?" and convert it into a benefit, desire, use case, visual appeal, or emotional value — e.g. "Big Lucky Eye design" becomes "Instant statement piece kahit simple lang ang corner ng bahay," not "Big Lucky Eye design na eye-catching." Never invent a benefit not reasonably supported by the input. Avoid supplier-catalog/spec-sheet vocabulary ("ornate", "filigree", "meticulously crafted", "sophisticated", "exquisite") unless truly unavoidable.

${NATURAL_COPY_RULES}

${CAPTION_STRUCTURE_RULES}

SYMBOLIC / SUPERSTITION CLAIMS: for lucky charms, feng shui items, evil-eye products, and similar symbolic products, never say or imply the product actually brings luck, fortune, protection, or wealth as a factual result. Instead of "Pang-swerte at proteksyon" or "brings positive energy into your space," prefer conservative, lightly-worded phrasing like "Lucky vibes," "Inspired by traditional lucky coin symbolism," "Traditionally associated with good fortune," or "Meaningful symbolic design." Keep it light and conservative — never promise the product will actually bring luck, protection, wealth, or a health outcome.

VERIFIED CLAIMS ONLY — critical: the ONLY trust/offer claims you may state are: ${describeVerifiedClaims(verifiedClaims)}. Never state a claim not on this list (no "100% original", "legit", "registered business", "with permit", "money-back guarantee", "warranty", "FDA approved", "doctor recommended") even if it seems like a safe assumption for this kind of product. This applies to EVERY field you return, including quickReplies and mainFlowReply — not just primaryText/headline. If COD was not confirmed above, do not write a quickReply like "Paano mag-COD?" — use a payment-neutral phrasing like "Paano umorder?" instead.

${buildPriceVisibilityGuidance(input.hidePriceInAdCopy, input.promoOffer)}

${buildTextCtaGuidance(input.hidePriceInAdCopy)}

${input.targetAudience ? '' : 'Target Audience was left blank — infer a likely audience internally from the product (e.g. "Home décor and gift buyers, likely women 25-55") and write for that audience, but do not state a fabricated demographic as if the seller confirmed it.'}

MAIN FLOW vs FACEBOOK AD — these must sound different, not identical: mainFlowReply should sound like a helpful, friendly, conversational online sales assistant (BotCake chat tone). adCreatives content (headline/primaryText/messagingTemplate) should sound like real performance advertising — scroll-stopping, direct, specific, persuasive, emotionally relevant, mobile-friendly. Do not make the Facebook ad content sound like a chatbot reply.

LENGTH: ${TEXT_COPY_LENGTH_GUIDANCE[input.copyLength]}

QUALITY GATE: before finalizing, check whether primaryText is basically just Product Name + Key Features + Price restated in sentence form. If so, rewrite it — the final ad must add an advertising angle and a reason to care, not just summarize the input fields.
${previousHooks?.length ? `\nAlready-used hooks this session (generate genuinely different ones, not close variants of these): ${previousHooks.map(h => `"${h}"`).join(', ')}` : ''}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  ${singleAdOnly ? '' : `"detectedAudience": "string — the target audience this copy was actually written for, whether given by the user or inferred (e.g. 'Home décor and gift buyers, likely women 25-55')",
  "strongestSellingPoint": "string — ONE short sentence naming the single most compelling reason a customer would buy this, based on the actual input given — not a restated feature list",`}
  "mainFlowReply": "string — the FIRST auto-reply BotCake sends the instant someone comments or messages the ad. Greets them, restates the offer/price/promo, lists key features as short bullet lines, ends with a clear CTA to reply/order. Chat tone, not ad tone.",
  ${forcedHook ? '' : `"hookOptions": [
    {"hook": "string — normal case, will be uppercased by the app", "angle": "string — the angle name", "isBestPick": true},
    {"hook": "string", "angle": "string", "isBestPick": false},
    {"hook": "string", "angle": "string", "isBestPick": false}
  ], // exactly 3, genuinely different angles`}
  "adCreatives": [
    {
      "hook": "string — normal case, same as the active hook for this variant (hookOptions[isBestPick] for adCreatives[0])",
      "angle": "string — the angle name for this variant",
      "headline": "string — 3-10 words, not all-caps, from the strongest of several internally-considered headline angles (benefit/desire/offer/curiosity/lifestyle/gift/value) — not just Product Name + Price",
      "primaryText": "string — structure per CAPTION / PRIMARY TEXT STRUCTURE above (hook → short paragraph → 3-4 feature bullets → promo teaser if any → CTA), length per LENGTH above, ad tone not chat tone",
      "messagingTemplate": "string — the message shown when someone clicks 'Send Message' on the ad, restating the offer and inviting them to ask questions",
      "quickReplies": ["string", "string", "string"] // 3 short quick-reply button labels a customer might tap
    }
  ] ${singleAdOnly ? '// exactly 1 entry' : `// exactly ${input.variants} entries${input.variants > 1 ? `, each with a genuinely different big idea/angle (not the same ad reworded)` : ''}`}
}`;

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

// Shared request-body → AdCopyInput parsing, used by both /generate and
// /regenerate-hook so the two routes can't drift on validation/defaults.
export function parseAdCopyInputBody(body: any): AdCopyInput {
  const {
    product_name, description, key_features, target_audience,
    language, tone, creativity, variants, follow_up_count,
    ad_objective, copy_length, hide_price_in_ad_copy,
    shop_name, price, promo_offer, delivery_time, payment_method, legitimacy_info,
    additional_instructions, product_image_base64, product_image_media_type,
  } = body;

  const validLanguages = ['Taglish', 'English', 'Filipino'];
  const followUpAllowed = [0, 5, 10];

  return {
    productName: product_name?.trim() || '',
    description: description?.trim() || undefined,
    keyFeatures: Array.isArray(key_features) ? key_features.filter(Boolean).slice(0, 5) : [],
    targetAudience: target_audience?.trim() || undefined,
    language: validLanguages.includes(language) ? language : 'Taglish',
    tone: (TONE_OPTIONS as readonly string[]).includes(tone) ? tone : 'Friendly & Persuasive',
    creativity: typeof creativity === 'number' ? creativity : 0.7,
    variants: Math.min(5, Math.max(1, Number(variants) || 1)),
    followUpCount: (followUpAllowed.includes(Number(follow_up_count)) ? Number(follow_up_count) : 0) as 0 | 5 | 10,
    adObjective: (TEXT_AD_OBJECTIVES as readonly string[]).includes(ad_objective) ? ad_objective : 'Messages',
    copyLength: (COPY_LENGTHS as readonly string[]).includes(copy_length) ? copy_length : 'Standard',
    hidePriceInAdCopy: hide_price_in_ad_copy === false ? false : true,
    shopName: shop_name?.trim() || '',
    price: price?.trim() || '',
    promoOffer: promo_offer?.trim() || '',
    deliveryTime: delivery_time?.trim() || undefined,
    paymentMethod: payment_method?.trim() || undefined,
    legitimacyInfo: legitimacy_info?.trim() || undefined,
    additionalInstructions: additional_instructions?.trim() || undefined,
    productImageBase64: typeof product_image_base64 === 'string' ? product_image_base64 : undefined,
    productImageMediaType: typeof product_image_media_type === 'string' ? product_image_media_type : undefined,
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
    callClaude('text_ad_content', adPrompt.system, adPrompt.user, 8192, productImage),
    callClaude('text_bot_content', botPrompt.system, botPrompt.user, 4096),
  ]);

  const adParsed = extractJson(adRaw) as any;
  const botParsed = extractJson(botRaw) as any;
  const verifiedClaims = buildTextVerifiedClaims(input);

  const adCreatives: AdCreativeVariant[] = Array.isArray(adParsed?.adCreatives)
    ? adParsed.adCreatives.map((v: any) => {
        const angle = String(v?.angle ?? '');
        return {
          hook: finalizeHook(v?.hook, angle, 'adCreatives', verifiedClaims),
          angle,
          headline: applyPriceVisibility(stripUnverifiedClaims(String(v?.headline ?? ''), verifiedClaims), input.hidePriceInAdCopy, 'short', [input.price]),
          primaryText: applyPriceVisibility(stripUnverifiedClaims(String(v?.primaryText ?? ''), verifiedClaims), input.hidePriceInAdCopy, 'long', [input.price]),
          messagingTemplate: stripUnverifiedClaims(String(v?.messagingTemplate ?? ''), verifiedClaims),
          quickReplies: Array.isArray(v?.quickReplies) ? v.quickReplies.map((q: any) => finalizeQuickReply(q, verifiedClaims)) : [],
        };
      })
    : [];
  const hookOptions: AdHookOption[] = Array.isArray(adParsed?.hookOptions)
    ? adParsed.hookOptions.slice(0, 3).map((h: any) => {
        const angle = String(h?.angle ?? '');
        return { hook: finalizeHook(h?.hook, angle, 'hookOptions', verifiedClaims), angle, isBestPick: !!h?.isBestPick };
      })
    : [];
  const followUpMessages: string[] = Array.isArray(botParsed?.followUpMessages)
    ? botParsed.followUpMessages.map((m: any) => String(m))
    : [];

  const mainFlowReply = stripUnverifiedClaims(String(adParsed?.mainFlowReply ?? ''), verifiedClaims);
  const salesPrompt = String(botParsed?.salesPrompt ?? '');
  const afterSalesPrompt = String(botParsed?.afterSalesPrompt ?? '');
  const detectedAudience = String(adParsed?.detectedAudience ?? input.targetAudience ?? '');
  const strongestSellingPoint = String(adParsed?.strongestSellingPoint ?? '');

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

  return {
    mainFlowReply,
    adCreatives,
    hookOptions: normalizeHookOptions(hookOptions, adCreatives[0]?.hook ?? ''),
    detectedAudience,
    strongestSellingPoint,
    salesPrompt,
    afterSalesPrompt,
    followUpMessages,
  };
}

// Lightweight, text-only regeneration of JUST the first ad creative — used
// by "Use This Hook" (forcedHook set) and "Generate 3 New Hooks" (forcedHook
// omitted). Never touches mainFlowReply/salesPrompt/afterSalesPrompt/
// followUpMessages and never re-sends the product image, so it's much
// cheaper than a full generateAdCopy() call.
export async function regenerateAdCreativeHook(
  input: AdCopyInput,
  forcedHook?: { hook: string; angle: string },
  previousHooks?: string[]
): Promise<{ adCreative: AdCreativeVariant; hookOptions: AdHookOption[] }> {
  const prompt = buildAdContentPrompt(input, forcedHook, previousHooks, true);
  const raw = await callClaude('text_ad_hook_regen', prompt.system, prompt.user, 4096);
  const parsed = extractJson(raw) as any;
  const verifiedClaims = buildTextVerifiedClaims(input);

  const first = Array.isArray(parsed?.adCreatives) ? parsed.adCreatives[0] : null;
  if (!first) {
    throw new AdCopyGeneratorError('AI did not return an ad creative.');
  }

  const regenAngle = String(first?.angle ?? forcedHook?.angle ?? '');
  const adCreative: AdCreativeVariant = {
    hook: finalizeHook(first?.hook ?? forcedHook?.hook, regenAngle, 'regenerateAdCreativeHook', verifiedClaims),
    angle: regenAngle,
    headline: applyPriceVisibility(stripUnverifiedClaims(String(first?.headline ?? ''), verifiedClaims), input.hidePriceInAdCopy, 'short', [input.price]),
    primaryText: applyPriceVisibility(stripUnverifiedClaims(String(first?.primaryText ?? ''), verifiedClaims), input.hidePriceInAdCopy, 'long', [input.price]),
    messagingTemplate: stripUnverifiedClaims(String(first?.messagingTemplate ?? ''), verifiedClaims),
    quickReplies: Array.isArray(first?.quickReplies) ? first.quickReplies.map((q: any) => finalizeQuickReply(q, verifiedClaims)) : [],
  };

  const hookOptions: AdHookOption[] = Array.isArray(parsed?.hookOptions)
    ? parsed.hookOptions.slice(0, 3).map((h: any) => {
        const angle = String(h?.angle ?? '');
        return { hook: finalizeHook(h?.hook, angle, 'regenerateAdCreativeHook.hookOptions', verifiedClaims), angle, isBestPick: !!h?.isBestPick };
      })
    : [];

  return { adCreative, hookOptions: normalizeHookOptions(hookOptions, adCreative.hook) };
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
  tone: typeof TONE_OPTIONS[number];
  adObjective?: string;
  adAngle: 'AUTO' | typeof AD_ANGLES[number];
  copyLength: typeof COPY_LENGTHS[number];
  hidePriceInAdCopy: boolean; // hides exact price from Hook/Headline/Caption/Description to drive inquiries
  offer: VideoOfferInput;
}

export const CONTENT_TYPES = ['SINGLE PRODUCT', 'MULTIPLE PRODUCTS', 'STORE PROMOTION', 'SALE / CAMPAIGN', 'SERVICE', 'EVENT'] as const;

export interface VideoAnalysis {
  contentType: typeof CONTENT_TYPES[number];
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
  financingInfo: string;
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
  hookOptions: AdHookOption[]; // 3 alternate hooks for versions[0] only
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
    `Tone: ${input.tone}`,
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

// Code-level backstop for video copy, mirroring buildTextVerifiedClaims —
// video's VideoOfferInput only ever carries cod/freeShipping as trust-style
// claims (no legitimacy/warranty/FDA/permit free-text field like text mode
// has), so every other TextVerifiedClaims flag is always false here: if the
// model states "100% original" or "registered business" in video copy
// anyway, stripUnverifiedClaims removes it unconditionally.
function buildVideoVerifiedClaims(input: VideoAdCopyInput): TextVerifiedClaims {
  return {
    cod: !!input.offer.cod,
    freeShipping: !!input.offer.freeShipping,
    original: false,
    registeredBusiness: false,
    permit: false,
    moneyBackGuarantee: false,
    warranty: false,
    fdaApproved: false,
  };
}

// Video-specific deterministic backstop for the two prompt-only rules added
// alongside content-type detection: financing conservatism (financingInfo
// being non-empty must never license "0% interest"/"zero down"/"instant or
// guaranteed approval" unless that exact phrase was actually seen on-screen)
// and the general no-overclaims rule. Same rationale as CLAIM_STRIP_RULES —
// don't just ask the model nicely when a regex can catch a slip.
function stripVideoOverclaimsAndFinancing(text: string, financingInfo: string): string {
  if (!text) return text;
  const info = (financingInfo || '').toLowerCase();
  let result = text;
  const financingPatterns: [RegExp, string][] = [
    [/0%\s*interest[^.\n]*\.?/gi, '0% interest'],
    [/zero[\s-]?down(\s*payment)?[^.\n]*\.?/gi, 'zero down'],
    [/instant approval[^.\n]*\.?/gi, 'instant approval'],
    [/guaranteed approval[^.\n]*\.?/gi, 'guaranteed approval'],
  ];
  for (const [pattern, mustBeConfirmedBy] of financingPatterns) {
    if (!info.includes(mustBeConfirmedBy)) {
      result = result.replace(pattern, '');
    }
  }
  const overclaimPatterns = [
    /\bandito lahat\b[^.\n]*\.?/gi,
    /\bpinakamura\b[^.\n]*\.?/gi,
    /\bbest price\b[^.\n]*\.?/gi,
    /\blowest price\b[^.\n]*\.?/gi,
  ];
  for (const pattern of overclaimPatterns) {
    result = result.replace(pattern, '');
  }
  return result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[✅•\-•]\s*$/.test(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function finalizeVideoBodyText(
  text: string,
  claims: TextVerifiedClaims,
  financingInfo: string,
  hidePriceInAdCopy: boolean,
  tier: 'short' | 'long',
  literalPriceValues: (string | undefined)[] = [],
): string {
  return applyPriceVisibility(stripVideoOverclaimsAndFinancing(stripUnverifiedClaims(text, claims), financingInfo), hidePriceInAdCopy, tier, literalPriceValues);
}

// Analyzes the video ONCE (this is the expensive, image-heavy call) and
// returns a structured analysis. The AI must never fabricate facts — if a
// detail isn't visible or given, it should say so plainly rather than guess.
export async function analyzeProductVideo(frames: ImageInput[], input: VideoAdCopyInput): Promise<VideoAnalysis> {
  const system = `You are RPJ ECOM's senior direct-response ecommerce advertising strategist and Facebook Ads copywriter, specializing in Philippine ecommerce. You are analyzing ${frames.length} frames sampled evenly from beginning to end of a short product video, to build a structured product analysis before any ad copy is written.

Be conservative and honest: only state what you can actually see in the frames or what's explicitly given below. NEVER invent facts, health claims, certifications, guarantees, discounts, or promotions. If a detail is unknown, leave it blank rather than guessing.

Write "mainBenefits" and "features" the way an ordinary Filipino buyer talks, NOT like a supplier catalog or spec sheet — 3-10 words each, one idea per entry. Never use words like "ornate", "filigree", "aesthetic centerpiece", "meticulously crafted", "intricate detailing", "sophisticated", "exquisite", or "premium craftsmanship" unless truly unavoidable. Convert technical description into what the customer gets: "Ornate silver-tone filigree border with beads" becomes "Elegant silver & blue details"; "Golden metal bells that create soft chime sounds" becomes "Soft chime sound from golden bells". A buyer should understand the product within 3-5 seconds of reading these.

FIRST, detect what kind of content this actually is — do not label everything "SINGLE PRODUCT". Choose exactly one: ${CONTENT_TYPES.join(', ')}. A video showing one item is SINGLE PRODUCT; a video showing several different items for sale is MULTIPLE PRODUCTS; a video about a shop/warehouse/sale event covering many categories is STORE PROMOTION or SALE / CAMPAIGN (pick whichever fits — CAMPAIGN if it's a named sale event); a video about a repair/consultation/subscription-type offering is SERVICE; a video about a specific dated happening is EVENT. This changes what "productName" means — for a store/sale/campaign, use the store or campaign name instead of a single item name, and "productCategory" becomes the store's category mix (e.g. "gadgets, appliances, accessories").

FINANCING: only fill "financingInfo" with financing/payment-plan details that are ACTUALLY visible on-screen (e.g. a named provider logo or text like "Financing available via Skyro"). Never infer "0% interest", "zero down payment", "instant approval", or "guaranteed approval" unless that exact phrase is visibly on-screen — "financing available" alone does NOT imply any of those. Leave financingInfo empty if nothing concrete is visible.

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "contentType": "string — exactly one of: ${CONTENT_TYPES.join(', ')}",
  "productName": "string — product name, OR the store/campaign name if contentType is STORE PROMOTION / SALE / CAMPAIGN",
  "productCategory": "string — short category label, or the store's category mix for a store/campaign",
  "targetCustomer": "string — who this realistically is for, based on what's shown",
  "mainProblem": "string — the core problem/pain point this addresses, if apparent from the video (empty string if not apparent)",
  "mainDesire": "string — the core desire/outcome the customer wants",
  "mainBenefits": ["string", ...] // up to 5, strongest benefits actually shown or demonstrated on screen, in plain customer language (see rules above)
  "features": ["string", ...] // up to 5, concrete features/categories/selection visible in the frames, in plain customer language (see rules above)
  "objections": ["string", ...] // up to 3, realistic buyer objections (price, trust, doubt)
  "visualHook": "string — the single most attention-grabbing visual moment or on-screen text seen in the frames",
  "offer": "string — ONLY price/discount/promo actually visible on-screen or given in the input below; empty string if none",
  "financingInfo": "string — ONLY concrete financing/payment-plan details visibly on-screen (see FINANCING rule above); empty string if none",
  "recommendedAngle": "string — exactly one of: ${AD_ANGLES.join(', ')} — the strongest angle given the content type, or the Required Ad Angle given below if one was specified",
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
    contentType: (CONTENT_TYPES as readonly string[]).includes(parsed?.contentType) ? parsed.contentType : 'SINGLE PRODUCT',
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
    financingInfo: String(parsed?.financingInfo ?? ''),
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

// Content-type-aware advertising focus — what the ad should actually be
// selling, since a store/sale video and a single-product video need
// different strategies even though they share the same prompt.
const CONTENT_TYPE_STRATEGY: Record<typeof CONTENT_TYPES[number], string> = {
  'SINGLE PRODUCT': 'Sell the one product shown — build around its strongest single benefit or use case. Do not talk about "our store" or a wide selection.',
  'MULTIPLE PRODUCTS': 'Sell the RANGE/VARIETY shown, not one item as if it were the whole video. Lead with what ties the products together (e.g. a category, a use case, a price range) rather than picking one item and ignoring the rest.',
  'STORE PROMOTION': 'Sell the STORE/SHOP itself — trust, selection, convenience of buying from this specific seller. Use the "Store Advantage" angle (wide selection, one-stop shop, trusted seller) as a first-class option alongside the usual angles. Do not invent a single "product" that was never named.',
  'SALE / CAMPAIGN': 'Sell the SALE EVENT — what makes this specific sale worth acting on now (real discount, real limited timeframe, real selection). Scarcity/urgency language is only allowed per the SCARCITY rule below — a sale name alone does not license fake urgency.',
  SERVICE: 'Sell trust and problem-solving, not physical product features — services are bought on confidence, not specs. Do NOT use the physical-product caption structure for this ad; follow the SERVICE AD FRAMEWORK below instead.',
  EVENT: 'Sell the EXPERIENCE of attending/participating — what happens there and why it is worth showing up, anchored to the actual date/details given.',
};

// Only spliced in when Content Type = SERVICE — services (repair centers,
// consultations, etc.) need a different caption shape and a much more
// conservative claims posture than a physical-product ad: never promise a
// repair/outcome will succeed, never invent scarcity ("limited slots") or
// credentials, and the CTA has to remove friction by telling the customer
// exactly what to send instead of a bare "message us."
const SERVICE_AD_RULES = `THIS IS A SERVICE AD (Content Type = SERVICE) — do not force the physical-product caption structure onto this ad. Services are sold on trust and problem-solving, not product features. Follow this framework instead:

SERVICE CAPTION FRAMEWORK: Hook → the customer's actual concern/problem → reassurance or what happens when they reach out → what services/concerns are actually supported → verified advantage/offer (only if confirmed) → location (only if factually given) → a clear next action → CTA. Do not force the generic (Hook → Desire → Product → Benefit → Offer → CTA) shape onto this ad.

DO NOT OVERPROMISE THE SERVICE: never say "Kaya namin ayusin/gawin kahit ano," "kahit anong sira/problema kaya namin," "Guaranteed maayos/resolved," or "Sure repair/fix" unless explicitly verified in the input. Prefer scoped, honest phrasing instead — e.g. "We accept selected [the specific units/concerns actually shown or given] repair/service concerns," or naturally in Taglish "Pwede mong ipa-check sa amin ang [units/concerns] mo." Never guarantee every case can be resolved.

NO INVENTED SCARCITY: never generate "LIMITED SLOTS," "LAST SLOT," "BOOK NOW BEFORE SLOTS RUN OUT," or similar unless Limited Stock or Limited-Time Sale was explicitly confirmed in the offer below. If not confirmed, omit scarcity/urgency language entirely — sell on trust and clarity instead.

SERVICE TRUST COPY: address what customers actually worry about, when relevant to what's shown — what might be wrong with their unit/situation, whether they can trust the provider, roughly what to expect cost-wise, what happens before service starts, and where the service is located. Never invent certifications, years of experience, "authorized" status, warranty, a guaranteed outcome, or original parts unless verified in the input.

BETTER SERVICE CTA: never end on a bare "Message us now" with no direction. Tell the customer exactly what to send or do next — e.g. "I-message mo sa amin ang [unit/situation] + issue para ma-check namin," or "Send us your [item] model and problem para ma-assess muna namin." The CTA should remove friction by naming the exact next step, not just inviting contact.

SERVICE CAPTION READABILITY: if Copy Length is Short, target about 60-100 words specifically for this service ad (enough room for the concern + process + supported services + CTA) rather than the tighter general Short range. Never write one large paragraph — use 1-2 sentence paragraphs, optionally with 2-4 short bullet points listing supported services/benefits. Use about 2-5 relevant emojis spread across the whole caption, never overloaded.

SERVICE HOOK STYLE: the hook still needs real emotion (per the hook style rules above) but grounded in the customer's actual situation/concern, not a generic product hook. Prefer emojis that fit a service/repair context (📱 💻 🔧 🛠️ 📍 ✨) over unrelated emotional emojis — avoid 😅 unless the specific hook genuinely calls for it.

LOCATION HONESTY: never say "MALAPIT LANG" or otherwise imply proximity to the specific viewer — that isn't knowable. If a real location is given, state it factually instead, e.g. "MAY GADGET SERVICE CENTER SA MANDALUYONG. 📍🔧".

NATURAL SERVICE TAGLISH: avoid stiff/awkward terms like "pag-pafix," "maayos namin lahat," or "serbisyong maaasahan" when more natural language exists — prefer "magpa-repair," "ipa-check," "unit," "issue," "service center," "repair," "technician."`;

// Cheap, text-only step — reuses the saved VideoAnalysis instead of the
// video frames, so "Regenerate"/rewrite actions never re-pay for vision.
// forcedHook/previousHooks mirror the text-mode buildAdContentPrompt pattern:
// when forcedHook is set this becomes a single-ad rewrite around that exact
// hook/angle (used by the lightweight regenerateVideoAdCreativeHook below);
// otherwise it's a normal 3-version + hookOptions + extraHooks generation.
function buildVideoAdContentPrompt(
  analysis: VideoAnalysis,
  input: VideoAdCopyInput,
  forcedHook?: { hook: string; angle: string },
  previousHooks?: string[],
  extraInstruction?: string,
  // Callers that only want ONE version back (both "Use This Hook" AND
  // "Generate 3 New Hooks" in regenerateVideoAdCreativeHook) must pass this
  // explicitly true — deriving it from `!!forcedHook` alone was a bug: with
  // forcedHook omitted ("Generate 3 New Hooks"), this used to fall through
  // to the full 3-versions + 10-extraHooks schema while the caller still
  // only budgeted 4096 tokens and only ever read versions[0], risking
  // truncated/invalid JSON on a supposedly cheap action.
  singleAdOnly: boolean = !!forcedHook,
): { system: string; user: string } {

  const angleInstruction = forcedHook
    ? ''
    : input.adAngle !== 'AUTO'
      ? `All 3 versions must use the "${input.adAngle}" angle as the ONE big idea — vary the hook and execution across versions, not the underlying angle.`
      : `Each version must be built around exactly ONE big advertising idea, and the three ideas must be genuinely different from each other — not the same ad paraphrased three times. Pick whichever three angles are actually strongest for THIS content — don't force a template if a different combination fits better.`;

  const ctaGuidance = `CTA must match the Ad Objective given below, not default to "comment":
- "Sales / Conversion": a direct buying CTA — "Message us to order", "Order Now", or "Shop Now" — pick whichever fits how this specific ad is meant to convert (most Filipino ecommerce Messenger ads convert through a message, so default to a message-based CTA unless the objective clearly implies a shop link).${input.hidePriceInAdCopy ? ' Since price is hidden from this ad, prefer an inquiry-driving version instead — e.g. "Message us para malaman ang promo price. 💬", "PM us for today\'s promo details. 🔥" — there\'s nothing to order on yet, only something to ask about.' : ''}
- "Engagement": a comment-based CTA, e.g. "Comment '[a short word]' and we'll send you the details" — used ONLY for this objective, not by default.
- "Retargeting": a direct, assume-familiarity closing CTA — "Order Now", "Claim Yours Today" — this audience already knows the product.
- "Product Awareness": a lower-commitment CTA — "Learn More", "See More", "Message us for details".
If no Ad Objective is given, default to a direct message-based CTA.`;

  const scarcityAllowed = !!(input.offer.limitedStock || input.offer.limitedTimeSale);

  const financingLine = analysis.financingInfo
    ? `Financing detail actually visible in the video: "${analysis.financingInfo}" — you may mention ONLY this exact detail, worded naturally. Do NOT add, imply, or embellish with "0% interest", "zero down payment", "instant approval", or "guaranteed approval" — none of those were confirmed, even though financing itself is available.`
    : `No financing detail was visible in the video — do not mention financing, installment, down payment, or approval terms at all.`;

  const hookEngine = forcedHook
    ? `USE THIS EXACT HOOK AND ANGLE (already chosen by the user — do not change it): HOOK: "${forcedHook.hook}" / ANGLE: ${forcedHook.angle}. Rewrite primaryText, headline, description, and cta so the ENTIRE ad coheres around this specific angle — do not just swap the opening line and leave the rest generic. The price/offer still belongs in primaryText/headline as usual — this rule only governs the hook line itself, which stays as given above.

${HOOK_STYLE_RULES}`
    : `HOOK ENGINE — do this before writing anything else:
Identify the likely buyer and the strongest motivation for THIS content type. Choose exactly 3 STRATEGICALLY DIFFERENT angles — never 3 variations of the same angle — from a mix of: Visual Scroll Stopper, Curiosity, Desire, Problem, Pain, Product Demonstration, Price/Value, Gift, Convenience, Lifestyle, Emotional, Social Status, Before/After, Loss Aversion, Pattern Interrupt, Product Discovery, Store Advantage (wide selection/trusted seller — only for STORE PROMOTION/SALE content types)${analysis.financingInfo ? ', Financing (only using the exact financing detail given below, never embellished)' : ''}.

${HOOK_STYLE_RULES}

Silently score each candidate for how likely it is to stop a Filipino Facebook scroller for THIS specific content, weighing emotional impact, natural Taglish/Filipino feel, Facebook feed fit, emoji fit, and simplicity alongside the usual scroll-stop/relevance/clarity criteria — reject anything too formal, too deep/literary in Filipino, too long, or emotionally flat even if it's technically correct — then keep only the 3 strongest. Do not show your brainstorming, only the final selected hooks. Do NOT default to a generic question-opener ("Ilang beses mo na ba naisip...", "Looking for the perfect product?", "Are you tired of...?") unless it is genuinely the strongest option — that should be rare, not the default.
HOOK CONTENT RULES: the hook is for ATTENTION and MOTIVATION only — it must NEVER contain the exact selling price, a discount amount, a peso/₱ amount, a shipping fee, or a percentage discount. A verified promo mechanic (e.g. "Buy 1 Take 1 available") MAY appear in the hook per the PRICE VISIBILITY rule elsewhere in this prompt — it is the exact price/amount that's always excluded from the hook, not the promo mechanic itself. The exact price always belongs later, in primaryText/headline — never in the hook itself.
NEVER write a hook (or any copy) that assumes or questions the buyer's financial situation — banned style: "Kulang sa cash ka ba?", "Wala ka pang budget?", "Hirap ka na bang mag-ipon?". This is financial shaming and is never acceptable, financing angle or not.
Return exactly 3 hookOptions, one per chosen angle (genuinely different directions, not paraphrases). Mark exactly one as isBestPick based on genuine fit and scroll-stop/conversion potential, using the criteria above — do NOT default to whichever angle happens to be financing, price, or hard-sell just because it's the loudest. versions[0] must be built around the isBestPick hook/angle.`;

  const system = `You are RPJ ECOM's senior direct-response ecommerce advertising strategist specializing in Philippine Facebook and Meta advertising.

Your job is not to summarize what's in the video. Your job is to identify the strongest reason a customer would stop scrolling, care, and take action. Analyze the content analysis, audience, and offer given below. Find the strongest advertising angle first. Then write concise, specific, and natural advertising copy around ONE big idea. Never fabricate facts, offers, guarantees, certifications, or trust claims. Your copy should feel human-written, commercially sharp, mobile-friendly, and appropriate for Philippine ecommerce.

${VOICE_RULES}

${buildToneGuidance(input.tone)}

${FB_ADS_COMPLIANCE_RULES}
(Exception: the "hook" field below is deliberately written in full caps by the application after you return it — write it as a normal short sentence, do not add your own caps or extra punctuation for this.)

CONTENT TYPE: ${analysis.contentType}. ${CONTENT_TYPE_STRATEGY[analysis.contentType]}

${analysis.contentType === 'SERVICE' ? SERVICE_AD_RULES : ''}

${hookEngine}

${singleAdOnly ? '' : `ONE AD = ONE BIG IDEA:\n${angleInstruction}\nDo not cram every feature, benefit, and selling point into one ad — pick the single strongest idea for each version and build around it.\n`}
BENEFIT OVER FEATURE:
Convert relevant features into what the customer actually gets, in plain conversational language — never a supplier-catalog or spec-sheet tone. Avoid words like "ornate", "filigree", "aesthetic centerpiece", "meticulously crafted", "intricate detailing", "sophisticated", "exquisite", "premium craftsmanship" unless truly unavoidable. Never invent a benefit not reasonably supported by the analysis below.

${NATURAL_COPY_RULES}

${CAPTION_STRUCTURE_RULES}

HUMAN, NATURAL VOICE:
Write like a real Filipino ecommerce marketer, not a translated template. Use natural Taglish when Taglish is selected. Vary sentence structure; avoid robotic phrasing and excessive emojis.

AVOID OVERCLAIMS: never say or imply "andito lahat", "pinakamura", "best price", "lowest price", "solved na lahat ng problema mo", or similar absolute/superlative claims that cannot be verified. Sell on real, specific merits instead.

VERIFIED CLAIMS ONLY — this is critical: NEVER state a registered-business claim, permit, "100% original", "authentic", FDA approval, doctor recommendation, money-back guarantee, free shipping, COD, a discount percentage, limited stock, or warranty UNLESS it appears in the Verified Claims list below. If Verified Claims says NONE, write copy with zero such claims — sell on the content's actual demonstrated merits instead.

FINANCING: ${financingLine}

SCARCITY: ${scarcityAllowed ? 'Limited-Time Sale and/or Limited Stock was confirmed below — you may use real urgency language tied to that fact.' : 'Neither Limited-Time Sale nor Limited Stock was confirmed — do NOT invent urgency ("unti na lang stock", "last chance", "hanggang today lang", "ubos na"). Sell on merit, not fake scarcity.'}

${buildPriceVisibilityGuidance(input.hidePriceInAdCopy, describeOffer(input.offer) || '')}

${ctaGuidance}

FLEXIBLE STRUCTURE — pick whichever fits the angle best, don't force one template every time. Examples: (Hook → Desire → Product → Benefit → Offer → CTA), (Hook → Product Demonstration → Why It Matters → Offer → CTA), (Hook → Problem → Product → Solution → CTA). Exception: if Content Type is SERVICE, use the SERVICE CAPTION FRAMEWORK above instead of these product-oriented examples.

LENGTH: ${COPY_LENGTH_GUIDANCE[input.copyLength]}

INTERNAL QUALITY BAR before finalizing, silently score 1-10 on: Hook Strength, Specificity, Customer Desire, Content Relevance, Clarity, Naturalness, Offer Clarity, CTA Strength, Scroll-Stopping Potential, Compliance Risk. Don't finalize copy with Hook Strength, Naturalness, or Relevance below 8 unless the analysis genuinely doesn't give you enough to do better. The loudest ad is not necessarily the strongest: prioritize specificity, clarity, and natural language over ALL CAPS, "!!!", 🔥🔥🔥, fake urgency, or unverified scarcity.
${previousHooks?.length ? `\nAlready-used hooks this session (generate genuinely different ones, not close variants of these): ${previousHooks.map(h => `"${h}"`).join(', ')}` : ''}
${extraInstruction ? `\nRewrite instruction for this specific request: ${extraInstruction}` : ''}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  ${forcedHook ? '' : `"hookOptions": [
    {"hook": "string — normal case, will be uppercased by the app", "angle": "string — the angle name", "isBestPick": true},
    {"hook": "string", "angle": "string", "isBestPick": false},
    {"hook": "string", "angle": "string", "isBestPick": false}
  ], // exactly 3, genuinely different angles`}
  "versions": [
    {
      "angle": "string — the ONE big idea/angle name used for this version${forcedHook ? ` — must be "${forcedHook.angle}"` : ''}",
      "hook": "string — normal case${forcedHook ? `, must be "${forcedHook.hook}"` : ', the scroll-stopping opening line, from the hook engine above'}",
      "primaryText": "string — the full FB primary text/caption, structure per CAPTION / PRIMARY TEXT STRUCTURE above (hook → short paragraph → 3-4 feature bullets → promo teaser if any → CTA), length per LENGTH above",
      "headline": "string — 3-10 words, not all-caps",
      "description": "string — short Meta Ads description line",
      "cta": "string — chosen per the CTA guidance above"
    }
  ]${singleAdOnly ? ' // exactly 1 entry' : `, // exactly 3 entries, each a genuinely different big idea (or genuinely different execution of the same required angle)
  "extraHooks": [
    {"category": "Curiosity", "hook": "string"},
    {"category": "Problem", "hook": "string"},
    {"category": "Benefit", "hook": "string"},
    {"category": "Desire", "hook": "string"},
    {"category": "Sales", "hook": "string"},
    {"category": "UGC", "hook": "string"}
  ] // exactly 10 entries spanning these 6 categories (not necessarily even per category) — each genuinely different, not filler, same HOOK WRITING STYLE + no-price/no-shaming/no-overclaim rules as above`}
}`;

  const analysisLines = [
    `Content Type: ${analysis.contentType}`,
    `Product/Store Name: ${analysis.productName}`,
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

  return { system, user };
}

// Cheap, text-only step — reuses the saved VideoAnalysis instead of the
// video frames, so "Regenerate"/rewrite actions never re-pay for vision.
export async function generateVideoAdCopy(analysis: VideoAnalysis, input: VideoAdCopyInput, extraInstruction?: string): Promise<VideoAdCopyResult> {
  const prompt = buildVideoAdContentPrompt(analysis, input, undefined, undefined, extraInstruction);

  // Raised from 4096 — the hook-engine + internal quality-scoring
  // instructions above ask the model to reason more before finalizing
  // (Sonnet 5 runs adaptive thinking by default), so the old budget was
  // tight for that plus the actual 3-version + 10-hook JSON output.
  const raw = await callClaude('video_copy', prompt.system, prompt.user, 8192);
  const parsed = extractJson(raw) as any;

  const claims = buildVideoVerifiedClaims(input);

  const versions: VideoAdVersion[] = Array.isArray(parsed?.versions)
    ? parsed.versions.slice(0, 3).map((v: any) => {
        const angle = String(v?.angle ?? '');
        return {
          angle,
          hook: finalizeHook(v?.hook, angle, 'video versions', claims),
          primaryText: finalizeVideoBodyText(String(v?.primaryText ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'long', [input.sellingPrice, input.originalPrice]),
          headline: finalizeVideoBodyText(String(v?.headline ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
          description: finalizeVideoBodyText(String(v?.description ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
          cta: finalizeVideoBodyText(String(v?.cta ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
        };
      })
    : [];
  const hookOptions: AdHookOption[] = Array.isArray(parsed?.hookOptions)
    ? parsed.hookOptions.slice(0, 3).map((h: any) => {
        const angle = String(h?.angle ?? '');
        return { hook: finalizeHook(h?.hook, angle, 'video hookOptions', claims), angle, isBestPick: !!h?.isBestPick };
      })
    : [];
  const extraHooks: VideoExtraHook[] = Array.isArray(parsed?.extraHooks)
    ? parsed.extraHooks.slice(0, 10).map((h: any) => {
        const category = (['Curiosity', 'Problem', 'Benefit', 'Desire', 'Sales', 'UGC'].includes(h?.category) ? h.category : 'Sales') as VideoExtraHook['category'];
        return { category, hook: finalizeHook(h?.hook, category, 'video extraHooks', claims) };
      })
    : [];

  if (!versions.length) {
    throw new AdCopyGeneratorError('AI did not return any ad copy versions.');
  }

  return { versions, hookOptions: normalizeHookOptions(hookOptions, versions[0]?.hook ?? ''), extraHooks };
}

// Lightweight, text-only regeneration of JUST the best-pick video version —
// used by "Use This Hook" (forcedHook set) and "Generate 3 New Hooks"
// (forcedHook omitted). Never touches versions[1]/versions[2]/extraHooks and
// never re-sends video frames, so it's much cheaper than a full
// generateVideoAdCopy() call.
export async function regenerateVideoAdCreativeHook(
  analysis: VideoAnalysis,
  input: VideoAdCopyInput,
  forcedHook?: { hook: string; angle: string },
  previousHooks?: string[],
): Promise<{ adVersion: VideoAdVersion; hookOptions: AdHookOption[] }> {
  const prompt = buildVideoAdContentPrompt(analysis, input, forcedHook, previousHooks, undefined, true);
  const raw = await callClaude('video_ad_hook_regen', prompt.system, prompt.user, 4096);
  const parsed = extractJson(raw) as any;

  const first = Array.isArray(parsed?.versions) ? parsed.versions[0] : null;
  if (!first) {
    throw new AdCopyGeneratorError('AI did not return an ad version.');
  }

  const claims = buildVideoVerifiedClaims(input);
  const regenAngle = String(first?.angle ?? forcedHook?.angle ?? '');
  const adVersion: VideoAdVersion = {
    angle: regenAngle,
    hook: finalizeHook(first?.hook ?? forcedHook?.hook, regenAngle, 'regenerateVideoAdCreativeHook', claims),
    primaryText: finalizeVideoBodyText(String(first?.primaryText ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'long', [input.sellingPrice, input.originalPrice]),
    headline: finalizeVideoBodyText(String(first?.headline ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
    description: finalizeVideoBodyText(String(first?.description ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
    cta: finalizeVideoBodyText(String(first?.cta ?? ''), claims, analysis.financingInfo, input.hidePriceInAdCopy, 'short', [input.sellingPrice, input.originalPrice]),
  };

  const hookOptions: AdHookOption[] = Array.isArray(parsed?.hookOptions)
    ? parsed.hookOptions.slice(0, 3).map((h: any) => {
        const angle = String(h?.angle ?? '');
        return { hook: finalizeHook(h?.hook, angle, 'regenerateVideoAdCreativeHook.hookOptions', claims), angle, isBestPick: !!h?.isBestPick };
      })
    : [];

  return { adVersion, hookOptions: normalizeHookOptions(hookOptions, adVersion.hook) };
}
