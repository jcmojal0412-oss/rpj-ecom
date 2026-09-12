export const AD_ANGLE_OPTIONS = [
  { value: 'AUTO', label: 'AUTO — Let AI Choose Best Angle' },
  { value: 'Pain/Problem', label: 'Pain / Problem' },
  { value: 'Problem-Solution', label: 'Problem-Solution' },
  { value: 'Fear/Loss Aversion', label: 'Fear / Loss Aversion' },
  { value: 'Curiosity', label: 'Curiosity' },
  { value: 'Masa/Sulit', label: 'Masa / Sulit' },
  { value: 'Premium', label: 'Premium' },
  { value: 'Mommy/Family', label: 'Mommy / Family' },
  { value: 'Lifestyle', label: 'Lifestyle' },
  { value: 'Before/After', label: 'Before / After' },
  { value: 'Convenience', label: 'Convenience' },
  { value: 'Social Proof', label: 'Social Proof' },
  { value: 'Urgency', label: 'Urgency' },
  { value: 'Hard Sell', label: 'Hard Sell' },
  { value: 'Soft Sell', label: 'Soft Sell' },
  { value: 'UGC Style', label: 'UGC Style' },
  { value: 'Retargeting', label: 'Retargeting' },
] as const;

export const TARGET_AUDIENCE_PRESETS = [
  'Auto Detect', 'General', 'Moms / Parents', 'Men', 'Women', 'Seniors',
  'Car Owners', 'Homeowners', 'Outdoor / Camping', 'Beauty', 'Health & Wellness', 'Gadget Buyers', 'Custom',
] as const;

export const AD_OBJECTIVES = ['Sales / Conversion', 'Engagement', 'Retargeting', 'Product Awareness'] as const;

// Kept identical to lib/ad-copy-generator.ts TONE_OPTIONS (and
// AdCopyGeneratorClient.tsx's copy) so both generators share the exact same
// Tone list and behavior.
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

export const COPY_LENGTH_OPTIONS = [
  { value: 'Short', label: 'Short (~40-80 words)' },
  { value: 'Standard', label: 'Standard (~80-150 words)' },
  { value: 'Long', label: 'Long (~150-250 words)' },
] as const;
