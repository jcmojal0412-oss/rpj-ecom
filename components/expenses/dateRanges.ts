// Shared by the Dashboard and Transactions tabs so both preset rows resolve
// identically — a local copy per tab would drift over time.
export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const DATE_PRESETS = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month', 'This Year', 'Custom'] as const;
export type DatePreset = typeof DATE_PRESETS[number];

export function resolvePresetRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const today = toLocalISO(now);

  if (preset === 'Today') return { from: today, to: today };

  if (preset === 'Yesterday') {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    const ys = toLocalISO(y);
    return { from: ys, to: ys };
  }

  if (preset === 'This Week' || preset === 'Last Week') {
    const day = now.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now); monday.setDate(now.getDate() + diff - (preset === 'Last Week' ? 7 : 0));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return { from: toLocalISO(monday), to: toLocalISO(sunday) };
  }

  if (preset === 'This Month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toLocalISO(from), to: toLocalISO(to) };
  }

  if (preset === 'Last Month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toLocalISO(from), to: toLocalISO(to) };
  }

  if (preset === 'This Year') {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear(), 11, 31);
    return { from: toLocalISO(from), to: toLocalISO(to) };
  }

  // Custom
  return { from: customFrom || today, to: customTo || today };
}
