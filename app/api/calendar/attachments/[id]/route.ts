import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, attachmentAccess, audit } from '@/lib/calendar-service';
import { CALENDAR_FILE_DIR } from '@/lib/calendar-files';

// Only someone who may see the schedule in full can open its files.
export const GET = calendarRoute<{ id: string }>(async (_req, { db, caps }, { id }) => {
  const access = attachmentAccess(db, caps, idOf(id));
  if (!access) throw new CalendarError('File not found.', 404);
  const a = access.attachment;
  let buffer: Buffer;
  try { buffer = await readFile(path.join(CALENDAR_FILE_DIR, path.basename(a.stored_name))); } catch { throw new CalendarError('File not found.', 404); }
  const inline = /^(image\/|application\/pdf)/.test(a.mime_type || '');
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': a.mime_type || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.original_name.replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    },
  });
}, { maintain: false });

export const DELETE = calendarRoute<{ id: string }>(async (_req, { db, caps }, { id }) => {
  const access = attachmentAccess(db, caps, idOf(id));
  if (!access) throw new CalendarError('File not found.', 404);
  if (!access.canDelete) throw new CalendarError('You do not have permission to remove this file.', 403);
  db.prepare("UPDATE calendar_event_attachments SET deleted_at = datetime('now') WHERE id = ?").run(access.attachment.id);
  audit(db, access.attachment.event_id, caps.userId, 'attachment_removed', access.attachment.original_name);
  return NextResponse.json({ ok: true });
});
