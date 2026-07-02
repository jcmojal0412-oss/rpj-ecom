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

/** Upload via XHR — avoids iOS Safari fetch quirks with FormData/binary bodies */
function xhrUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/receipt');
    xhr.timeout = 30000;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.filename) { resolve(data.filename); return; }
          reject(new Error('Upload OK but no filename: ' + xhr.responseText.slice(0, 120)));
        } catch {
          reject(new Error('Upload response not JSON (' + xhr.status + '): ' + xhr.responseText.slice(0, 120)));
        }
      } else {
        reject(new Error('Upload failed (' + xhr.status + '): ' + xhr.responseText.slice(0, 120)));
      }
    };
    xhr.onerror   = () => reject(new Error('Upload network error (XHR)'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

export async function scanReceipt(file: File): Promise<any> {
  // Step 1: upload file via XHR (more reliable on iOS Safari than fetch+FormData)
  const filename = await xhrUpload(file);

  // Step 2: send filename only — tiny JSON body, server reads from disk
  let scanRes: Response;
  try {
    scanRes = await fetch('/api/expenses/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
  } catch (e: any) {
    throw new Error('Scan fetch failed: ' + (e?.message ?? String(e)));
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
