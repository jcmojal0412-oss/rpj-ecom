// AI FB Ads Generator V1 — image-generation provider abstraction. Server-
// only (never imported by a 'use client' file): reads the secret API key
// from process.env, so an accidental client import would leak it into the
// browser bundle. The route handler (app/api/ai-fb-ads/generate/route.ts)
// is the only caller.
//
// Swapping providers later means adding a branch here and setting
// IMAGE_API_PROVIDER — nothing else in the app changes, since callers only
// ever see GenerateAdImageInput/Result.

export interface GenerateAdImageInput {
  prompt: string;
  referenceImageBase64?: string; // product photo, no data: prefix
  referenceImageMediaType?: string; // e.g. 'image/jpeg'
  format: '4:5' | '1:1';
}

export interface GenerateAdImageResult {
  imageBase64: string;
  mediaType: string;
}

export class ImageGenerationConfigError extends Error {}
export class ImageGenerationApiError extends Error {}

const FORMAT_TO_OPENAI_SIZE: Record<GenerateAdImageInput['format'], string> = {
  '4:5': '1024x1536', // closest portrait size gpt-image-1 offers to 1080x1350
  '1:1': '1024x1024',
};

export async function generateAdImage(input: GenerateAdImageInput): Promise<GenerateAdImageResult> {
  const provider = process.env.IMAGE_API_PROVIDER || 'openai';
  const apiKey = process.env.IMAGE_API_KEY;
  if (!apiKey) {
    throw new ImageGenerationConfigError('IMAGE_API_KEY is not configured.');
  }

  switch (provider) {
    case 'openai':
      return generateWithOpenAI(input, apiKey);
    default:
      throw new ImageGenerationConfigError(`Unknown IMAGE_API_PROVIDER "${provider}".`);
  }
}

async function generateWithOpenAI(input: GenerateAdImageInput, apiKey: string): Promise<GenerateAdImageResult> {
  const size = FORMAT_TO_OPENAI_SIZE[input.format];

  // quality: 'high' — without this, gpt-image-1 falls back to a cheaper/
  // faster internal default that visibly looks worse than what the ChatGPT
  // app itself renders (which always uses high quality for user-facing
  // images). This costs more per generation but was the actual root cause
  // of the "looks nothing like ChatGPT" complaint — not the prompt.
  let res: Response;
  if (input.referenceImageBase64) {
    // Image edit — uses the supplied product photo as the visual reference,
    // per "preserve the real product appearance as accurately as possible."
    // input_fidelity: 'high' is gpt-image-1's dedicated setting for exactly
    // that — it keeps far more of the reference photo's real detail intact
    // through the edit than the default, instead of loosely reinterpreting it.
    const bytes = Buffer.from(input.referenceImageBase64, 'base64');
    const ext = (input.referenceImageMediaType || 'image/jpeg').split('/')[1] || 'jpg';
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', input.prompt);
    form.append('size', size);
    form.append('quality', 'high');
    form.append('input_fidelity', 'high');
    form.append('n', '1');
    form.append('image', new Blob([bytes], { type: input.referenceImageMediaType || 'image/jpeg' }), `reference.${ext}`);

    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: input.prompt, size, quality: 'high', n: 1 }),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new ImageGenerationApiError(`Image API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ImageGenerationApiError('Image API returned no image data.');

  return { imageBase64: b64, mediaType: 'image/png' };
}
