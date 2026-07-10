// Runs once when the Next.js server process starts (Railway keeps this
// process alive 24/7, so this background checker runs independently of any
// user/browser activity — no external cron service needed).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { checkAndSendReminders } = await import('./lib/reminders');

  const runCheck = () => {
    checkAndSendReminders()
      .then(({ sent24h, sent1h }) => {
        if (sent24h || sent1h) {
          console.log(`[reminders] sent ${sent24h} 24h-reminders, ${sent1h} 1h-reminders`);
        }
      })
      .catch(err => console.error('[reminders] check failed:', err));
  };

  setInterval(runCheck, 15 * 60 * 1000); // every 15 minutes
  setTimeout(runCheck, 30_000); // also run shortly after startup
}
