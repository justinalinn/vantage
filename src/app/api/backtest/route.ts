import { NextResponse } from 'next/server';
import { getDb, getMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Serves the cached backtest. Running it live would take minutes, so it is
 * computed by `npm run backtest` and stored in meta.
 */
export function GET() {
  const db = getDb();
  const raw = getMeta(db, 'backtest');
  if (!raw) {
    return NextResponse.json({ error: 'no backtest cached — run `npm run backtest`' }, { status: 404 });
  }
  return NextResponse.json({ ...JSON.parse(raw), computedAt: getMeta(db, 'backtest_at') });
}
