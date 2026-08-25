import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT w.id, w.call, w.note, w.created_at,
              u.status, u.available_date, u.pending_count, u.format, u.region, u.grp,
              u.morse, u.desirability,
              (SELECT MAX(p) FROM prediction pr WHERE pr.call = w.call) p
       FROM user.watchlist w
       LEFT JOIN universe u ON u.call = w.call
       ORDER BY
         CASE WHEN u.status IN ('AVAILABLE','AVAILABLE_CONTESTED','NEVER_ISSUED') THEN 0
              WHEN u.status = 'PENDING' THEN 1 ELSE 2 END,
         COALESCE(u.available_date, '9999-12-31') ASC`,
    )
    .all();
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const { call, note } = (await req.json()) as { call: string; note?: string };
  if (!call) return NextResponse.json({ error: 'call required' }, { status: 400 });
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO user.watchlist (call, note) VALUES (?, ?)').run(call.toUpperCase(), note ?? null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const call = url.searchParams.get('call');
  if (!call) return NextResponse.json({ error: 'call required' }, { status: 400 });
  getDb().prepare('DELETE FROM user.watchlist WHERE call = ?').run(call.toUpperCase());
  return NextResponse.json({ ok: true });
}
