/**
 * Preference-list optimisation.
 *
 * The FCC lets you rank up to 25 callsigns. Because the batch is processed in
 * random order and each applicant takes the first *still-available* call on
 * their list, the ordering question has a clean answer that most operators get
 * backwards.
 *
 * Claim: to maximise expected satisfaction, order strictly by how much you want
 * each call — never by how likely you are to get it.
 *
 * Proof sketch (adjacent exchange). Let reach R be the probability you are
 * still unassigned when slot i is considered, u_i your utility for that call and
 * p_i your chance of winning it. Comparing the two orderings of an adjacent
 * pair:
 *
 *   order (i,j):  R * [ u_i p_i + u_j p_j (1 - p_i) ]
 *   order (j,i):  R * [ u_j p_j + u_i p_i (1 - p_j) ]
 *
 *   (i,j) is better  <=>  -u_j p_j p_i > -u_i p_i p_j  <=>  u_i > u_j
 *
 * The probabilities cancel exactly. Putting a long-shot first therefore costs
 * you nothing: if you lose it you simply fall through to the next entry. The
 * only real cost of a bad list is leaving *slots empty*.
 *
 * `verifyOrderingTheorem` checks this against the exact RSD solver rather than
 * taking the algebra on faith, because the real model shares one random
 * position across all of an applicant's choices and so is not independent.
 */

import { simulateEntry, solveBatch, type RsdApplication } from './rsd';

export interface Candidate {
  call: string;
  /** 0-100 desirability, the "utility" in the exchange argument. */
  utility: number;
  /** Competing pending applications that rank this call, as preference lists. */
  field?: RsdApplication[];
}

export interface SlotMetric {
  rank: number;
  call: string;
  utility: number;
  /** P(you are granted this specific call). */
  p: number;
  /** P(you are still unassigned when this slot is reached). */
  reachBefore: number;
  /** Increase in P(get anything) contributed by adding this slot. */
  marginal: number;
}

export interface PortfolioResult {
  slots: SlotMetric[];
  pFirst: number;
  pTop3: number;
  pAny: number;
  /** Expected utility of the outcome. */
  expectedUtility: number;
  method: string;
  ciHalfWidth: number;
}

/**
 * Merge the competitive fields of every candidate into one batch. Competitors
 * are deduplicated by id because one rival application can contest several of
 * your choices at once — that coupling is exactly what the solver handles.
 */
function mergeField(cands: Candidate[]): RsdApplication[] {
  const byId = new Map<string, RsdApplication>();
  for (const c of cands) {
    for (const f of c.field ?? []) {
      if (!byId.has(f.id)) byId.set(f.id, f);
    }
  }
  return [...byId.values()];
}

export function evaluatePortfolio(order: Candidate[]): PortfolioResult {
  if (order.length === 0) {
    return { slots: [], pFirst: 0, pTop3: 0, pAny: 0, expectedUtility: 0, method: 'trivial', ciHalfWidth: 0 };
  }
  const field = mergeField(order);
  const prefs = order.map((c) => c.call);
  const res = simulateEntry(field, prefs);

  // A slot's marginal contribution to P(get anything) is exactly its own win
  // probability, because the outcomes are mutually exclusive — you are granted
  // at most one call — so P(any) is the sum of the per-call probabilities.
  //
  // The earlier implementation re-solved the whole batch once per slot to
  // difference the cumulative curve. That is O(n) solves for an answer already
  // contained in the first one, and with 25 slots against a large contested
  // field it took long enough to look like the page had hung.
  let reach = 1;
  const slots: SlotMetric[] = order.map((c, i) => {
    const p = res.pByCall[c.call] ?? 0;
    const s: SlotMetric = { rank: i + 1, call: c.call, utility: c.utility, p, reachBefore: reach, marginal: p };
    reach = Math.max(0, reach - p);
    return s;
  });

  const pTop3 = slots.slice(0, 3).reduce((s, x) => s + x.p, 0);
  const expectedUtility = slots.reduce((s, x) => s + x.utility * x.p, 0);

  return {
    slots,
    pFirst: slots[0]?.p ?? 0,
    pTop3,
    pAny: res.pAny,
    expectedUtility,
    method: res.method,
    ciHalfWidth: res.ciHalfWidth,
  };
}

/**
 * The optimal ordering: strictly descending utility. Ties break toward the
 * call you are more likely to actually win, which changes nothing about
 * expected utility but tightens the distribution.
 */
export function optimizeOrder(cands: Candidate[]): Candidate[] {
  const field = mergeField(cands);
  const solo = new Map<string, number>();
  for (const c of cands) {
    solo.set(c.call, simulateEntry(field, [c.call]).pAny);
  }
  return [...cands].sort((a, b) => {
    if (b.utility !== a.utility) return b.utility - a.utility;
    return (solo.get(b.call) ?? 0) - (solo.get(a.call) ?? 0);
  });
}

export interface OptimizeDiff {
  before: PortfolioResult;
  after: PortfolioResult;
  order: Candidate[];
  moved: number;
}

export function optimizeWithDiff(cands: Candidate[]): OptimizeDiff {
  const before = evaluatePortfolio(cands);
  const order = optimizeOrder(cands);
  const after = evaluatePortfolio(order);
  let moved = 0;
  for (let i = 0; i < order.length; i++) if (order[i].call !== cands[i]?.call) moved++;
  return { before, after, order, moved };
}

/**
 * Empirically checks the ordering claim against the exact solver on random
 * instances. Returns the fraction of trials where descending-utility was at
 * least as good as every permutation tried.
 */
export function verifyOrderingTheorem(trials = 200, seed = 7): { checked: number; violations: number; worstGap: number } {
  let rng = seed;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  let violations = 0;
  let worstGap = 0;
  let checked = 0;

  for (let t = 0; t < trials; t++) {
    const n = 2 + Math.floor(rand() * 3); // 2..4 of my slots
    const calls = Array.from({ length: n }, (_, i) => `C${i}`);
    const utility = calls.map(() => Math.round(rand() * 100));

    // Random rival field over the same calls.
    const rivals: RsdApplication[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
      id: `r${i}`,
      prefs: calls.filter(() => rand() < 0.7),
    })).filter((r) => r.prefs.length > 0);

    const cands: Candidate[] = calls.map((c, i) => ({ call: c, utility: utility[i], field: rivals }));
    const best = evaluatePortfolio(optimizeOrder(cands)).expectedUtility;

    // Compare against every permutation.
    const perm = (arr: Candidate[], k: number) => {
      if (k === arr.length) {
        const eu = evaluatePortfolio(arr).expectedUtility;
        checked++;
        if (eu > best + 1e-9) {
          violations++;
          worstGap = Math.max(worstGap, eu - best);
        }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        perm(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    perm([...cands], 0);
  }

  return { checked, violations, worstGap };
}

/** Pending rival applications that rank any of these calls. */
export function fieldForCalls(
  db: import('better-sqlite3').Database,
  calls: string[],
  pendingStatus: string,
): RsdApplication[] {
  if (calls.length === 0) return [];
  const placeholders = calls.map(() => '?').join(',');
  const usis = db
    .prepare(
      `SELECT DISTINCT a.usi FROM application a
       JOIN application_call ac ON ac.usi = a.usi
       WHERE a.app_status = ? AND ac.call IN (${placeholders})`,
    )
    .all(pendingStatus, ...calls) as Array<{ usi: number }>;

  const prefStmt = db.prepare('SELECT call FROM application_call WHERE usi = ? ORDER BY seq');
  return usis.map((u) => ({
    id: String(u.usi),
    prefs: (prefStmt.all(u.usi) as Array<{ call: string }>).map((r) => r.call),
  }));
}
