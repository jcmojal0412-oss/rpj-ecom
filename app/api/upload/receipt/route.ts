import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.VERCEL
  ? '/tmp/receipts'
  : path.join(process.cwd(), 'public', 'receipts');

const RAILWAY_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'receipts')
  : UPLOAD_DIR;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only image files and PDFs are allowed' }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    const uploadDir = RAILWAY_DIR;
    await mkdir(uploadDir, { recursive: true });

    const ext = file.name.split('.').pop() ?? 'jpg';
    const filename = `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filepath = path.join(uploadDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    return NextResponse.json({ filename, path: `/api/receipts/${filename}` });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
