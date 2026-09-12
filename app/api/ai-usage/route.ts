import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAiUsageDailySummary, getAiUsageByFeature } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const daily = getAiUsageDailySummary(30);
  const byFeature = getAiUsageByFeature(30);
  return NextResponse.json({ daily, byFeature });
}
