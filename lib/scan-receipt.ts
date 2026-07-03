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

/**
 * Compress image via canvas to a JPEG Blob under targetBytes.
 * Targets small output so uploads stay lightweight.
 */
function compressToBlob(file: File, targetBytes = 150_000): Promise<Blob> {
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
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);

      const tryQuality = (qualities: number[]): void => {
        if (!qualities.length) {
          // Last resort
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.3);
          return;
        }
        const [q, ...rest] = qualities;
        canvas.toBlob(b => {
          if (!b) { reject(new Error('toBlob failed')); return; }
          if (b.size <= targetBytes || !rest.length) { resolve(b); }
          else { tryQuality(rest); }
        }, 'image/jpeg', q);
      };
      tryQuality([0.8, 0.65, 0.5, 0.4, 0.3]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/** Upload a Blob via XHR and return the saved filename. */
function xhrUpload(blob: Blob, originalName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/receipt');
    xhr.timeout = 30_000;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const d = JSON.parse(xhr.responseText);
          if (d.filename) resolve(d.filename);
          else reject(new Error('No filename in upload response: ' + xhr.responseText.slice(0, 100)));
        } catch {
          reject(new Error('Upload response not JSON (' + xhr.status + '): ' + xhr.responseText.slice(0, 100)));
        }
      } else {
        reject(new Error('Upload failed (' + xhr.status + '): ' + xhr.responseText.slice(0, 100)));
      }
    };
    xhr.onerror   = () => reject(new Error('Upload network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    const fd = new FormData();
    fd.append('file', blob, originalName.replace(/\.[^.]+$/, '.jpg'));
    xhr.send(fd);
  });
}

/** Scan a receipt image: compress → upload → AI read → return extracted fields. */
export async function scanReceipt(file: File): Promise<any> {
  // Compress to ~150KB before uploading — prevents crash on server
  let blob: Blob;
  try {
    blob = await compressToBlob(file);
  } catch (e: any) {
    throw new Error('Compress failed: ' + (e?.message ?? String(e)));
  }

  // Upload the compressed file
  const filename = await xhrUpload(blob, file.name);

  // Ask server to scan the (small) saved file
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
    throw new Error('Scan response error (' + scanRes.status + '): ' + (e?.message ?? 'not JSON'));
  }

  if (!scanRes.ok) throw new Error(data.error || 'Scan failed (' + scanRes.status + ')');
  return data.expense;
}
