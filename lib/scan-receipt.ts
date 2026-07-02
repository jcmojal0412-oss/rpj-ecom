// Resize image using canvas before sending to AI (avoids large payload issues on iOS)
function resizeToBase64(file: File, maxPx = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not available'));
      ctx.drawImage(img, 0, 0, w, h);
      // Export as jpeg, quality 0.85
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.split(',')[1]); // return base64 only
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

export async function scanReceipt(file: File): Promise<any> {
  const base64 = await resizeToBase64(file);

  const res = await fetch('/api/expenses/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base64, mediaType: 'image/jpeg' }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
