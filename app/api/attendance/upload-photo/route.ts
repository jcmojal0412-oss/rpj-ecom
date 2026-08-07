import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.VERCEL
  ? '/tmp/attendance-photos'
  : path.join(process.cwd(), 'public', 'attendance-photos');

const RAILWAY_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'attendance-photos')
  : UPLOAD_DIR;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 8MB)' }, { status: 400 });
    }

    const uploadDir = RAILWAY_DIR;
    await mkdir(uploadDir, { recursive: true });

    const filename = `selfie-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = path.join(uploadDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    // Note: path here is the filename only — the actual serving route
    // (/api/attendance/photos/[filename]) enforces access control, unlike
    // the unprotected /api/receipts/[filename] route.
    return NextResponse.json({ filename, path: filename });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
