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

/** Compress image to JPEG, max 1024px on longest side, quality stepped down until < maxBytes. */
async function compressImage(file: File, maxBytes = 300_000): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1024;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);

      // Step quality down until we're under maxBytes
      const qualities = [0.80, 0.65, 0.50, 0.35];
      for (const q of qualities) {
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        const b64 = dataUrl.split(',')[1];
        if (b64.length * 0.75 <= maxBytes) {   // base64 → bytes approx
          resolve({ base64: b64, mediaType: 'image/jpeg' });
          return;
        }
      }
      // Last resort: smallest quality
      const dataUrl = canvas.toDataURL('image/jpeg', 0.25);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

export async function scanReceipt(file: File): Promise<any> {
  // Compress before sending — Railway proxy rejects bodies > ~1MB
  const { base64, mediaType } = await compressImage(file);

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
    throw new Error(`Server error (${res.status}): ${jsonErr?.message}`);
  }

  if (!res.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
