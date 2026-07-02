export async function scanReceipt(file: File): Promise<any> {
  // Read as base64 on client — avoids iOS Safari FormData bug
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const mediaType = file.type || 'image/jpeg';

  const res = await fetch('/api/expenses/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base64, mediaType }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
