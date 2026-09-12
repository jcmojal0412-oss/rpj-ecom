import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { regenerateAdCreativeHook, parseAdCopyInputBody, AdCopyGeneratorError } from '@/lib/ad-copy-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// Powers both "Use This Hook" (selected_hook/selected_angle set) and
// "Generate 3 New Hooks" (omitted) — always text-only, reuses the product
// info already in the client's form state, never re-sends the image.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('ad_copy_generator')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.product_name?.trim()) {
      return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
    }
    if (!body.shop_name?.trim()) {
      return NextResponse.json({ error: 'Shop name is required.' }, { status: 400 });
    }
    if (!body.price?.trim()) {
      return NextResponse.json({ error: 'Price is required.' }, { status: 400 });
    }
    if (!body.promo_offer?.trim()) {
      return NextResponse.json({ error: 'Promo/Offer is required.' }, { status: 400 });
    }

    const input = parseAdCopyInputBody(body);
    const { selected_hook, selected_angle, previous_hooks } = body;
    const forcedHook = selected_hook?.trim() && selected_angle?.trim()
      ? { hook: selected_hook.trim(), angle: selected_angle.trim() }
      : undefined;
    const previousHooks = Array.isArray(previous_hooks) ? previous_hooks.map(String) : undefined;

    const result = await regenerateAdCreativeHook(input, forcedHook, previousHooks);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[ad-copy-generator] hook regeneration error:', e?.message);
    if (e instanceof AdCopyGeneratorError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Could not update the hook. Please try again.' }, { status: 500 });
  }
}
