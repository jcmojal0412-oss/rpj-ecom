// AI FB Ads Generator V1 — pure prompt-building logic, no DB/network access.
// Kept separate from lib/image-generation.ts (the provider transport) so
// "what to ask for" stays independent of "how to call the API."
//
// V1.2 architecture — three prompt layers, matching the owner's requested
// structure:
//   LAYER 1: MASTER_PROMPT — hidden, always used, owner-specified wording.
//   LAYER 2: style direction — either the matching CREATIVE_STYLES entry
//            (Prompt Mode = Auto or Custom) or a PRESET_PROMPTS entry
//            (Prompt Mode = Preset).
//   LAYER 3: CUSTOM_PROMPT — optional free text, only appended in Custom mode.
//
// TECHNICAL_ADDENDUM is NOT one of the three owner-facing layers — it's a
// standing technical constraint appended to every request regardless of
// mode. It exists because of what the V1.1 rework (previous session) found
// in the first live test: asking the model to render price/headline/CTA
// text produced wrong numbers and even a wrong product. The addendum keeps
// the master prompt's own "avoid fake text, inaccurate numbers" line
// actually enforceable by (a) telling the model to leave that text out of
// the image entirely — the app composites the real text afterward via
// canvas, see AiFbAdsClient.tsx — and (b) spelling out product-fidelity
// requirements precisely. Removing it would regress straight back to the
// wrong-product/wrong-price failure from the first test.

export type CreativeStyle = 'auto' | 'premium' | 'feature_heavy' | 'promo' | 'lifestyle';
export type AdFormat = '4:5' | '1:1';
export type PromptMode = 'auto' | 'preset' | 'custom';
export type PresetKey = 'premium' | 'feature_heavy' | 'promo' | 'lifestyle' | 'minimal_clean' | 'high_converting';

export const CREATIVE_STYLES: { key: CreativeStyle; label: string; description: string; promptDirection: string }[] = [
  {
    key: 'auto', label: 'Auto',
    description: 'Let the generator pick the best-fitting style for this offer.',
    promptDirection: 'Choose whichever commercial photography treatment below best fits this product and offer.',
  },
  {
    key: 'premium', label: 'Premium Product',
    description: 'Elegant studio staging, premium lighting, one dominant hero product.',
    promptDirection:
      'Premium studio product photography. Elegant staging on a clean surface with a subtle gradient or softly lit backdrop. ' +
      'Realistic studio lighting with soft shadow and a gentle reflection beneath the product. The product is one large, ' +
      'dominant hero element, shot at a flattering three-quarter angle. Generous negative space above and below the product ' +
      'so text can be overlaid later — leave the top ~20% and bottom ~25% of the frame visually quiet (soft gradient or blank ' +
      'background, no busy detail there). Minimal, uncluttered, luxury feel.',
  },
  {
    key: 'feature_heavy', label: 'Feature Heavy',
    description: 'Large product plus clear space for benefit callouts.',
    promptDirection:
      'Feature-forward ecommerce product photography. Large, clearly lit hero product placed slightly right-of-center on a ' +
      'clean, softly lit background. Leave open, uncluttered negative space along the left third and across the very top ' +
      'and bottom of the frame — that space will hold benefit callouts and pricing added afterward, so keep it visually calm ' +
      '(soft gradient or plain background there, no competing detail). Sharp product detail and realistic material texture ' +
      '(fabric weave, plastic sheen, metal, etc. — whatever the product is actually made of) so viewers can see its quality.',
  },
  {
    key: 'promo', label: 'Promo / Discount',
    description: 'Bold, energetic staging built around a big price moment.',
    promptDirection:
      'Bold, energetic ecommerce promotional photography. Product staged prominently with dynamic but clean lighting and a ' +
      'punchy, high-contrast background using the brand colors (white / dark navy blue / royal blue) — think a sale-event ' +
      'feel without being tacky. Leave a clear, visually quiet zone across the top and a strong open band across the bottom ' +
      'third of the frame — those areas will carry a price badge and CTA button added afterward, so avoid placing important ' +
      'product detail there.',
  },
  {
    key: 'lifestyle', label: 'Lifestyle',
    description: 'Product shown in a realistic, relatable usage setting.',
    promptDirection:
      'Realistic lifestyle product photography. Show the product in an authentic, relatable real-world usage environment or ' +
      'setting appropriate to what it is, shot like a natural editorial/lifestyle ecommerce photo (not a studio cutout). ' +
      'Natural, soft lighting. Keep the top of the frame and a band across the bottom visually calmer/less busy so text can ' +
      'be overlaid there afterward.',
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
    prompt: 'Use a scroll-stopping sales-driven layout. Emphasize the offer, price, urgency, and CTA while keeping the product highly visible and the design premium.',
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

// LAYER 1 — hidden master prompt, owner-specified wording, always used.
const MASTER_PROMPT = `Create a premium high-converting Facebook ad image for the attached product.
Preserve the actual product appearance and make it the main hero of the design.
Create a clean, premium, professional ecommerce advertising layout.
Use strong visual hierarchy, polished composition, balanced spacing, premium lighting, and modern styling.
Make it suitable for Facebook Ads and optimized for mobile viewing.
If appropriate, include a stylish model or lifestyle element, but keep the product as the main focus.
Avoid clutter, distorted product details, fake text, inaccurate numbers, cheap-looking layouts, and random brand elements.
Strictly follow the selected output format and aspect ratio.
Act like a professional graphic artist and Facebook ad strategist.`;

// Standing technical constraint, not one of the 3 owner-facing layers —
// see file header for why this can't be dropped.
const TECHNICAL_ADDENDUM = `PRODUCT FIDELITY (non-negotiable): the attached image shows the ACTUAL real product. Keep its exact shape, proportions, colors, materials, markings, and labels — do not redesign it, do not invent a different or "improved" version, do not substitute a similar-looking but different product. If unsure about a specific detail, keep it exactly as shown rather than guessing.

TEXT (non-negotiable): a separate design layer adds the real product name, price, discount, headline and CTA on top of this image afterward with guaranteed-accurate spelling and numbers. So this image itself must not render ANY price, number, percentage, headline, CTA button/text, or marketing copy — leave clean, uncluttered negative space (per the layout direction below) for that text to be added later. Do not add any brand name, logo, or watermark that wasn't in the reference image.`;

export interface AdPromptInput {
  productName: string;
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

  const sections = [
    MASTER_PROMPT,
    TECHNICAL_ADDENDUM,
    `PRODUCT: ${input.productName}`,
    styleBlock,
    customBlock,
    `OUTPUT ASPECT RATIO: ${formatLabel}. Compose with that vertical/square frame in mind from the start.`,
  ].filter(Boolean);

  return sections.join('\n\n');
}
