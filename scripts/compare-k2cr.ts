/**
 * Cross-checks this database against vanities.k2cr.com.
 *
 * K2CR publishes, per call district, the short calls it considers available,
 * pending, upcoming and blocked. That page is the closest thing to an
 * independent second opinion that exists for this problem, and disagreeing with
 * it is worth knowing about in either direction: a call we show as available and
 * they do not is either a real find or a bug, and there is no way to tell which
 * without looking.
 *
 * This exists because a discrepancy on exactly one callsign — K3UF — turned out
 * to be a systematic fault affecting every call in a 2-year grace period. One
 * spot check found it; a standing comparison would have found it sooner.
 *
 * Usage: npx tsx scripts/compare-k2cr.ts [http://host:port]
 */
const BASE = process.argv[2] ?? 'http://localhost:3477';
const K2CR = 'https://vanities.k2cr.com/index.html';

const CALL_RE = /\b([A-Z]{1,2}[0-9][A-Z]{1,3})\b/g;

interface Bucket {
  available: Set<string>;
  pending: Set<string>;
  upcoming: Set<string>;
  blocked: Set<string>;
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ');
}

/**
 * The district table is four columns of comma-separated calls per row. Parsing
 * the rendered cells rather than the raw markup keeps this working through the
 * site's occasional markup churn.
 */
async function scrapeK2cr(): Promise<Bucket> {
  const html = await fetch(K2CR, { headers: { 'User-Agent': 'VANTAGE-compare/1.0' } }).then((r) => r.text());
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const b: Bucket = { available: new Set(), pending: new Set(), upcoming: new Set(), blocked: new Set() };

  for (const row of rows) {
    const cells = row
      .split(/<td[^>]*>/i)
      .slice(1)
      .map(textOf);
    // district | states | available | pending | upcoming | blocked
    //
    // The page carries a second six-column table further down — every pending
    // application, keyed by applicant callsign — and matching on column count
    // alone silently scrapes that one too, turning applicants into "blocked"
    // calls. Anchor on the district number instead.
    if (cells.length < 6) continue;
    if (!/^\s*\d{1,2}\s*$/.test(cells[0])) continue;
    const into = (i: number, set: Set<string>) => {
      for (const m of cells[i].matchAll(CALL_RE)) set.add(m[1]);
    };
    into(2, b.available);
    into(3, b.pending);
    into(4, b.upcoming);
    into(5, b.blocked);
  }
  return b;
}

async function ourStatus(calls: string[]): Promise<Map<string, { status: string; available_date: string | null }>> {
  const out = new Map<string, { status: string; available_date: string | null }>();
  for (const c of calls) {
    const r = await fetch(`${BASE}/api/call/${c}`);
    if (!r.ok) {
      out.set(c, { status: 'NOT_IN_UNIVERSE', available_date: null });
      continue;
    }
    const j = (await r.json()) as { status: string; available_date: string | null };
    out.set(c, { status: j.status, available_date: j.available_date });
  }
  return out;
}

/** What we would have to say for their label to be considered a match. */
const AGREES: Record<keyof Bucket, string[]> = {
  available: ['AVAILABLE', 'AVAILABLE_CONTESTED', 'NEVER_ISSUED'],
  pending: ['AVAILABLE_CONTESTED', 'PENDING', 'AVAILABLE'],
  upcoming: ['UPCOMING', 'EXPIRED_WAITING', 'CANCELED_WAITING'],
  blocked: ['BLOCKED_PENDING', 'BANNED', 'ANOMALY'],
};

async function main() {
  console.log(`comparing ${BASE} against ${K2CR}\n`);
  const k = await scrapeK2cr();

  let totalChecked = 0;
  let totalAgree = 0;
  const disagreements: Array<[string, string, string, string | null]> = [];

  for (const bucket of ['available', 'pending', 'upcoming', 'blocked'] as Array<keyof Bucket>) {
    const calls = [...k[bucket]].sort();
    if (calls.length === 0) continue;
    const ours = await ourStatus(calls);
    let agree = 0;
    for (const c of calls) {
      const o = ours.get(c)!;
      if (AGREES[bucket].includes(o.status)) agree++;
      else disagreements.push([bucket, c, o.status, o.available_date]);
    }
    totalChecked += calls.length;
    totalAgree += agree;
    const pct = ((agree / calls.length) * 100).toFixed(1);
    console.log(`${bucket.padEnd(10)} ${String(agree).padStart(4)}/${String(calls.length).padEnd(4)} agree  ${pct}%`);
  }

  console.log(`\noverall    ${totalAgree}/${totalChecked}  ${((totalAgree / totalChecked) * 100).toFixed(1)}%`);

  if (disagreements.length) {
    console.log('\ndisagreements (their bucket -> our status):');
    for (const [bucket, call, status, date] of disagreements) {
      console.log(`  ${call.padEnd(7)} k2cr:${bucket.padEnd(10)} ours:${status.padEnd(20)} ${date ?? ''}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
