// Quick date ranges for the attendance filters. All maths is done on UTC
// midnights of plain YYYY-MM-DD strings, so the server/browser timezone can
// never shift a day.
const DAY = 86_400_000;

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => fmt(parse(iso) + n * DAY);
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
// Monday of the week containing `iso`.
const mondayOf = (iso: string) => {
  const dow = new Date(parse(iso)).getUTCDay(); // 0 = Sun
  return addDays(iso, -((dow + 6) % 7));
};

export interface DatePreset { key: string; label: string; from: string; to: string }

// Payroll here runs semi-monthly (1st-15th and 16th-end of month), so the
// two cutoff presets are the ones that matter most when reviewing pay.
export function getDatePresets(today: string): DatePreset[] {
  const day = Number(today.slice(8, 10));
  const prevMonthEnd = addDays(firstOfMonth(today), -1);

  const cutoffs = day <= 15
    ? {
        thisFrom: firstOfMonth(today), thisTo: today,
        lastFrom: `${prevMonthEnd.slice(0, 7)}-16`, lastTo: prevMonthEnd,
      }
    : {
        thisFrom: `${today.slice(0, 7)}-16`, thisTo: today,
        lastFrom: firstOfMonth(today), lastTo: `${today.slice(0, 7)}-15`,
      };

  const thisMonday = mondayOf(today);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: 'last7', label: 'Last 7 Days', from: addDays(today, -6), to: today },
    { key: 'thisweek', label: 'This Week', from: thisMonday, to: today },
    { key: 'lastweek', label: 'Last Week', from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
    { key: 'thiscutoff', label: 'This Cutoff', from: cutoffs.thisFrom, to: cutoffs.thisTo },
    { key: 'lastcutoff', label: 'Last Cutoff', from: cutoffs.lastFrom, to: cutoffs.lastTo },
    { key: 'thismonth', label: 'This Month', from: firstOfMonth(today), to: today },
    { key: 'lastmonth', label: 'Last Month', from: firstOfMonth(prevMonthEnd), to: prevMonthEnd },
  ];
}

// Rendered with the actual dates so the two cutoffs aren't ambiguous.
export function describeRange(p: DatePreset): string {
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
}
