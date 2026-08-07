import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { filename: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const filename = params.filename.replace(/[^a-zA-Z0-9.\-_]/g, '');

  const db = getDb();
  const owner = db.prepare('SELECT employee_id FROM leave_requests WHERE attachment_path = ?').get(filename) as { employee_id: number | null } | undefined;

  const isAdmin = session.role === 'owner' || session.permissions.includes('leave_management');
  const callerEmployee = isAdmin ? null : getActiveEmployeeForUser(db, session.id);
  const isOwn = !!owner?.employee_id && callerEmployee?.id === owner.employee_id;
  if (!owner || (!isOwn && !isAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const uploadDir = process.env.DATABASE_PATH
      ? path.join(path.dirname(process.env.DATABASE_PATH), 'leave-attachments')
      : path.join(process.cwd(), 'public', 'leave-attachments');
    const filepath = path.join(uploadDir, filename);
    const buffer = await readFile(filepath);
    const contentType = filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=31536000' },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
