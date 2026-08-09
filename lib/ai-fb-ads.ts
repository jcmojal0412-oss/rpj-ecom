// AI FB Ads Generator V1 — pure prompt-building logic, no DB/network access.
// Kept separate from lib/image-generation.ts (the provider transport) so
// "what to ask for" stays independent of "how to call the API."
//
// V1.3 — full "poster ad" architecture, replacing the V1.1/V1.2
// "AI draws only the background, the app overlays all text" approach.
//
// Why the pivot: the owner shared 3 real ChatGPT-generated reference ads
// (ornamental header, script eyebrow line + bold serif headline, an icon+
// text benefit list, a circular badge/seal, a product inset, a two-tier
// bottom banner — ALL rendered by the AI, not overlaid) and asked for that
// exact quality bar. That's proof gpt-image-1 CAN render short, verbatim,
// user-authored marketing copy reliably when given the exact text to use
// and a clear structural brief — the earlier failure (wrong product, wrong
// price) was really about (a) using a non-product logo as the test
// reference image, and (b) asking the model to inventing/calculate a
// numeric price on its own.
//
// So now: Headline, Benefits, Offer/tagline and CTA are embedded directly
// in the prompt and the AI renders them as part of the full composition.
// The one thing still kept OUT of the AI image and added as a canvas
// overlay afterward is the numeric Price/Old Price/Discount — pure numbers
// are the one category that's still unreliable to trust an image model
// with, and none of the reference ads even show a price. Product identity
// preservation (never invent/replace/redesign the reference product) is
// unchanged and still non-negotiable.

export type CreativeStyle = 'auto' | 'premium' | 'feature_heavy' | 'promo' | 'lifestyle';
export type AdFormat = '4:5' | '1:1';
export type PromptMode = 'auto' | 'preset' | 'custom';
export type PresetKey = 'premium' | 'feature_heavy' | 'promo' | 'lifestyle' | 'minimal_clean' | 'high_converting';

export const CREATIVE_STYLES: { key: CreativeStyle; label: string; description: string; promptDirection: string }[] = [
  {
    key: 'auto', label: 'Auto',
    description: 'Let the generator pick the best-fitting style for this offer.',
    promptDirection: 'Choose whichever composition below best fits this product and offer.',
  },
  {
    key: 'premium', label: 'Premium Product',
    description: 'Elegant editorial poster, one dominant hero shot.',
    promptDirection:
      'Elegant, editorial poster composition. Full-bleed premium photography (studio or a refined real setting) with the ' +
      'product as the clear hero. Restrained typography — a slim decorative divider, a short elegant eyebrow line, one bold ' +
      'headline, minimal supporting copy. Luxury magazine-ad feel, generous spacing, not busy.',
  },
  {
    key: 'feature_heavy', label: 'Feature Heavy',
    description: 'Icon-driven benefit list beside a large hero shot.',
    promptDirection:
      'Structured ecommerce poster with a large hero product photo and a clear vertical list of benefit callouts down one ' +
      'side, each with a small circular icon badge beside 1-2 lines of text. Professional infographic-meets-lifestyle-ad feel.',
  },
  {
    key: 'promo', label: 'Promo / Discount',
    description: 'Bold, energetic, offer-forward poster.',
    promptDirection:
      'Bold, energetic, scroll-stopping poster layout. Strong colored banner elements, a prominent CTA area, dynamic but ' +
      'clean composition. Product still highly visible and the overall design still premium, not cheap or cluttered.',
  },
  {
    key: 'lifestyle', label: 'Lifestyle',
    description: 'Real people, real setting, product naturally in-scene.',
    promptDirection:
      'Realistic lifestyle photography as the full-bleed background — real people (family, a professional, a homeowner, ' +
      'whichever fits the product) in an authentic real-world setting, with the product naturally placed within that scene ' +
      '(e.g. worn, held, or displayed in the environment) rather than floating on a plain background. Editorial, aspirational, ' +
      'warm and natural lighting.',
  },
];

// Preset prompts — owner-specified wording, used only when Prompt Mode = Preset.
export const PRESET_PROMPTS: { key: PresetKey; label: string; prompt: string }[] = [
  {
    key: 'premium', label: 'Premium Product',
    prompt: 'Use a premium, elegant, clean, luxury-inspired ecommerce style. Emphasize the product as the hero with refined lighting, premium presentation, and a polished professional look.',
  },
  {
    key: 'feature_heavy', label: 'Feature Heavy Ecommerce',
    prompt: 'Use a structured ecommerce ad layout with a large hero product, clean feature sections, icons or visual benefit areas, and a professional infographic-style composition.',
  },
  {
    key: 'promo', label: 'Promo / Discount',
    prompt: 'Use a scroll-stopping sales-driven layout. Emphasize the offer, urgency, and CTA while keeping the product highly visible and the design premium.',
  },
  {
    key: 'lifestyle', label: 'Lifestyle',
    prompt: 'Place the product in a realistic, aspirational, and visually attractive lifestyle setting. Keep the design clean and premium, with the product still as the hero.',
  },
  {
    key: 'minimal_clean', label: 'Minimal Clean',
    prompt: 'Use a minimalist clean layout with strong spacing, soft background, simple premium typography, and focus on elegance and clarity.',
  },
  {
    key: 'high_converting', label: 'High-Converting FB Ad',
    prompt: 'Use a high-converting Facebook ad approach with a strong hook, premium product presentation, persuasive visual hierarchy, and mobile-first clarity.',
  },
];

export const DEFAULT_CUSTOM_FALLBACK =
  'Add a strong hook, make it premium, and if appropriate include a model or lifestyle element to improve visual appeal.';

export const CTA_OPTIONS = ['Shop Now', 'Order Now', 'Buy Now', 'Get Yours Now', 'Learn More'] as const;

// Never trust a manually-typed discount figure — compute it from the two
// real numbers whenever both are available. Returns null when there's
// nothing to compute (no old price, or old price isn't actually higher).
export function computeDiscountPercent(sellingPrice: number, oldPrice?: number | null): number | null {
  if (!oldPrice || oldPrice <= sellingPrice) return null;
  return Math.round((1 - sellingPrice / oldPrice) * 100);
}

// LAYER 1 — hidden master prompt, always used. Describes the FULL finished
// poster structure (matching the reference ads), not just a product photo.
const MASTER_PROMPT = `Create a premium, professional, full-bleed Facebook advertising POSTER for the attached product — a complete finished ad graphic that combines real photography with polished graphic design, like a high-end printed flyer or agency-made ecommerce ad. This is NOT just a product photo — it is a fully composed advertisement with real text rendered directly in the image.

Preserve the actual product's appearance exactly and make it the visual hero of the design — never invent a different product, never redesign it, never distort its shape, colors, materials, or markings.

COMPOSITION TO FOLLOW (adapt to the chosen style below, but keep this general structure):
- Full-bleed, photorealistic background — real photography (a lifestyle setting, a model, or refined studio staging, whichever fits the style) with the product naturally integrated into the scene.
- A short decorative header near the top: a slim ornamental divider line, optionally with a small decorative motif, framing a short elegant eyebrow line above a bold, large headline.
- A short one-line supporting description beneath the headline.
- A vertical or horizontal list of benefit callouts, each paired with a small circular icon badge.
- A circular badge or seal graphic somewhere in the composition carrying a short closing line or the call-to-action phrase.
- A bottom banner: a bold colored strip with a short punchy tagline, and a lighter strip beneath it with 2 short trust/value phrases separated by a small divider.
- Typography: pair an elegant script/cursive accent face for the small eyebrow line with a bold serif or bold sans headline, and a clean simple sans for supporting/body text — premium, editorial, magazine-ad quality, never a generic template look.
- Strong visual hierarchy, balanced spacing, premium lighting and shadow, modern styling. Optimized for mobile Facebook feed viewing.

TEXT ACCURACY (non-negotiable): render the Headline, Benefits, Offer/tagline and CTA text given below EXACTLY as written — do not rewrite, shorten, paraphrase, mistranslate, or invent your own copy in their place. If any of those fields are not provided, you may design a short, fitting line yourself in the same voice, but never for the ones that ARE provided.

DO NOT render any price, peso amount, percentage, or discount number anywhere in the image — that is added separately afterward with guaranteed-accurate numbers. Do not invent a brand name, logo, or watermark that wasn't supplied. Do not distort the product's real geometry or markings. Do not make this look like a cheap, generic AI template.`;

export interface AdPromptInput {
  productName: string;
  headline?: string;
  benefits?: string[];
  offer?: string;
  cta?: string;
  format: AdFormat;
  promptMode: PromptMode;
  creativeStyle: CreativeStyle;   // used when promptMode is 'auto' or 'custom'
  presetKey?: PresetKey;          // used when promptMode is 'preset'
  customPrompt?: string;          // used when promptMode is 'custom'
}

export function buildAdPrompt(input: AdPromptInput): string {
  const formatLabel = input.format === '4:5' ? 'vertical 4:5 (Facebook Feed, 1080x1350)' : 'square 1:1 (Facebook Feed, 1080x1080)';

  // LAYER 2: preset directly when Prompt Mode = Preset; otherwise the
  // Creative Style's own direction (Auto and Custom both use Creative Style
  // per the requested logic).
  let styleBlock: string;
  if (input.promptMode === 'preset') {
    const preset = PRESET_PROMPTS.find(p => p.key === input.presetKey) ?? PRESET_PROMPTS[0];
    styleBlock = `CREATIVE DIRECTION (${preset.label}): ${preset.prompt}`;
  } else {
    const style = CREATIVE_STYLES.find(s => s.key === input.creativeStyle) ?? CREATIVE_STYLES[0];
    styleBlock = `CREATIVE DIRECTION (${style.label}): ${style.promptDirection}`;
  }

  // LAYER 3: only in Custom mode — user's own text, or the intelligent
  // fallback line when they leave it blank.
  const customBlock = input.promptMode === 'custom'
    ? `ADDITIONAL INSTRUCTIONS: ${input.customPrompt?.trim() || DEFAULT_CUSTOM_FALLBACK}`
    : '';

  const contentLines = [`PRODUCT: ${input.productName}`];
  if (input.headline?.trim()) contentLines.push(`HEADLINE (render exactly): ${input.headline.trim()}`);
  if (input.benefits && input.benefits.filter(Boolean).length) {
    contentLines.push(`BENEFITS (render exactly, one per icon callout): ${input.benefits.filter(Boolean).map(b => `"${b}"`).join(', ')}`);
  }
  if (input.offer?.trim()) contentLines.push(`OFFER / TAGLINE (render exactly): ${input.offer.trim()}`);
  if (input.cta?.trim()) contentLines.push(`CTA PHRASE (render exactly, e.g. in the badge or bottom banner): ${input.cta.trim()}`);

  const sections = [
    MASTER_PROMPT,
    contentLines.join('\n'),
    styleBlock,
    customBlock,
    `OUTPUT ASPECT RATIO: ${formatLabel}. Compose with that vertical/square frame in mind from the start.`,
  ].filter(Boolean);

  return sections.join('\n\n');
}
