/**
 * Backtesting: replay historical FCC batches, predict them blind, and compare
 * against what the FCC actually did.
 *
 * AE7Q and K2CR both assert their accuracy. Neither demonstrates it. Because
 * the ULS retains every resolved vanity request together with its preference
 * list and outcome, the honest thing is to measure.
 *
 * Method: take batches whose applications have all resolved, reconstruct each
 * applicant's preference list, run the same solver used for live predictions,
 * then score the predicted probability of the call each applicant actually
 * received. A well-calibrated model grants ~70% of the calls it rates 70%.
 */

import type { Database as DB } from 'better-sqlite3';
import { solveBatch, type RsdApplication } from './rsd';
import { filterCall } from './engine';
import { twoYearsAndADay } from '../fcc/availability';
import { HOLD_BYPASS_TYPES } from '../fcc/uls';

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface CalibrationBin {
  label: string;
  lo: number;
  hi: number;
  n: number;
  predicted: number;
  actual: number;
}

export interface BacktestResult {
  batches: number;
  applications: number;
  scored: number;
  brier: number;
  brierBase: number;
  brierSkill: number;
  meanAbsError: number;
  bins: CalibrationBin[];
}

interface Row {
  operator_class: string | null;
  state: string | null;
  request_type: string | null;
  usi: number;
  receipt_date: string;
  app_status: string;
  applicant_call: string | null;
  granted_call: string | null;
}

const BINS: Array<[number, number]> = [
  [0, 0.1],
  [0.1, 0.25],
  [0.25, 0.4],
  [0.4, 0.6],
  [0.6, 0.75],
  [0.75, 0.9],
  [0.9, 1.0001],
];

export function runBacktest(db: DB, opts: { maxBatches?: number; since?: string } = {}): BacktestResult {
  const since = opts.since ?? '2019-01-01';
  const maxBatches = opts.maxBatches ?? 400;

  // Batches where every application has reached a terminal state.
  const dates = db
    .prepare(
      `SELECT receipt_date, COUNT(*) n
       FROM application
       WHERE receipt_date >= ? AND app_status IN ('G','D','W')
       GROUP BY receipt_date
       HAVING n BETWEEN 2 AND 120
       ORDER BY receipt_date DESC
       LIMIT ?`,
    )
    .all(since, maxBatches) as Array<{ receipt_date: string; n: number }>;

  const appStmt = db.prepare(
    `SELECT usi, receipt_date, app_status, applicant_call, operator_class, state, request_type
     FROM application
     WHERE receipt_date = ? AND app_status IN ('G','D')`,
  );
  const prefStmt = db.prepare('SELECT call FROM application_call WHERE usi = ? ORDER BY seq');
  const periodStmt = db.prepare(
    'SELECT start_date, end_date FROM license_period WHERE call = ? ORDER BY start_date',
  );
  const periodCache = new Map<string, Array<{ start_date: string | null; end_date: string | null }>>();
  const lookupPeriods = (call: string) => {
    let p = periodCache.get(call);
    if (p === undefined) {
      p = periodStmt.all(call) as Array<{ start_date: string | null; end_date: string | null }>;
      periodCache.set(call, p);
    }
    return p;
  };

  /**
   * Was this call assignable on a historical receipt date?
   *
   * Replayed properly from every licence interval rather than guessed from a
   * current-state snapshot. A call is assignable on date D when no licence
   * covered D, and the most recent licence to end before D cleared its 2-year
   * hold before D.
   *
   * This is the whole reason the earlier backtest was overconfident: judging
   * history against today's snapshot treats a call as open whenever it happens
   * to be free *now*, even though it was held by someone at the time — so the
   * model credited applicants with choices that were already gone, and those
   * applications were in fact dismissed.
   */
  const wasAssignable = (call: string, receiptDate: string, bypassesHold: boolean): boolean => {
    const periods = lookupPeriods(call);
    if (periods.length === 0) return true; // never issued

    let lastEnd: string | null = null;
    for (const p of periods) {
      if (!p.start_date || p.start_date > receiptDate) continue;
      // Still open, or ended after the receipt date => held at that moment.
      if (p.end_date === null || p.end_date > receiptDate) return false;
      if (lastEnd === null || p.end_date > lastEnd) lastEnd = p.end_date;
    }
    if (lastEnd === null) return true; // nothing had started yet

    // Former holders and close relatives of a deceased holder may reclaim a
    // call inside the 2-year hold — that is the entire point of those request
    // types. Applying the hold to them marks a legitimate application as
    // hopeless and drags the low-probability bin badly out of calibration.
    if (bypassesHold) return true;

    return iso(twoYearsAndADay(Date.parse(lastEnd))) <= receiptDate;
  };

  let scored = 0;
  let brierSum = 0;
  let absSum = 0;
  let applications = 0;
  let grantedTotal = 0;
  const binAcc = BINS.map(([lo, hi]) => ({ lo, hi, n: 0, pSum: 0, hits: 0 }));

  // Replay batches in chronological chunks rather than one at a time. Batches
  // resolve on successive nights, so an earlier one takes contested calls
  // before a later one runs; scoring each in isolation credits later filers
  // with calls that were already gone. Chunking bounds the joint solve while
  // still modelling the ordering across neighbouring batches.
  const CHUNK = 25;
  const ordered = [...dates].sort((a, b) => a.receipt_date.localeCompare(b.receipt_date));

  for (let chunkStart = 0; chunkStart < ordered.length; chunkStart += CHUNK) {
    const chunk = ordered.slice(chunkStart, chunkStart + CHUNK);
    const tierOf = new Map<string, number>();
    chunk.forEach((d, i) => tierOf.set(d.receipt_date, i));

    // Withdrawn applications are excluded: withdrawal is the applicant's own
    // decision, not an outcome of the lottery, so scoring it would punish the
    // model for something it does not claim to predict.
    const apps: Row[] = [];
    for (const d of chunk) apps.push(...(appStmt.all(d.receipt_date) as Row[]));
    if (apps.length < 2) continue;

    const rsd: RsdApplication[] = [];
    const granted = new Map<number, boolean>();

    for (const a of apps) {
      const raw = (prefStmt.all(a.usi) as Array<{ call: string }>).map((r) => r.call);
      if (raw.length === 0) continue;

      // Apply the same eligibility gate the live predictor uses. Class, region,
      // reserved blocks and format are all reconstructible historically because
      // they depend on static callsign properties and on applicant attributes
      // recorded at filing time. Omitting this was the single largest source of
      // overconfidence: the model assumed everyone could hold their first
      // choice, when in practice a large share of dismissals are applicant
      // error rather than lottery loss.
      const bypassesHold = a.request_type != null && HOLD_BYPASS_TYPES.has(a.request_type);
      const prefs = raw.filter((call) => {
        const r = filterCall(call, {
          operatorClass: a.operator_class,
          state: a.state,
          receiptDate: a.receipt_date,
          availableDate: null, // hold is replayed from licence periods below
          licenseStatus: null,
          requestType: a.request_type,
        });
        return r.eligible && wasAssignable(call, a.receipt_date, bypassesHold);
      });

      granted.set(a.usi, a.app_status === 'G');
      // An empty list is still a real, scoreable prediction: we expect nothing.
      rsd.push({ id: String(a.usi), prefs, tier: tierOf.get(a.receipt_date) ?? 0 });
    }
    if (rsd.length < 2) continue;

    // Score only applications that actually face contention. A lone applicant
    // for a call nobody else wants is decided by eligibility and availability
    // on the historical receipt date — state we cannot faithfully reconstruct
    // from a current-state snapshot — not by the lottery. Including them would
    // measure our data gaps rather than the contention model.
    const contested = new Set<string>();
    {
      const demand = new Map<string, number>();
      for (const a of rsd) for (const c of new Set(a.prefs)) demand.set(c, (demand.get(c) ?? 0) + 1);
      for (const a of rsd) {
        if (a.prefs.some((c) => (demand.get(c) ?? 0) >= 2)) contested.add(a.id);
      }
    }
    if (contested.size < 2) continue;
    applications += rsd.length;

    const res = solveBatch(rsd);
    for (const o of res.outcomes) {
      if (!contested.has(o.appId)) continue;
      const usi = Number(o.appId);
      const got = granted.get(usi);
      if (got === undefined) continue;

      const pGotSomething = Object.values(o.byCall).reduce((s, x) => s + x, 0);
      const outcome = got ? 1 : 0;
      if (got) grantedTotal++;

      brierSum += (pGotSomething - outcome) ** 2;
      absSum += Math.abs(pGotSomething - outcome);
      scored++;

      const bin = binAcc.find((b) => pGotSomething >= b.lo && pGotSomething < b.hi);
      if (bin) {
        bin.n++;
        bin.pSum += pGotSomething;
        bin.hits += outcome;
      }
    }
  }

  const baseRate = scored ? grantedTotal / scored : 0;
  // Brier score of always predicting the base rate — the benchmark to beat.
  const brierBase = scored ? baseRate * (1 - baseRate) : 0;
  const brier = scored ? brierSum / scored : 0;

  return {
    batches: dates.length,
    applications,
    scored,
    brier,
    brierBase,
    brierSkill: brierBase > 0 ? 1 - brier / brierBase : 0,
    meanAbsError: scored ? absSum / scored : 0,
    bins: binAcc.map((b) => ({
      label: `${(b.lo * 100).toFixed(0)}–${(Math.min(b.hi, 1) * 100).toFixed(0)}%`,
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      predicted: b.n ? b.pSum / b.n : 0,
      actual: b.n ? b.hits / b.n : 0,
    })).filter((b) => b.n > 0),
  };
}
