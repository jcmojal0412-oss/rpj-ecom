import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { filename: string } }) {
  try {
    const uploadDir = process.env.DATABASE_PATH
      ? path.join(path.dirname(process.env.DATABASE_PATH), 'receipts')
      : path.join(process.cwd(), 'public', 'receipts');

    const filename = params.filename.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const filepath = path.join(uploadDir, filename);
    const buffer = await readFile(filepath);

    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const contentType = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
