const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export interface ResearchCriteria {
  season: string;
  cogs: number;
  srp: number;
  category: string;
  market: string;
  margin: number;
  notes?: string;
}

export interface ProductRecommendation {
  product_name: string;
  estimated_cogs: number;
  suggested_srp: number;
  margin_percent: number;
  problem_solved: string;
  target_market: string;
  why_it_sells_now: string;
  perceived_value_score: number;
  demand_score: number;
  competition_score: number;
  facebook_ads_potential: number;
  tiktok_potential: number;
  compliance_risk: 'Low' | 'Medium' | 'High';
  rts_risk: 'Low' | 'Medium' | 'High';
  overall_score: number;
  decision: 'SCALE' | 'TEST' | 'REJECT';
}

export interface ProductDetails {
  facebook_hooks: string[];
  tiktok_hooks: string[];
  ugc_concepts: string[];
  image_ad_concepts: string[];
  suggested_offer: string;
  suggested_audience: string;
  suggested_pricing: string;
}

const LIST_SYSTEM_PROMPT = `Act as an expert Philippine COD ecommerce product researcher.

Find winning products based on: Season, COGS, SRP, Market, Category.

Focus on: High perceived value, Strong ad potential, Easy demonstration, Low fulfillment risk, Healthy margins.

Score products from 0-100.
85-100 = SCALE
70-84 = TEST
Below 70 = REJECT

Return ONLY valid JSON (no markdown fences, no prose) — an array of exactly 8 product objects, each with exactly these keys:
product_name (string), estimated_cogs (number, PHP), suggested_srp (number, PHP), margin_percent (number),
problem_solved (string), target_market (string), why_it_sells_now (string),
perceived_value_score (0-100), demand_score (0-100), competition_score (0-100),
facebook_ads_potential (0-100), tiktok_potential (0-100),
compliance_risk ("Low"|"Medium"|"High"), rts_risk ("Low"|"Medium"|"High"),
overall_score (0-100), decision ("SCALE"|"TEST"|"REJECT").
Keep string fields short (1 sentence max) so the response stays fast to generate.`;

const DETAILS_SYSTEM_PROMPT = `Act as an expert Philippine COD ecommerce ad creative strategist.

Given a single product, return ONLY valid JSON (no markdown fences, no prose) with exactly these keys:
facebook_hooks (array of 5 short strings), tiktok_hooks (array of 5 short strings),
ugc_concepts (array of 3 short strings), image_ad_concepts (array of 3 short strings),
suggested_offer (string), suggested_audience (string), suggested_pricing (string).`;

export class AIResearchError extends Error {}

function extractJson(text: string, kind: 'array' | 'object'): unknown {
  const pattern = kind === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = text.match(pattern);
  if (!match) throw new AIResearchError('AI response did not contain valid JSON.');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new AIResearchError('Failed to parse AI response as JSON.');
  }
}

async function callClaude(system: string, userPrompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIResearchError('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AIResearchError(`Anthropic API error (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

export async function generateProductRecommendations(
  criteria: ResearchCriteria
): Promise<ProductRecommendation[]> {
  const userPrompt = `Season: ${criteria.season}
Target COGS: ₱${criteria.cogs}
Target SRP: ₱${criteria.srp}
Category: ${criteria.category}
Market: ${criteria.market}
Desired Margin: ${criteria.margin}%
Notes: ${criteria.notes || 'None'}

Generate exactly 8 winning product recommendations as a JSON array.`;

  const text = await callClaude(LIST_SYSTEM_PROMPT, userPrompt, 2500);
  const parsed = extractJson(text, 'array');

  if (!Array.isArray(parsed)) {
    throw new AIResearchError('AI response was not an array of recommendations.');
  }

  return parsed as ProductRecommendation[];
}

export async function generateProductDetails(
  product: ProductRecommendation,
  criteria: ResearchCriteria
): Promise<ProductDetails> {
  const userPrompt = `Product: ${product.product_name}
Problem solved: ${product.problem_solved}
Target market: ${product.target_market}
Season: ${criteria.season}
COGS: ₱${product.estimated_cogs}
SRP: ₱${product.suggested_srp}
Market: ${criteria.market}

Return the ad creative JSON object now.`;

  const text = await callClaude(DETAILS_SYSTEM_PROMPT, userPrompt, 1500);
  const parsed = extractJson(text, 'object');
  return parsed as ProductDetails;
}
