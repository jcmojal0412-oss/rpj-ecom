import path from 'path';

// Where calendar attachments live: next to the database on the Railway volume, or in
// ./calendar-attachments locally. Never under /public — files are served only through
// the access-checked /api/calendar/attachments/[id].
export const CALENDAR_FILE_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'calendar-attachments')
  : path.join(process.cwd(), 'calendar-attachments');
