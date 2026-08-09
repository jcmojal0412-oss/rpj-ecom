import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// Under /api/ai-fb-ads, so middleware's ['/api/ai-fb-ads', 'ai_fb_ads']
// rule already requires a valid session + module permission to reach this.
export async function GET(_: NextRequest, { params }: { params: { filename: string } }) {
  try {
    const uploadDir = process.env.DATABASE_PATH
      ? path.join(path.dirname(process.env.DATABASE_PATH), 'ai-fb-ads')
      : path.join(process.cwd(), 'public', 'ai-fb-ads');

    const filename = params.filename.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const filepath = path.join(uploadDir, filename);
    const buffer = await readFile(filepath);

    const ext = filename.split('.').pop()?.toLowerCase() ?? 'png';
    const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
