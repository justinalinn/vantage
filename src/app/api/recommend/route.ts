import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CLASS_ELIGIBLE_GROUPS, type OperatorClass } from '@/lib/callsign/groups';
import { desirability, DEFAULT_WEIGHTS, type PersonalContext } from '@/lib/callsign/desirability';
import { regionForState } from '@/lib/callsign/regions';

export const dynamic = 'force-dynamic';

/**
 * Builds a ready-to-file preference list of up to 25 callsigns.
 *
 * The interesting part is which calls are eligible for inclusion. A call with
 * twenty pending applications is normally treated as hopeless, but that reads
 * the board wrong: applicants rank up to 25 calls each, and the moment one is
 * granted their top choice, every call below it on their list is released. So
 * the question is not "how many people applied" but "how much of this call is
 * actually spoken for" — which the solver already answers, because summing each
 * applicant's win probability for a call gives exactly the share claimed.
 *
 * Calls the raw counts make look contested are frequently near-certain to
 * survive. Those are the bargains, and no other tool surfaces them.
 */

interface Body {
  operatorClass?: OperatorClass;
  state?: string;
  formats?: string[];
  regions?: number[];
  initials?: string;
  keywords?: string[];
  /** Minimum acceptable chance the call is still unclaimed. */
  minSurvival?: number;
  count?: number;
  /** Exclude calls that require moving house. */
  excludeRegionLocked?: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const db = getDb();

  const count = Math.min(Math.max(body.count ?? 25, 1), 25);
  const minSurvival = body.minSurvival ?? 0.5;
  const groups = body.operatorClass ? CLASS_ELIGIBLE_GROUPS[body.operatorClass] : ['A', 'B', 'C', 'D'];
  const homeRegion = body.state ? regionForState(body.state) : null;

  const where: string[] = [
    `u.status IN ('NEVER_ISSUED','AVAILABLE','AVAILABLE_CONTESTED')`,
    `u.grp IN (${groups.map(() => '?').join(',')})`,
    `u.survive_p >= ?`,
  ];
  const params: unknown[] = [...groups, minSurvival];

  if (body.excludeRegionLocked !== false) where.push('u.region_locked = 0');
  if (body.formats?.length) {
    where.push(`u.format IN (${body.formats.map(() => '?').join(',')})`);
    params.push(...body.formats);
  }
  if (body.regions?.length) {
    where.push(`u.region IN (${body.regions.map(() => '?').join(',')})`);
    params.push(...body.regions);
  }

  // Pull a generous pool, then re-rank with the personal weighting the caller
  // supplied — that part cannot be expressed in SQL.
  const pool = db
    .prepare(
      `SELECT call, format, region, grp, status, morse, phonetic, desirability,
              pending_count, eligible_pending, claimed_p, survive_p, available_date
       FROM universe u
       WHERE ${where.join(' AND ')}
       ORDER BY u.desirability DESC
       LIMIT 4000`,
    )
    .all(...params) as Array<Record<string, any>>;

  const ctx: PersonalContext = {
    initials: body.initials,
    keywords: body.keywords,
    homeRegion: homeRegion ?? undefined,
  };

  type Scored = Record<string, any>;
  const scored: Scored[] = pool.map((r) => {
    const call = r.call as string;
    const d = desirability(call, DEFAULT_WEIGHTS, ctx);
    const survive = r.survive_p as number;
    return {
      ...r,
      desirability: d.score,
      notes: d.notes,
      // What the slot is actually worth: how much you want it, discounted by
      // the chance it is still there when your batch runs.
      expected: d.score * survive,
    };
  });

  scored.sort((a, b) => b.expected - a.expected);
  const picked = scored.slice(0, count);

  // File in descending desirability. Losing a long shot at slot 1 costs
  // nothing, because you fall straight through to the next entry.
  picked.sort((a, b) => b.desirability - a.desirability);

  const bargains = picked.filter((p) => p.pending_count > 0 && p.survive_p >= 0.9).length;

  return NextResponse.json({
    slots: picked.map((p, i) => ({ rank: i + 1, ...p })),
    poolSize: scored.length,
    bargains,
    minSurvival,
    operatorClass: body.operatorClass ?? null,
    homeRegion,
  });
}
