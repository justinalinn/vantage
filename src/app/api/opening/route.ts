import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { classCanHold, type OperatorClass } from '@/lib/callsign/groups';
import { filingDateFor } from '@/lib/fcc/timeline';

export const dynamic = 'force-dynamic';

/**
 * Calls whose hold is about to run out, and the exact day to file for each.
 *
 * This is the view the incumbent sites cannot build. They read a ULS status
 * letter to decide availability, and the FCC leaves that letter at "Active" for
 * the entire 2-year grace period — so a call that opens next Tuesday is
 * indistinguishable, to them, from one licensed until 2034. Computing the date
 * arithmetic instead turns ~82,000 calls with knowable opening dates into a
 * calendar.
 *
 * The date matters more than anything else on this site. Filing one day early
 * is dismissed outright and the $35 is not refunded; filing one day late loses
 * the call to whoever filed on day zero, because the FCC's lottery only ever
 * runs among applications sharing the earliest valid receipt date. There is
 * exactly one right day, and this endpoint's job is to name it.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get('days') ?? 120), 900);
  const formats = (url.searchParams.get('formats') ?? '').split(',').filter(Boolean);
  const region = url.searchParams.get('region');
  const cls = (url.searchParams.get('class') ?? '') as OperatorClass | '';
  const minDes = Number(url.searchParams.get('minDesirability') ?? 0);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 400), 2000);

  const where: string[] = [
    // Anything already open belongs in search, not in a calendar of future
    // dates. Frozen and withheld calls are excluded outright: their date is
    // meaningless because they are never granted to anybody.
    `u.status IN ('UPCOMING','EXPIRED_WAITING','CANCELED_WAITING')`,
    `u.available_date IS NOT NULL`,
    `u.available_date > date('now')`,
    `u.available_date <= date('now', '+' || ? || ' day')`,
    `u.region_locked = 0`,
  ];
  const params: unknown[] = [days];

  if (formats.length) {
    where.push(`u.format IN (${formats.map(() => '?').join(',')})`);
    params.push(...formats);
  }
  if (region) {
    where.push('u.region = ?');
    params.push(Number(region));
  }
  if (minDes > 0) {
    where.push('u.desirability >= ?');
    params.push(minDes);
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.call, u.format, u.grp, u.region, u.desirability, u.morse, u.status,
              u.available_date, u.pending_count,
              cs.entity_name, cs.expired_date, cs.avail_rule,
              (SELECT COUNT(*) FROM call_block cb WHERE cb.call = u.call AND cb.kind='RENEWAL') renewal_pending
         FROM universe u
         LEFT JOIN call_state cs ON cs.call = u.call
        WHERE ${where.join(' AND ')}
        ORDER BY u.available_date ASC, u.desirability DESC
        LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, any>>;

  const eligible = cls
    ? rows.filter((r) => classCanHold(cls as OperatorClass, r.grp))
    : rows;

  const out: Array<Record<string, any>> = eligible.map((r) => {
    const open = new Date(`${r.available_date}T00:00:00Z`);
    const filing = filingDateFor(open);
    return {
      ...r,
      // Everyone who files on the opening day shares a receipt date and goes
      // into the same draw. Filing even a day later is not a smaller chance, it
      // is no chance at all, so the countdown is to a deadline rather than to
      // an event.
      fileOn: filing.file,
      receipt: filing.receipt,
      daysUntil: Math.round((open.getTime() - Date.now()) / 86400000),
      // Applications already on file against a call that has not opened yet are
      // premature and will be dismissed — but they are a free read on demand.
      tooEarlyFilings: r.pending_count,
      frozen: r.renewal_pending > 0,
    };
  });

  // Grouped by date so the UI can render a calendar rather than a list; a user
  // planning a filing session cares about "what do I send on the 14th".
  const byDate = new Map<string, typeof out>();
  for (const r of out) {
    if (!byDate.has(r.available_date)) byDate.set(r.available_date, []);
    byDate.get(r.available_date)!.push(r);
  }

  return NextResponse.json({
    days,
    total: out.length,
    dates: [...byDate.entries()].map(([date, calls]) => ({
      date,
      fileOn: calls[0].fileOn,
      daysUntil: calls[0].daysUntil,
      calls,
    })),
  });
}
