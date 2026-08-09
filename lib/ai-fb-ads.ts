// AI FB Ads Generator V1 — pure prompt-building logic, no DB/network access.
// Kept separate from lib/image-generation.ts (the provider transport) so
// "what to ask for" stays independent of "how to call the API."

export type CreativeStyle = 'auto' | 'premium' | 'feature_heavy' | 'promo' | 'lifestyle';
export type AdFormat = '4:5' | '1:1';

export const CREATIVE_STYLES: { key: CreativeStyle; label: string; description: string; promptDirection: string }[] = [
  {
    key: 'auto', label: 'Auto',
    description: 'Let the generator pick the best-fitting style for this offer.',
    promptDirection: 'Choose whichever style below best fits the supplied product, price, and offer.',
  },
  {
    key: 'premium', label: 'Premium Product',
    description: 'Elegant, clean, premium product photography, strong headline, minimal luxury layout.',
    promptDirection: 'Elegant and clean premium product photography style. Strong headline. Minimal, luxury layout with generous white space.',
  },
  {
    key: 'feature_heavy', label: 'Feature Heavy',
    description: 'Large product, feature icons, benefit sections, ecommerce infographic style.',
    promptDirection: 'Feature-heavy ecommerce infographic style. Large product display with icons and clearly labeled benefit sections.',
  },
  {
    key: 'promo', label: 'Promo / Discount',
    description: 'Big offer, sale-oriented, price prominent, strong CTA.',
    promptDirection: 'Sale-oriented promotional style. The offer and price are the most prominent visual elements, with a strong, high-contrast CTA.',
  },
  {
    key: 'lifestyle', label: 'Lifestyle',
    description: 'Product shown in a realistic usage environment, cleaner text layout, focus on customer lifestyle.',
    promptDirection: 'Lifestyle style — product shown in a realistic usage environment/setting. Cleaner, lighter text layout that keeps focus on the lifestyle scene.',
  },
];

export const CTA_OPTIONS = ['Shop Now', 'Order Now', 'Buy Now', 'Get Yours Now', 'Learn More'] as const;

const MASTER_INSTRUCTION = `Create a professional high-converting ecommerce Facebook advertising creative using the supplied product image as the primary product reference.

Preserve the real product appearance as accurately as possible.

The advertisement should look like a professionally designed ecommerce graphic, not a random AI artwork.

Create clear visual hierarchy.

The product must be one of the strongest visual elements.

Use the supplied product name, price, offer, headline and benefits accurately.

Include a clean CTA area.

Use modern ecommerce advertising design.

Avoid clutter.

Avoid tiny unreadable text.

Avoid distorted products.

Avoid fake logos or random brand names.

Avoid adding product features that were not supplied.

Make the composition optimized for mobile Facebook feeds.

Brand color direction: white, dark navy blue, and royal blue. Clean light backgrounds preferred. Use strong contrast. Do not make the design look cheap, overly colorful, or crowded.`;

export interface AdPromptInput {
  productName: string;
  price: string;
  oldPrice?: string;
  offer?: string;
  headline?: string;
  benefits: string[];
  cta: string;
  creativeStyle: CreativeStyle;
  format: AdFormat;
}

export function buildAdPrompt(input: AdPromptInput): string {
  const style = CREATIVE_STYLES.find(s => s.key === input.creativeStyle) ?? CREATIVE_STYLES[0];
  const formatLabel = input.format === '4:5' ? 'Facebook Feed 4:5 (1080x1350)' : 'Facebook Square 1:1 (1080x1080)';

  const lines = [
    MASTER_INSTRUCTION,
    '',
    `CREATIVE STYLE DIRECTION: ${style.promptDirection}`,
    '',
    'PRODUCT:',
    input.productName,
    '',
    'PRICE:',
    input.price,
  ];

  if (input.oldPrice) lines.push('', 'OLD PRICE:', input.oldPrice);
  if (input.offer) lines.push('', 'OFFER:', input.offer);
  if (input.headline) lines.push('', 'HEADLINE:', input.headline);
  if (input.benefits.length) lines.push('', 'BENEFITS:', input.benefits.map(b => `- ${b}`).join('\n'));

  lines.push('', 'CTA:', input.cta, '', 'CREATIVE STYLE:', style.label, '', 'FORMAT:', formatLabel);

  return lines.join('\n');
}
