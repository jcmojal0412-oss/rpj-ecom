// Runs once when the Next.js server process starts (Railway keeps this
// process alive 24/7, so this background checker runs independently of any
// user/browser activity — no external cron service needed).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { checkAndSendReminders } = await import('./lib/reminders');

  const runCheck = () => {
    checkAndSendReminders()
      .then(({ sent24h, sent1h, sms24h, sms1h }) => {
        if (sent24h || sent1h || sms24h || sms1h) {
          console.log(`[reminders] sent ${sent24h} 24h-emails, ${sent1h} 1h-emails, ${sms24h} 24h-sms, ${sms1h} 1h-sms`);
        }
      })
      .catch(err => console.error('[reminders] check failed:', err));
  };

  setInterval(runCheck, 15 * 60 * 1000); // every 15 minutes
  setTimeout(runCheck, 30_000); // also run shortly after startup

  const { runAttendanceJobs } = await import('./lib/attendance-jobs');

  const runAttendance = () => {
    runAttendanceJobs()
      .then(({ otFlagged, absencesFlagged }) => {
        if (otFlagged || absencesFlagged) {
          console.log(`[attendance] flagged ${otFlagged} OT request(s), ${absencesFlagged} absence(s)`);
        }
      })
      .catch(err => console.error('[attendance] job failed:', err));
  };

  setInterval(runAttendance, 15 * 60 * 1000); // every 15 minutes
  setTimeout(runAttendance, 45_000); // offset from the reminders job so they don't both hit the DB on the same tick
}
