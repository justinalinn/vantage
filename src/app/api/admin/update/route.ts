import { NextResponse } from 'next/server';
import { getDb, getMeta } from '@/lib/db';
import { authorize } from '@/lib/uls/auth';
import { startJob, readLock, tailLog, type JobKind } from '@/lib/uls/runner';
import { getSchedule, scrapeDue } from '@/lib/uls/schedule';

export const dynamic = 'force-dynamic';

/** Current state of both jobs, plus enough log to see what happened. */
export function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });

  const db = getDb();
  const bulk = readLock(db, 'bulk');
  const scrape = readLock(db, 'scrape');
  const last = db
    .prepare('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 5')
    .all();

  return NextResponse.json({
    schedule: getSchedule(db),
    running: { bulk: !!bulk, scrape: !!scrape },
    startedAt: { bulk: bulk?.startedAt ?? null, scrape: scrape?.startedAt ?? null },
    lastBulkCheck: getMeta(db, 'last_bulk_check'),
    lastRefresh: getMeta(db, 'last_refresh'),
    lastScrape: getMeta(db, 'last_scrape'),
    scrapeDue: scrapeDue(db),
    awaitingPrefs: (
      db.prepare('SELECT COUNT(*) c FROM application_unlisted').get() as { c: number }
    ).c,
    scrapeHistory: last,
    log: { bulk: tailLog('bulk', 30), scrape: tailLog('scrape', 30) },
  });
}

/** Start a job now, ignoring the interval and the off-hours window. */
export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { what?: string };
  const what = body.what ?? 'bulk';
  if (what !== 'bulk' && what !== 'scrape') {
    return NextResponse.json({ error: 'what must be "bulk" or "scrape"' }, { status: 400 });
  }

  const db = getDb();
  // --now on the scrape bypasses both the interval and the courtesy window,
  // because an explicit button press is an explicit instruction.
  const r = startJob(db, what as JobKind, what === 'scrape' ? ['--now'] : []);
  return NextResponse.json(r, { status: r.ok ? 202 : 409 });
}
