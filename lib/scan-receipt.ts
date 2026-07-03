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

/** Compress image to JPEG blob under targetBytes using canvas. */
function compressToBlob(file: File, targetBytes = 120_000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 800;
      let w = img.naturalWidth  || img.width;
      let h = img.naturalHeight || img.height;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w || 1;
      canvas.height = h || 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);

      const qualities = [0.8, 0.65, 0.5, 0.4, 0.3, 0.2];
      const tryNext = (idx: number) => {
        const q = qualities[idx] ?? 0.2;
        canvas.toBlob(b => {
          if (!b) { reject(new Error('toBlob failed')); return; }
          if (b.size <= targetBytes || idx >= qualities.length - 1) resolve(b);
          else tryNext(idx + 1);
        }, 'image/jpeg', q);
      };
      tryNext(0);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/** Read a Blob as base64 string (no data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('FileReader error: ' + reader.error?.message));
    reader.readAsDataURL(blob);
  });
}

/** POST JSON via XHR — avoids iOS Safari fetch quirks. */
function xhrPost(url: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 60_000;

    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new Error((d.error || `HTTP ${xhr.status}`) + ' (' + xhr.status + ')'));
      } catch {
        reject(new Error(`Server error (${xhr.status}): ` + xhr.responseText.slice(0, 120)));
      }
    };
    xhr.onerror   = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timed out'));
    xhr.send(JSON.stringify(payload));
  });
}

/** Scan a receipt image: compress → base64 → AI extract → return fields. */
export async function scanReceipt(file: File): Promise<any> {
  // Compress to ~120KB
  let blob: Blob;
  try {
    blob = await compressToBlob(file);
  } catch (e: any) {
    throw new Error('Compress failed: ' + (e?.message ?? String(e)));
  }

  // Convert to base64
  let base64: string;
  try {
    base64 = await blobToBase64(blob);
  } catch (e: any) {
    throw new Error('Encode failed: ' + (e?.message ?? String(e)));
  }

  // Send directly to scan endpoint — no upload step, no file storage
  const data = await xhrPost('/api/expenses/scan', { base64, mediaType: 'image/jpeg' });
  return data.expense;
}
