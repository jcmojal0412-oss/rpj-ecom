// AI FB Ads Generator V1 — pure prompt-building logic, no DB/network access.
// Kept separate from lib/image-generation.ts (the provider transport) so
// "what to ask for" stays independent of "how to call the API."
//
// V1.1 architecture change (per owner feedback on the first real test):
// the AI model must NEVER be asked to render price/headline/benefits/CTA
// text — vision-language image models routinely misspell or invent numbers,
// and the first live test also showed it can drift away from the supplied
// reference product entirely. So the prompt now asks for ONLY the visual
// backbone (product staging, background, lighting, composition) with an
// explicit "no text" instruction, and the app draws the real text as a
// canvas overlay afterward (see AiFbAdsClient.tsx) — the AI image becomes
// scaffolding, never the source of truth for anything a customer reads.

export type CreativeStyle = 'auto' | 'premium' | 'feature_heavy' | 'promo' | 'lifestyle';
export type AdFormat = '4:5' | '1:1';

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

export const CTA_OPTIONS = ['Shop Now', 'Order Now', 'Buy Now', 'Get Yours Now', 'Learn More'] as const;

// Never trust a manually-typed discount figure — compute it from the two
// real numbers whenever both are available. Returns null when there's
// nothing to compute (no old price, or old price isn't actually higher).
export function computeDiscountPercent(sellingPrice: number, oldPrice?: number | null): number | null {
  if (!oldPrice || oldPrice <= sellingPrice) return null;
  return Math.round((1 - sellingPrice / oldPrice) * 100);
}

const MASTER_INSTRUCTION = `Create the visual backbone of a professional commercial ecommerce product photograph, to be used as a Facebook advertising creative background. This image will have real marketing text and pricing added on top of it afterward by a separate design layer — so this image itself must contain almost no text.

PRODUCT FIDELITY — HIGHEST PRIORITY:
The supplied reference image shows the ACTUAL real product. Preserve it exactly as shown: same shape, proportions, colors, materials, markings, buttons, labels, printed text on the product itself, and construction. Do not invent a different or "improved" version of the product. Do not redesign it. Do not substitute a similar-looking but different product. If you are not fully confident about a specific detail of the product, keep that detail exactly as shown in the reference rather than guessing or changing it.

VISUAL DIRECTION:
Professional commercial product photography, shot as if by a paid ecommerce photographer for a premium online store. Strong visual hierarchy with the product as the clear hero element. Realistic, intentional lighting with proper shadow and depth — this must look like a photograph of a real product in a real (or realistically lit studio) environment, never like a flat illustration or a "random AI artwork." Thoughtful, uncluttered composition with deliberate negative space — do not fill the entire frame with detail. Optimize the composition for a vertical mobile phone screen (Facebook feed).

WHAT THIS IMAGE MUST NOT CONTAIN:
- Do not render any price, numbers, percentages, or discount figures.
- Do not render a headline, tagline, or any marketing copy.
- Do not render benefit text, feature labels, or bullet points.
- Do not render a "Shop Now" button or any call-to-action button or text.
- Do not invent or render any brand name, logo, or watermark that was not in the reference image.
- Do not add random numbers, fake product codes, or invented labels anywhere in the image.
- Do not distort the product's real geometry, proportions, or markings.
- Do not make this look like cheap, generic AI-generated artwork.
- Do not use a cluttered layout — leave clear open space for text to be added afterward.

If any product packaging visible in the reference already has real printed text on it (e.g. a label), you may keep that exact text as part of the product itself — but do not add any NEW text anywhere else in the image.`;

export interface AdPromptInput {
  productName: string;
  creativeStyle: CreativeStyle;
  format: AdFormat;
}

export function buildAdPrompt(input: AdPromptInput): string {
  const style = CREATIVE_STYLES.find(s => s.key === input.creativeStyle) ?? CREATIVE_STYLES[0];
  const formatLabel = input.format === '4:5' ? 'vertical 4:5 (Facebook Feed, 1080x1350)' : 'square 1:1 (Facebook Feed, 1080x1080)';

  return [
    MASTER_INSTRUCTION,
    '',
    `PRODUCT: ${input.productName}`,
    '',
    `PHOTOGRAPHY / COMPOSITION STYLE: ${style.promptDirection}`,
    '',
    `TARGET CUSTOMER: an everyday online shopper browsing Facebook on their phone — the image should feel trustworthy and premium, not like a random marketplace listing.`,
    '',
    `OUTPUT ASPECT RATIO: ${formatLabel}. Compose with that vertical/square frame in mind from the start.`,
  ].join('\n');
}
