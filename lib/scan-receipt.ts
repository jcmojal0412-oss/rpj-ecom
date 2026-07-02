/** Normalize AI-returned dates to YYYY-MM-DD, or return empty string. */
export function normalizeDateToISO(raw: string | null | undefined): string {
  if (!raw) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  // Try native Date parse (handles "Jul 2, 2026", "02 Jul 2026", "July 2, 2026", "2026/07/02", etc.)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

export async function scanReceipt(file: File): Promise<any> {
  // Convert to base64 via FileReader — most compatible across iOS Safari & Chrome
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:image/jpeg;base64,XXXX" — strip the prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('FileReader failed: ' + reader.error?.message));
    reader.readAsDataURL(file);
  });

  const mediaType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';

  let res: Response;
  try {
    res = await fetch('/api/expenses/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mediaType }),
    });
  } catch (fetchErr: any) {
    throw new Error('Network error: ' + (fetchErr?.message ?? String(fetchErr)));
  }

  let data: any;
  try {
    data = await res.json();
  } catch (jsonErr: any) {
    throw new Error(`Server error (${res.status}) — response not JSON: ${jsonErr?.message}`);
  }

  if (!res.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
