export async function scanReceipt(file: File): Promise<any> {
  // Send raw file bytes directly — avoids canvas/FormData/base64 issues cross-browser
  const res = await fetch('/api/expenses/scan', {
    method: 'POST',
    headers: { 'x-file-type': file.type || 'image/jpeg' },
    body: file,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Scan failed');
  return data.expense;
}
