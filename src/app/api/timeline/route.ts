import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { filingOptions, stagesFor, timelineFor } from '@/lib/fcc/timeline';
import { PENDING_STATUS } from '@/lib/fcc/uls';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const filed = fromParam ? new Date(`${fromParam}T00:00:00Z`) : new Date();

  const tl = timelineFor(filed);
  const options = filingOptions(new Date(), 21);

  // How crowded is each candidate receipt date already?
  const db = getDb();
  const counts = new Map<string, number>(
    (
      db
        .prepare('SELECT receipt_date, COUNT(*) c FROM application WHERE app_status = ? GROUP BY receipt_date')
        .all(PENDING_STATUS) as Array<{ receipt_date: string; c: number }>
    ).map((r) => [r.receipt_date, r.c]),
  );

  return NextResponse.json({
    timeline: tl,
    stages: stagesFor(tl),
    options: options.map((o) => ({ ...o, knownCompetitors: counts.get(o.receipt) ?? 0 })),
  });
}
