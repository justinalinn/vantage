/**
 * Random Serial Dictatorship — the exact model of an FCC vanity batch.
 *
 * Every application sharing a receipt date is processed in uniformly random
 * order. Each application in turn takes the highest-ranked call on its
 * preference list that is still unassigned; if none remain it is dismissed.
 * That is textbook serial dictatorship under a uniformly random priority order.
 *
 * Naive evaluation enumerates all N! orders. Instead we recurse on
 * (remaining applications, already-taken calls) and memoize. Because the first
 * application processed is uniform over those remaining:
 *
 *   M(A, T) = 1/|A| * SUM over a in A of [ a takes c_a(T), then M(A\{a}, T + c_a) ]
 *
 * Distinct reachable states are vastly fewer than |A|!, so this returns exact
 * marginals for batches far larger than permutation enumeration can reach. We
 * fall back to Monte Carlo only when the state space genuinely explodes, and
 * then we report a confidence interval rather than a bare number.
 */

export interface RsdApplication {
  id: string;
  /** Ordered preference list, already filtered to calls this applicant may hold. */
  prefs: string[];
  /**
   * Processing priority. Lower tiers are processed strictly before higher ones;
   * order is uniformly random *within* a tier.
   *
   * This models the fact that batches resolve on different nights. An applicant
   * whose receipt date is a day earlier has their whole batch processed first,
   * so they take contested calls before a later batch ever runs — the FCC's
   * "Too Late" dismissal. Treating each batch as an isolated lottery ignores
   * that and badly overstates the odds for later filers.
   *
   * Defaults to 0, which makes every applicant a single tier and reduces to
   * plain random serial dictatorship.
   */
  tier?: number;
}

export interface RsdOutcome {
  appId: string;
  /** P(this application is granted this call). */
  byCall: Record<string, number>;
  /** P(this application is dismissed with nothing). */
  pNothing: number;
  /**
   * How *this* application's own component was solved. Carried per outcome
   * rather than per batch: components are independent, so one component
   * needing to be sampled says nothing about the rest, and reporting a single
   * batch-wide method would mislabel exact answers as estimates.
   */
  method: RsdMethod;
  /** Half-width of the 95% interval for this outcome; 0 when exact. */
  ci: number;
}

export type RsdMethod = 'exact' | 'monte-carlo' | 'trivial';

export interface RsdResult {
  outcomes: RsdOutcome[];
  method: RsdMethod;
  /** Memoized states visited (exact) or samples drawn (Monte Carlo). */
  work: number;
  /** Half-width of the 95% interval; 0 when exact. */
  ciHalfWidth: number;
}

/** Above this many memo entries we abandon exactness and sample instead. */
const MAX_STATES = 1_500_000;
const MC_SAMPLES = 200_000;

/**
 * Split applications into independent groups. Two applications interact only
 * if they can reach a shared call, directly or transitively. Components are
 * almost always tiny, which is what makes exact solving practical.
 */
export function connectedComponents(apps: RsdApplication[]): RsdApplication[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const nxt = parent.get(x)!;
      parent.set(x, r);
      x = nxt;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const a of apps) {
    const key = `app:${a.id}`;
    if (!parent.has(key)) parent.set(key, key);
    for (const c of a.prefs) {
      const ck = `call:${c}`;
      if (!parent.has(ck)) parent.set(ck, ck);
      union(key, ck);
    }
  }

  const groups = new Map<string, RsdApplication[]>();
  for (const a of apps) {
    const root = find(`app:${a.id}`);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(a);
  }
  return [...groups.values()];
}

interface Compiled {
  apps: RsdApplication[];
  /** Every call appearing in the component, for reporting outcomes. */
  calls: string[];
  /** Per application, the outcome index of each preference. */
  prefOut: number[][];
  /**
   * Per application, the state-bit for each preference, or -1 when the call is
   * uncontested and therefore never needs tracking.
   */
  prefBit: number[][];
  /** Number of tracked (contested) calls — the width of the taken mask. */
  tracked: number;
  /** Processing tier per application; lower goes first. */
  tiers: number[];
}

/**
 * Only calls that two or more applications actually want can ever be "taken"
 * out from under someone. A call wanted by a single application is guaranteed
 * to still be free when that application is processed, so it costs nothing to
 * leave it out of the state. Real components are mostly long tails of private
 * choices — one had 147 calls of which only a handful were contested — so this
 * shrinks the tracked width enormously and keeps the solve exact.
 */
function compile(apps: RsdApplication[]): Compiled {
  const calls: string[] = [];
  const outIdx = new Map<string, number>();
  const demand = new Map<string, number>();

  for (const a of apps) {
    const seen = new Set<string>();
    for (const c of a.prefs) {
      if (!outIdx.has(c)) {
        outIdx.set(c, calls.length);
        calls.push(c);
      }
      // Count each application once even if it lists a call twice.
      if (!seen.has(c)) {
        seen.add(c);
        demand.set(c, (demand.get(c) ?? 0) + 1);
      }
    }
  }

  const bitIdx = new Map<string, number>();
  for (const c of calls) {
    if ((demand.get(c) ?? 0) >= 2) bitIdx.set(c, bitIdx.size);
  }

  return {
    apps,
    calls,
    prefOut: apps.map((a) => a.prefs.map((c) => outIdx.get(c)!)),
    prefBit: apps.map((a) => a.prefs.map((c) => bitIdx.get(c) ?? -1)),
    tracked: bitIdx.size,
    tiers: apps.map((a) => a.tier ?? 0),
  };
}

/**
 * Index into an application's own preference list of the first call still
 * available, or -1 when every choice is gone.
 *
 * Bitmask variant, for the exact solver only. `1 << b` is meaningless once b
 * reaches 32 — JavaScript shifts wrap modulo 32 — so callers must guarantee
 * `tracked <= 31`. The exact path enforces that; sampling uses the array
 * variant below because real components routinely exceed it (one live
 * component had 109 contested calls, where aliasing silently made unrelated
 * callsigns appear taken and drove their probabilities to zero).
 */
function pickSlot(bits: number[], takenMask: number): number {
  for (let j = 0; j < bits.length; j++) {
    const b = bits[j];
    if (b === -1) return j; // uncontested: always free
    if ((takenMask & (1 << b)) === 0) return j;
  }
  return -1;
}

/** As above, but over an explicit flag array so it has no width limit. */
function pickSlotArr(bits: number[], taken: Uint8Array): number {
  for (let j = 0; j < bits.length; j++) {
    const b = bits[j];
    if (b === -1) return j; // uncontested: always free
    if (taken[b] === 0) return j;
  }
  return -1;
}

/**
 * Exact marginals by forward dynamic programming over reachable states.
 *
 * The obvious formulation recurses backwards and memoizes a full marginal
 * distribution at every state, which costs O(n*m) floats *per state* and blows
 * up memory long before the state count itself becomes a problem.
 *
 * Going forwards instead, we only need one scalar per state: the probability of
 * ever reaching it. From state (A, T) with reach r, each remaining application
 * is processed next with probability 1/|A|, so:
 *
 *   outcome[a][c_a(T)] += r / |A|          (a's fate is decided here)
 *   reach(A\{a}, T + c_a) += r / |A|
 *
 * Marginals accumulate globally as a side effect. That is one float per state
 * instead of n*(m+1), and states are visited in strict |A|-descending order so
 * no recursion or revisiting is needed.
 */
function solveExact(cmp: Compiled): { marg: Float64Array; states: number } | null {
  const n = cmp.apps.length;
  const m = cmp.calls.length;
  const t = cmp.tracked;
  const width = m + 1; // last column = "nothing"

  // Bitwise masks stay inside 31 bits so `1 << i` is always positive.
  if (n > 31 || t > 31) return null;

  const marg = new Float64Array(n * width);

  // One level at a time, keyed by which applications remain.
  let current = new Map<number, Map<number, number>>();
  current.set((1 << n) - 1, new Map([[0, 1]]));

  let states = 0;

  for (let k = n; k >= 1; k--) {
    const next = new Map<number, Map<number, number>>();

    for (const [appMask, takenMap] of current) {
      // Only applicants in the earliest remaining tier can be processed next,
      // and they are equally likely among themselves.
      let lowestTier = Infinity;
      let tierCount = 0;
      for (let i = 0; i < n; i++) {
        if ((appMask & (1 << i)) === 0) continue;
        const t2 = cmp.tiers[i];
        if (t2 < lowestTier) {
          lowestTier = t2;
          tierCount = 1;
        } else if (t2 === lowestTier) {
          tierCount++;
        }
      }
      const tierW = 1 / tierCount;

      for (const [takenMask, reach] of takenMap) {
        states++;
        if (states > MAX_STATES) return null;

        const share = reach * tierW;
        for (let i = 0; i < n; i++) {
          if ((appMask & (1 << i)) === 0) continue;
          if (cmp.tiers[i] !== lowestTier) continue;
          const slot = pickSlot(cmp.prefBit[i], takenMask);
          marg[i * width + (slot === -1 ? m : cmp.prefOut[i][slot])] += share;

          const nextApps = appMask & ~(1 << i);
          if (nextApps === 0) continue;
          const bit = slot === -1 ? -1 : cmp.prefBit[i][slot];
          const nextTaken = bit === -1 ? takenMask : takenMask | (1 << bit);
          let bucket = next.get(nextApps);
          if (!bucket) {
            bucket = new Map();
            next.set(nextApps, bucket);
          }
          bucket.set(nextTaken, (bucket.get(nextTaken) ?? 0) + share);
        }
      }
    }
    current = next;
  }

  return { marg, states };
}

function solveMonteCarlo(cmp: Compiled, samples: number): Float64Array {
  const n = cmp.apps.length;
  const m = cmp.calls.length;
  const width = m + 1;
  const acc = new Float64Array(n * width);
  const taken = new Uint8Array(Math.max(1, cmp.tracked));
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  const tiers = cmp.tiers;
  const scratch = new Int32Array(n);
  for (let s = 0; s < samples; s++) {
    // Fisher-Yates, then a stable sort by tier so earlier batches go first.
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    scratch.set(order);
    let w2 = 0;
    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < n; i++) {
      if (tiers[i] < minT) minT = tiers[i];
      if (tiers[i] > maxT) maxT = tiers[i];
    }
    if (maxT !== minT) {
      for (let t = minT; t <= maxT; t++) {
        for (let i = 0; i < n; i++) if (tiers[scratch[i]] === t) order[w2++] = scratch[i];
      }
    }
    taken.fill(0);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const slot = pickSlotArr(cmp.prefBit[i], taken);
      if (slot === -1) {
        acc[i * width + m] += 1;
      } else {
        acc[i * width + cmp.prefOut[i][slot]] += 1;
        const bit = cmp.prefBit[i][slot];
        if (bit !== -1) taken[bit] = 1;
      }
    }
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= samples;
  return acc;
}

function toOutcomes(cmp: Compiled, marg: Float64Array, method: RsdMethod, ci: number): RsdOutcome[] {
  const m = cmp.calls.length;
  const width = m + 1;
  return cmp.apps.map((a, i) => {
    const byCall: Record<string, number> = {};
    for (let k = 0; k < m; k++) {
      const p = marg[i * width + k];
      if (p > 1e-12) byCall[cmp.calls[k]] = p;
    }
    return { appId: a.id, byCall, pNothing: marg[i * width + m], method, ci };
  });
}

/** Solve one independent component. */
function solveComponent(apps: RsdApplication[]): RsdResult {
  const cmp = compile(apps);
  const n = cmp.apps.length;
  const m = cmp.calls.length;

  if (n === 1) {
    const a = cmp.apps[0];
    const byCall: Record<string, number> = {};
    if (a.prefs.length > 0) byCall[a.prefs[0]] = 1;
    return {
      outcomes: [{ appId: a.id, byCall, pNothing: a.prefs.length ? 0 : 1, method: 'trivial', ci: 0 }],
      method: 'trivial',
      work: 1,
      ciHalfWidth: 0,
    };
  }

  const exact = solveExact(cmp);
  if (exact) {
    return {
      outcomes: toOutcomes(cmp, exact.marg, 'exact', 0),
      method: 'exact',
      work: exact.states,
      ciHalfWidth: 0,
    };
  }

  const marg = solveMonteCarlo(cmp, MC_SAMPLES);
  // Worst-case 95% half-width for a proportion at p=0.5.
  const ci = 1.96 * Math.sqrt(0.25 / MC_SAMPLES);
  return {
    outcomes: toOutcomes(cmp, marg, 'monte-carlo', ci),
    method: 'monte-carlo',
    work: MC_SAMPLES,
    ciHalfWidth: ci,
  };
}

/**
 * Solve a whole batch by decomposing into independent components.
 * The reported method is the weakest used across components.
 */
export function solveBatch(apps: RsdApplication[]): RsdResult {
  if (apps.length === 0) {
    return { outcomes: [], method: 'trivial', work: 0, ciHalfWidth: 0 };
  }
  const comps = connectedComponents(apps);
  const outcomes: RsdOutcome[] = [];
  let method: RsdMethod = 'trivial';
  let work = 0;
  let ci = 0;
  const rank: Record<RsdMethod, number> = { trivial: 0, exact: 1, 'monte-carlo': 2 };
  for (const c of comps) {
    const r = solveComponent(c);
    outcomes.push(...r.outcomes);
    if (rank[r.method] > rank[method]) method = r.method;
    work += r.work;
    ci = Math.max(ci, r.ciHalfWidth);
  }
  return { outcomes, method, work, ciHalfWidth: ci };
}

/**
 * "If I file for these calls against this field, what happens?"
 *
 * Adds a hypothetical application to the batch and returns only its outcome.
 * This is what powers the preference-list builder.
 */
export function simulateEntry(
  existing: RsdApplication[],
  myPrefs: string[],
  myId = '__me__',
): { pByCall: Record<string, number>; pAny: number; pNothing: number; method: RsdMethod; ciHalfWidth: number } {
  const all = [...existing, { id: myId, prefs: myPrefs }];
  const res = solveBatch(all);
  const mine = res.outcomes.find((o) => o.appId === myId);
  if (!mine) {
    return { pByCall: {}, pAny: 0, pNothing: 1, method: res.method, ciHalfWidth: res.ciHalfWidth };
  }
  const pAny = Object.values(mine.byCall).reduce((s, x) => s + x, 0);
  return {
    pByCall: mine.byCall,
    pAny,
    pNothing: mine.pNothing,
    // The entrant's own component, not the weakest across the whole batch.
    method: mine.method,
    ciHalfWidth: mine.ci,
  };
}
