import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db     = getDb();
    const search = req.nextUrl.searchParams.get('q') ?? '';
    const filter = req.nextUrl.searchParams.get('status') ?? '';

    let sql = 'SELECT * FROM partners WHERE 1=1';
    const args: string[] = [];

    if (search) {
      sql += ' AND (name LIKE ? OR company_name LIKE ? OR email LIKE ? OR contact LIKE ?)';
      const q = `%${search}%`;
      args.push(q, q, q, q);
    }
    if (filter) {
      sql += ' AND remarks = ?';
      args.push(filter);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...args);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db   = getDb();
    const body = await req.json();
    const info = db.prepare(`
      INSERT INTO partners (name,contact,schedule,remarks,subscription,price,assist_by,commission,
        referred_by,contract_signing,onboarding,start_ads,company_name,email,bank,acct_name,acct_number,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      body.name, body.contact ?? null, body.schedule ?? null, body.remarks ?? 'PENDING',
      body.subscription ?? null, body.price ?? 0, body.assist_by ?? null, body.commission ?? null,
      body.referred_by ?? null, body.contract_signing ?? null, body.onboarding ?? null,
      body.start_ads ?? null, body.company_name ?? null, body.email ?? null,
      body.bank ?? null, body.acct_name ?? null, body.acct_number ?? null, body.notes ?? null
    );
    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
