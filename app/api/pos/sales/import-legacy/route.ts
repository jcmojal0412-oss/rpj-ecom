import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "December 31, 2025 06:11 PM" → { date: "2025-12-31", datetime: "2025-12-31 18:11:00" }.
// Parsed by hand (no Date object) so the result never depends on the
// server's runtime timezone — the export's timestamps are already the
// business's own local wall-clock time and must land in the DB exactly as
// written, not shifted by however UTC-vs-PH happens to fall on this host.
function parseLegacyDate(raw: unknown): { date: string; datetime: string } | null {
  const m = String(raw ?? '').trim().match(/^(\w+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, monthName, day, year, hourStr, minute, ampm] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  let hour = parseInt(hourStr, 10) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(parseInt(day, 10))}`;
  return { date, datetime: `${date} ${pad(hour)}:${minute}:00` };
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '0').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

interface ParsedRow {
  external_ref: string; date: string; datetime: string;
  subtotal: number; discount: number; addFee: number; total: number;
  cash: number; online: number; change: number; qty: number;
  refText: string; fullName: string; empName: string;
}

// The export's row 0 is a merged title, row 1 is the real header, and the
// last row is a "TOTAL" summary line — found by content, not fixed indices,
// so a slightly different export layout doesn't silently misread columns.
function parseWorkbook(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const headerRowIdx = raw.findIndex(r => Array.isArray(r) && r.some(c => String(c).trim().toUpperCase() === 'TXNID'));
  if (headerRowIdx === -1) {
    return { rows: [], errors: ['Could not find a TXNID column — this doesn\'t look like a POS Sales Report export.'] };
  }
  const header = (raw[headerRowIdx] as unknown[]).map(h => String(h).trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    txnid: col('TXNID'), fullname: col('FULLNAME'), empname: col('EMPLOYEE NAME'), qty: col('TOTAL QUANTITY'),
    totalPrice: col('TOTAL PRICE'), addons: col('ADD-ONS PRICE'), orderFee: col('ORDER READY FEE'),
    discount: col('TOTAL DISCOUNT'), grand: col('GRAND TOTAL PRICE'),
    cash: col('CUSTOMER PAYMENT (CASH)'), online: col('CUSTOMER PAYMENT (ONLINE)'), change: col('CUSTOMER CHANGE'),
    refno: col('PAYMENT REF NO'), dateCheckout: col('DATE CHECKOUT'),
  };
  if (idx.txnid === -1 || idx.grand === -1 || idx.dateCheckout === -1) {
    return { rows: [], errors: ['Missing required columns (TXNID / GRAND TOTAL PRICE / DATE CHECKOUT).'] };
  }

  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    const txnid = String(r[idx.txnid] ?? '').trim();
    if (!txnid || txnid.toUpperCase() === 'TOTAL') continue;
    const parsedDate = parseLegacyDate(r[idx.dateCheckout]);
    if (!parsedDate) { errors.push(`Row ${i + 1}: unrecognized date "${r[idx.dateCheckout]}" — skipped.`); continue; }
    rows.push({
      external_ref: txnid,
      date: parsedDate.date, datetime: parsedDate.datetime,
      subtotal: num(r[idx.totalPrice]), discount: num(r[idx.discount]),
      addFee: num(r[idx.addons]) + num(r[idx.orderFee]),
      total: num(r[idx.grand]),
      cash: num(r[idx.cash]), online: num(r[idx.online]), change: num(r[idx.change]),
      qty: num(r[idx.qty]) || 1,
      refText: String(r[idx.refno] ?? '').trim(),
      fullName: String(r[idx.fullname] ?? '').trim(),
      empName: String(r[idx.empname] ?? '').trim(),
    });
  }
  return { rows, errors };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can import historical sales' }, { status: 403 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const mode = String(formData.get('mode') ?? 'preview');
    const businessName = String(formData.get('business_name') ?? 'Bodega ni Suki');

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ error: 'Please upload an Excel file (.xlsx or .xls)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, errors } = parseWorkbook(buffer);
    if (rows.length === 0) {
      return NextResponse.json({ error: errors[0] || 'No usable rows found in this file.' }, { status: 400 });
    }

    const db = getDb();
    const business = db.prepare('SELECT id FROM businesses WHERE name = ?').get(businessName) as { id: number } | undefined;
    if (!business) return NextResponse.json({ error: `Business "${businessName}" not found` }, { status: 400 });

    const existsStmt = db.prepare('SELECT 1 FROM pos_sales WHERE external_ref = ?');
    const newRows: ParsedRow[] = [];
    const duplicateRows: ParsedRow[] = [];
    for (const r of rows) {
      (existsStmt.get(r.external_ref) ? duplicateRows : newRows).push(r);
    }

    const dates = rows.map(r => r.date).sort();
    const summary = {
      total_rows: rows.length,
      new_count: newRows.length,
      duplicate_count: duplicateRows.length,
      parse_errors: errors.slice(0, 20),
      parse_error_count: errors.length,
      date_range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      total_revenue: newRows.reduce((s, r) => s + r.total, 0),
    };

    if (mode === 'preview') {
      return NextResponse.json({ preview: true, ...summary });
    }

    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, total, cash_amount, online_amount,
         change_due, status, cashier_id, notes, created_at, payment_method, reference_no, external_ref)
      VALUES (?,?,?,?,?,?,?,?,?, 'Completed', NULL, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, cogs, quantity, line_total)
      VALUES (?, NULL, ?, NULL, ?, 0, 1, ?)
    `);

    let imported = 0;
    runTransaction(() => {
      for (const r of newRows) {
        const paymentMethod =
          r.cash > 0 && r.online > 0 ? 'Cash + Online (Migrated)' :
          r.online > 0 ? 'Online' : r.cash > 0 ? 'Cash' : 'Unknown';
        const noteParts = [`Migrated from old POS (TXNID ${r.external_ref})`];
        if (r.fullName) noteParts.push(`Customer: ${r.fullName}`);
        if (r.empName) noteParts.push(`Staff: ${r.empName}`);

        const info = insertSale.run(
          business.id, r.date, r.subtotal, r.discount, r.addFee, r.total, r.cash, r.online, r.change,
          noteParts.join(' · '), r.datetime, paymentMethod, r.refText || null, r.external_ref,
        );
        const saleId = Number(info.lastInsertRowid);
        insertItem.run(saleId, `Migrated Sale — ${r.qty} item(s)`, r.subtotal, r.subtotal);
        imported++;
      }
    });

    return NextResponse.json({ imported, skipped_duplicates: duplicateRows.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
