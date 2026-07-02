/** Normalize AI-returned dates to YYYY-MM-DD, or return empty string. */
export function normalizeDateToISO(raw: string | null | undefined): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
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
  // Step 1: upload file as multipart FormData (no base64 body size issue)
  const fd = new FormData();
  fd.append('file', file);

  let uploadRes: Response;
  try {
    uploadRes = await fetch('/api/upload/receipt', { method: 'POST', body: fd });
  } catch (e: any) {
    throw new Error('Upload failed: ' + (e?.message ?? String(e)));
  }

  if (!uploadRes.ok) {
    const d = await uploadRes.json().catch(() => ({}));
    throw new Error(d.error || `Upload failed (${uploadRes.status})`);
  }

  const { filename } = await uploadRes.json();
  if (!filename) throw new Error('Upload succeeded but no filename returned.');

  // Step 2: ask server to scan the already-saved file (tiny JSON body)
  let scanRes: Response;
  try {
    scanRes = await fetch('/api/expenses/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
  } catch (e: any) {
    throw new Error('Scan request failed: ' + (e?.message ?? String(e)));
  }

  let data: any;
  try {
    data = await scanRes.json();
  } catch (e: any) {
    throw new Error(`Server error (${scanRes.status}): ${e?.message}`);
  }

  if (!scanRes.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
