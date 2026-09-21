import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, assertCanAttach, audit } from '@/lib/calendar-service';
import { CALENDAR_FILE_DIR } from '@/lib/calendar-files';

// Receipts, invoices, statements, SOAs, meeting files, screenshots — stored by
// lib/calendar-files.ts, served only through the access-checked /api/calendar/attachments/[id].

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const KINDS = ['receipt', 'invoice', 'statement', 'soa', 'meeting_file', 'screenshot', 'other'];
const MAX_BYTES = 20 * 1024 * 1024, MAX_FILES = 25;

export const POST = calendarRoute<{ id: string }>(async (req, { db, caps }, { id }) => {
  const eventId = idOf(id);
  assertCanAttach(db, caps, eventId);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file') as File | null;
  if (!file || typeof file === 'string') throw new CalendarError('Choose a file to upload.');
  const ext = TYPES[file.type];
  if (!ext) throw new CalendarError('Only images, PDF, Word, Excel, PowerPoint, text and CSV files are allowed.');
  if (file.size > MAX_BYTES) throw new CalendarError('That file is too large (max 20 MB).');
  if (file.size === 0) throw new CalendarError('That file is empty.');
  if ((db.prepare('SELECT COUNT(*) c FROM calendar_event_attachments WHERE event_id = ? AND deleted_at IS NULL').get(eventId) as { c: number }).c >= MAX_FILES) throw new CalendarError(`At most ${MAX_FILES} files per schedule.`);

  const kindRaw = String(form?.get('kind') ?? 'other');
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'other';
  let paymentId: number | null = null;
  const pRaw = form?.get('payment_id');
  if (pRaw) {
    paymentId = Number(pRaw);
    if (!db.prepare('SELECT 1 FROM calendar_event_payments WHERE id = ? AND event_id = ?').get(paymentId, eventId)) throw new CalendarError('Payment not found.', 404);
  }

  const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await mkdir(CALENDAR_FILE_DIR, { recursive: true });
  await writeFile(path.join(CALENDAR_FILE_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const original = (file.name || `file.${ext}`).replace(/[\r\n"\\/]/g, '_').slice(0, 160);
  const info = db.prepare('INSERT INTO calendar_event_attachments (event_id, payment_id, kind, stored_name, original_name, mime_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(eventId, paymentId, kind, stored, original, file.type, file.size, caps.userId);
  audit(db, eventId, caps.userId, 'attachment_added', `${original} (${kind.replace('_', ' ')})`);
  return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) }, { status: 201 });
});
