import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { getEmployeeById } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.VERCEL
  ? '/tmp/attendance-photos'
  : path.join(process.cwd(), 'public', 'attendance-photos');

const RAILWAY_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'attendance-photos')
  : UPLOAD_DIR;

// Kiosk equivalent of /api/attendance/upload-photo — unauthenticated (see
// middleware.ts PUBLIC list), so in place of a session it requires a real,
// Active, Attendance Enabled employee_id (independently re-verified here,
// same as the kiosk's clock route). Photos still land in the same
// access-controlled directory served only via
// /api/attendance/photos/[filename], which already authorizes admins or
// the photo's own linked employee — a kiosk photo has no "own session" to
// view it back later, so only admins will ever read it.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const employeeId = Number(formData.get('employee_id'));

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });

    const db = getDb();
    const employee = getEmployeeById(db, employeeId);
    if (!employee || employee.employment_status !== 'Active' || !employee.attendance_enabled) {
      return NextResponse.json({ error: 'Employee not found or not eligible for attendance.' }, { status: 404 });
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 8MB)' }, { status: 400 });
    }

    const uploadDir = RAILWAY_DIR;
    await mkdir(uploadDir, { recursive: true });

    const filename = `selfie-kiosk-${employee.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = path.join(uploadDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    return NextResponse.json({ filename, path: filename });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
