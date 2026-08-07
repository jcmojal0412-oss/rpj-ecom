import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.VERCEL
  ? '/tmp/leave-attachments'
  : path.join(process.cwd(), 'public', 'leave-attachments');

const RAILWAY_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'leave-attachments')
  : UPLOAD_DIR;

const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

// Optional supporting document for a leave request (e.g. a medical
// certificate). Served back via /api/leave-requests/attachments/[filename],
// access-controlled the same way attendance selfies are.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!VALID_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WEBP, or PDF files are allowed' }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 8MB)' }, { status: 400 });
    }

    const uploadDir = RAILWAY_DIR;
    await mkdir(uploadDir, { recursive: true });

    const filename = `leave-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${EXT_BY_TYPE[file.type]}`;
    const filepath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    return NextResponse.json({ filename, path: filename });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
