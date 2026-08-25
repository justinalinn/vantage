import { describe, it, expect } from 'vitest';
import { solveBatch, connectedComponents, simulateEntry, type RsdApplication } from './rsd';

/** Reference implementation: literal enumeration of all N! processing orders. */
function bruteForce(apps: RsdApplication[]) {
  const n = apps.length;
  const idx = [...Array(n).keys()];
  const tally = apps.map(() => new Map<string, number>());
  let total = 0;

  const permute = (arr: number[], k: number) => {
    if (k === arr.length) {
      total++;
      const taken = new Set<string>();
      for (const i of arr) {
        const got = apps[i].prefs.find((c) => !taken.has(c)) ?? '__none__';
        if (got !== '__none__') taken.add(got);
        tally[i].set(got, (tally[i].get(got) ?? 0) + 1);
      }
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(idx, 0);

  return apps.map((a, i) => {
    const byCall: Record<string, number> = {};
    let pNothing = 0;
    for (const [c, n2] of tally[i]) {
      if (c === '__none__') pNothing = n2 / total;
      else byCall[c] = n2 / total;
    }
    return { appId: a.id, byCall, pNothing };
  });
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('RSD — analytical cases', () => {
  it('two applicants contesting one call split it evenly', () => {
    const r = solveBatch([
      { id: 'a', prefs: ['K1AB'] },
      { id: 'b', prefs: ['K1AB'] },
    ]);
    expect(r.method).toBe('exact');
    expect(near(r.outcomes[0].byCall['K1AB'], 0.5)).toBe(true);
    expect(near(r.outcomes[1].byCall['K1AB'], 0.5)).toBe(true);
    expect(near(r.outcomes[0].pNothing, 0.5)).toBe(true);
  });

  it('N applicants on one call each get 1/N', () => {
    const apps = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, prefs: ['W1XY'] }));
    const r = solveBatch(apps);
    for (const o of r.outcomes) expect(near(o.byCall['W1XY'], 1 / 7)).toBe(true);
  });

  it('a fallback choice rescues the loser', () => {
    // a wants only X. b wants X then Y.
    // order a,b -> a:X  b:Y      order b,a -> b:X  a:nothing
    const r = solveBatch([
      { id: 'a', prefs: ['X'] },
      { id: 'b', prefs: ['X', 'Y'] },
    ]);
    const a = r.outcomes.find((o) => o.appId === 'a')!;
    const b = r.outcomes.find((o) => o.appId === 'b')!;
    expect(near(a.byCall['X'], 0.5)).toBe(true);
    expect(near(a.pNothing, 0.5)).toBe(true);
    expect(near(b.byCall['X'], 0.5)).toBe(true);
    expect(near(b.byCall['Y'], 0.5)).toBe(true);
    expect(near(b.pNothing, 0)).toBe(true);
  });

  it('an uncontested applicant always gets its first choice', () => {
    const r = solveBatch([
      { id: 'a', prefs: ['AA1AA', 'AA1AB'] },
      { id: 'b', prefs: ['ZZ9ZZ'] },
    ]);
    const a = r.outcomes.find((o) => o.appId === 'a')!;
    expect(near(a.byCall['AA1AA'], 1)).toBe(true);
  });
});

describe('RSD — component decomposition', () => {
  it('separates non-interacting applications', () => {
    const comps = connectedComponents([
      { id: 'a', prefs: ['X'] },
      { id: 'b', prefs: ['X', 'Y'] },
      { id: 'c', prefs: ['Z'] },
    ]);
    expect(comps.length).toBe(2);
  });

  it('links transitively through shared calls', () => {
    // a-b share X, b-c share Y => one component
    const comps = connectedComponents([
      { id: 'a', prefs: ['X'] },
      { id: 'b', prefs: ['X', 'Y'] },
      { id: 'c', prefs: ['Y'] },
    ]);
    expect(comps.length).toBe(1);
  });
});

describe('RSD — exactness vs brute force', () => {
  it('matches N! enumeration on 300 random instances', () => {
    let rng = 12345;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };

    for (let trial = 0; trial < 300; trial++) {
      const nApps = 2 + Math.floor(rand() * 5); // 2..6
      const nCalls = 1 + Math.floor(rand() * 5); // 1..5
      const pool = Array.from({ length: nCalls }, (_, i) => `C${i}`);
      const apps: RsdApplication[] = Array.from({ length: nApps }, (_, i) => {
        const len = 1 + Math.floor(rand() * nCalls);
        const shuffled = [...pool].sort(() => rand() - 0.5);
        return { id: `a${i}`, prefs: shuffled.slice(0, len) };
      });

      const mine = solveBatch(apps).outcomes;
      const ref = bruteForce(apps);

      for (const r of ref) {
        const m = mine.find((o) => o.appId === r.appId)!;
        expect(near(m.pNothing, r.pNothing, 1e-9)).toBe(true);
        for (const c of pool) {
          expect(near(m.byCall[c] ?? 0, r.byCall[c] ?? 0, 1e-9)).toBe(true);
        }
      }
    }
  });

  it('every applicant probability sums to 1', () => {
    const apps: RsdApplication[] = [
      { id: 'a', prefs: ['X', 'Y', 'Z'] },
      { id: 'b', prefs: ['Y', 'X'] },
      { id: 'c', prefs: ['Z', 'Y', 'X'] },
      { id: 'd', prefs: ['X'] },
    ];
    for (const o of solveBatch(apps).outcomes) {
      const sum = Object.values(o.byCall).reduce((s, x) => s + x, 0) + o.pNothing;
      expect(near(sum, 1, 1e-9)).toBe(true);
    }
  });
});

describe('simulateEntry', () => {
  it('ordering a contested call first costs nothing when the fallback is safe', () => {
    // Three rivals want the hot call. Nobody wants the safe one.
    const field: RsdApplication[] = [
      { id: 'r1', prefs: ['HOT'] },
      { id: 'r2', prefs: ['HOT'] },
      { id: 'r3', prefs: ['HOT'] },
    ];
    const hotFirst = simulateEntry(field, ['HOT', 'SAFE']);
    const safeFirst = simulateEntry(field, ['SAFE', 'HOT']);

    // Either way you end up with something.
    expect(near(hotFirst.pAny, 1)).toBe(true);
    expect(near(safeFirst.pAny, 1)).toBe(true);
    // But only listing HOT first gives you any chance at it.
    expect(hotFirst.pByCall['HOT']).toBeGreaterThan(0.2);
    expect(safeFirst.pByCall['HOT'] ?? 0).toBe(0);
  });

  it('a longer list never lowers P(any)', () => {
    const field: RsdApplication[] = [
      { id: 'r1', prefs: ['A', 'B'] },
      { id: 'r2', prefs: ['B', 'C'] },
    ];
    const short = simulateEntry(field, ['A']);
    const long = simulateEntry(field, ['A', 'B', 'C', 'D']);
    expect(long.pAny).toBeGreaterThanOrEqual(short.pAny - 1e-12);
  });
});

describe('RSD — processing tiers (cross-batch priority)', () => {
  it('an earlier batch takes the call outright', () => {
    const r = solveBatch([
      { id: 'early', prefs: ['K5US'], tier: 0 },
      { id: 'late', prefs: ['K5US'], tier: 1 },
    ]);
    const early = r.outcomes.find((o) => o.appId === 'early')!;
    const late = r.outcomes.find((o) => o.appId === 'late')!;
    expect(near(early.byCall['K5US'], 1)).toBe(true);
    expect(late.byCall['K5US'] ?? 0).toBe(0);
    expect(near(late.pNothing, 1)).toBe(true);
  });

  it('splits evenly within a tier, then starves the next tier', () => {
    const r = solveBatch([
      { id: 'a', prefs: ['X'], tier: 0 },
      { id: 'b', prefs: ['X'], tier: 0 },
      { id: 'c', prefs: ['X'], tier: 1 },
    ]);
    const by = (id: string) => r.outcomes.find((o) => o.appId === id)!;
    expect(near(by('a').byCall['X'], 0.5)).toBe(true);
    expect(near(by('b').byCall['X'], 0.5)).toBe(true);
    expect(by('c').byCall['X'] ?? 0).toBe(0);
  });

  it('a later filer still wins a call the earlier batch does not want', () => {
    const r = solveBatch([
      { id: 'early', prefs: ['X'], tier: 0 },
      { id: 'late', prefs: ['X', 'Y'], tier: 1 },
    ]);
    const late = r.outcomes.find((o) => o.appId === 'late')!;
    expect(near(late.byCall['Y'], 1)).toBe(true);
  });

  it('matches brute force with tiers, against 200 random instances', () => {
    let rng = 999;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const nApps = 2 + Math.floor(rand() * 4);
      const nCalls = 1 + Math.floor(rand() * 4);
      const pool = Array.from({ length: nCalls }, (_, i) => `C${i}`);
      const apps: RsdApplication[] = Array.from({ length: nApps }, (_, i) => ({
        id: `a${i}`,
        prefs: [...pool].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * nCalls)),
        tier: Math.floor(rand() * 3),
      }));

      // Reference: enumerate permutations, keep only tier-respecting ones.
      const tally = apps.map(() => new Map<string, number>());
      let total = 0;
      const idx = [...Array(nApps).keys()];
      const permute = (arr: number[], k: number) => {
        if (k === arr.length) {
          for (let i = 1; i < arr.length; i++) {
            if ((apps[arr[i]].tier ?? 0) < (apps[arr[i - 1]].tier ?? 0)) return;
          }
          total++;
          const taken = new Set<string>();
          for (const i of arr) {
            const got = apps[i].prefs.find((c) => !taken.has(c)) ?? '__none__';
            if (got !== '__none__') taken.add(got);
            tally[i].set(got, (tally[i].get(got) ?? 0) + 1);
          }
          return;
        }
        for (let i = k; i < arr.length; i++) {
          [arr[k], arr[i]] = [arr[i], arr[k]];
          permute(arr, k + 1);
          [arr[k], arr[i]] = [arr[i], arr[k]];
        }
      };
      permute(idx, 0);
      if (total === 0) continue;

      const mine = solveBatch(apps).outcomes;
      apps.forEach((a, i) => {
        const m = mine.find((o) => o.appId === a.id)!;
        for (const c of pool) {
          expect(near(m.byCall[c] ?? 0, (tally[i].get(c) ?? 0) / total, 1e-9)).toBe(true);
        }
      });
    }
  });
});

describe('RSD — wide components (bitmask width)', () => {
  it('stays correct beyond 31 contested calls', () => {
    // A component with more contested calls than fit in a 32-bit mask. The
    // sampling path used `1 << b`, which wraps modulo 32, so call 40 aliased
    // onto call 8 and unrelated callsigns read as already taken — driving their
    // probabilities to zero even for applicants who ranked them first.
    const N = 60;
    const apps: RsdApplication[] = [];
    for (let i = 0; i < N; i++) {
      // Two applicants per call guarantees every call is "contested" and so
      // must occupy a tracked slot.
      apps.push({ id: `a${i}`, prefs: [`C${i}`] });
      apps.push({ id: `b${i}`, prefs: [`C${i}`] });
    }
    const res = solveBatch(apps);
    for (let i = 0; i < N; i++) {
      const a = res.outcomes.find((o) => o.appId === `a${i}`)!;
      const b = res.outcomes.find((o) => o.appId === `b${i}`)!;
      const total = (a.byCall[`C${i}`] ?? 0) + (b.byCall[`C${i}`] ?? 0);
      // Exactly one of the two gets it, in every ordering.
      expect(Math.abs(total - 1)).toBeLessThan(1e-9);
    }
  });

  it('a first choice in a wide contested component is never impossible', () => {
    // 50 applicants, 50 shared calls, everyone ranking a different one first.
    const calls = Array.from({ length: 50 }, (_, i) => `X${i}`);
    const apps: RsdApplication[] = calls.map((c, i) => ({
      id: `p${i}`,
      prefs: [c, calls[(i + 1) % calls.length], calls[(i + 2) % calls.length]],
    }));
    const res = solveBatch(apps);
    for (const o of res.outcomes) {
      const pAny = Object.values(o.byCall).reduce((s, x) => s + x, 0);
      expect(pAny).toBeGreaterThan(0.5);
    }
    // Every call is claimed by exactly one applicant.
    for (const c of calls) {
      const total = res.outcomes.reduce((s, o) => s + (o.byCall[c] ?? 0), 0);
      expect(Math.abs(total - 1)).toBeLessThan(1e-6);
    }
  });
});
