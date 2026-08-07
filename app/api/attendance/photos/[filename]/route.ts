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
  const owner = db.prepare('SELECT employee_id FROM attendance_events WHERE photo_path = ?').get(filename) as { employee_id: number | null } | undefined;

  const isAdmin = session.role === 'owner' || session.permissions.includes('attendance');
  const callerEmployee = isAdmin ? null : getActiveEmployeeForUser(db, session.id);
  const isOwnPhoto = !!owner?.employee_id && callerEmployee?.id === owner.employee_id;
  if (!owner || (!isOwnPhoto && !isAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const uploadDir = process.env.DATABASE_PATH
      ? path.join(path.dirname(process.env.DATABASE_PATH), 'attendance-photos')
      : path.join(process.cwd(), 'public', 'attendance-photos');
    const filepath = path.join(uploadDir, filename);
    const buffer = await readFile(filepath);

    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000' },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
