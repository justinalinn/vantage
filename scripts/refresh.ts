/**
 * Incremental ULS refresh — applied live, without taking the site down.
 *
 * The weekly complete dump leaves this database up to seven days behind, and a
 * week is an eternity here: the FCC processes a vanity batch every night, so a
 * call that reads "available, uncontested" on a stale snapshot may already have
 * four applications queued against it. That is exactly the discrepancy someone
 * notices when they compare this site against one that reads the daily files.
 *
 * ## Why this can run against a live database
 *
 * Everything below happens inside a single write transaction. Under WAL a
 * writer never blocks readers, and readers continue to see the pre-transaction
 * snapshot until it commits — so the site serves the previous, fully consistent
 * dataset for the whole rebuild and then flips to the new one atomically. There
 * is no window in which a request can observe half-updated state, and no
 * restart. If the process dies mid-way, SQLite rolls the whole thing back and
 * the site keeps serving what it was already serving.
 *
 * This is also why the refresh does not patch derived tables in place. The
 * chain runs source -> license_period/call_state -> universe status ->
 * predictions -> survival, and refreshing part of it leaves the database
 * internally inconsistent in ways that look like plausible data rather than an
 * error. Inside one transaction, rebuilding the whole chain costs a couple of
 * minutes and is invisible; a partial patch is fast, permanent and wrong.
 *
 * ## What counts as source
 *
 * license_min, application, application_call and call_block hold raw ULS
 * fields. They are upserted. Everything else is destroyed and recomputed.
 *
 * Usage:
 *   npx tsx scripts/refresh.ts            # apply anything new, then exit
 *   npx tsx scripts/refresh.ts --check    # report what is new, change nothing
 *   npx tsx scripts/refresh.ts --force    # re-apply even if nothing looks new
 *   npx tsx scripts/refresh.ts --watch    # stay resident and poll on a schedule
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { getDb, initSchema, setMeta, getMeta } from '../src/lib/db';
import { streamMember, usDate, head, download } from '../src/lib/fcc/stream';
import { DAILY, WEEKLY, STUB_BYTES, pollIntervalMs, type UlsSource } from '../src/lib/fcc/sources';
import { PENDING_STATUS, OPEN_APP_STATUSES, STALE_PENDING_DAYS } from '../src/lib/fcc/uls';
import { RENEWAL_PURPOSES } from '../src/lib/fcc/blocks';
import { deriveFromLicenseMin, reconcile } from '../src/lib/ingest/derive';
import { runPredictions } from '../src/lib/predict/engine';

const RAW = path.join(process.cwd(), 'data/raw');

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`);
}

// --------------------------------------------------------------- discovery
interface Candidate {
  src: UlsSource;
  lastModified: string;
  bytes: number;
}

/**
 * Which files have changed since we last applied them.
 *
 * `Last-Modified` is the whole protocol. Six HEAD requests cost a few hundred
 * bytes and settle the question without downloading anything, which matters
 * because the alternative — fetching to compare — is how you get throttled off
 * a government file server.
 */
async function findNew(db: DB, force: boolean): Promise<Candidate[]> {
  // --force lowers the complete-file baseline only, so a re-apply can still
  // never walk the data backwards past what a transaction file already wrote.
  const out: Candidate[] = [];

  // The high-water mark per data kind: the newest thing already folded in,
  // whether that came from a complete file or a transaction file.
  //
  // Both halves matter. The day-of-week filenames are a rotating six-slot
  // buffer, not an archive, so after a complete reload most slots hold data
  // older than what was just loaded — and l_am_tue.zip can sit unrewritten for
  // a week while l_am_wed.zip is refreshed daily. Applying anything below this
  // line overwrites current records with an older snapshot of themselves, which
  // produces a database that is wrong in a way nothing downstream can detect.
  const baseline: Record<string, number> = {
    license: Date.parse(getMeta(db, 'src:l_amat') ?? '') || 0,
    application: Date.parse(getMeta(db, 'src:a_amat') ?? '') || 0,
  };
  if (!force) {
    for (const d of DAILY) {
      const applied = getMeta(db, d.key);
      if (applied) baseline[d.kind] = Math.max(baseline[d.kind], Date.parse(applied) || 0);
    }
  }

  for (const src of [...WEEKLY, ...DAILY]) {
    let h;
    try {
      h = await head(src.url);
    } catch (e) {
      log(`  ${src.name.padEnd(14)} unreachable (${(e as Error).message})`);
      continue;
    }
    if (!h.ok || !h.lastModified) continue;

    // The FCC parks a 212-byte placeholder in slots it has nothing for. Applying
    // one is a no-op that still advances the marker, which would then suppress
    // the real file when it lands.
    if (h.length <= STUB_BYTES) continue;

    const published = Date.parse(h.lastModified);
    const applied = getMeta(db, src.key);
    const appliedAt = applied ? Date.parse(applied) : 0;

    if (src.cadence === 'daily') {
      if (published <= baseline[src.kind]) continue;
      out.push({ src, lastModified: h.lastModified, bytes: h.length });
      continue;
    }
    if (published > appliedAt) out.push({ src, lastModified: h.lastModified, bytes: h.length });
  }
  return out;
}

// ------------------------------------------------------------------- run
async function applyAll(db: DB, candidates: Candidate[]): Promise<boolean> {
  fs.mkdirSync(RAW, { recursive: true });

  // Complete files are reported, never fetched. They are 520 MB, they are not
  // deltas, and re-downloading them on a 30-minute timer would move a third of
  // a gigabyte off a government file server every half hour to achieve nothing.
  // Reloading one is a deliberate operation: npm run deploy:full.
  const weekly = candidates.filter((c) => c.src.cadence === 'weekly');
  for (const c of weekly) {
    log(`  ${c.src.name}: a newer complete file is published (${c.lastModified}) — run 'npm run deploy:full' to load it`);
    setMeta(db, `available:${c.src.key}`, c.lastModified);
  }

  // Download outside the transaction. Holding a write lock across a network
  // fetch would stall watchlist writes for as long as the FCC takes to answer.
  const staged: Array<{ c: Candidate; file: string }> = [];
  for (const c of candidates.filter((x) => x.src.cadence === 'daily')) {
    const file = path.join(RAW, c.src.name);
    log(`  downloading ${c.src.name} (${(c.bytes / 1e6).toFixed(1)} MB, ${c.lastModified})`);
    await download(c.src.url, file);
    staged.push({ c, file });
  }
  if (staged.length === 0) return false;

  // Oldest first, so a later transaction file always wins over an earlier one.
  staged.sort((a, b) => Date.parse(a.c.lastModified) - Date.parse(b.c.lastModified));

  const t0 = Date.now();
  log('applying inside a single transaction — the site keeps serving the previous snapshot');

  const work = db.transaction(() => {
    for (const { c, file } of staged) {
      if (c.src.kind === 'license') {
        const n = applyLicenseDeltaSync(db, file);
        log(`  ${c.src.name}: ${n.toLocaleString()} licence rows`);
      } else {
        const r = applyApplicationDeltaSync(db, file);
        log(
          `  ${c.src.name}: ${r.hd.toLocaleString()} app rows, ${r.vc.toLocaleString()} preference entries` +
            (r.unlisted ? `, ${r.unlisted.toLocaleString()} announced without a preference list yet` : ''),
        );
      }
      setMeta(db, c.src.key, c.lastModified);
    }

    log('rebuilding derived chain (licences -> status -> predictions)');
    deriveFromLicenseMin(db);
    reconcile(db);
    runPredictions(db);
    setMeta(db, 'last_refresh', new Date().toISOString());
  });

  // The delta appliers are async because they stream subprocesses, and
  // better-sqlite3 transactions are strictly synchronous. Resolve the streaming
  // up front into buffered row sets, then let the transaction replay them.
  await prefetch(staged);
  work();

  log(`committed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const { file } of staged) fs.rmSync(file, { force: true });
  return true;
}

/**
 * better-sqlite3 transactions cannot span an await, and the ULS readers are
 * subprocess streams. So each staged file is parsed to completion first and the
 * resulting rows held for the transaction to apply.
 *
 * The daily files are 27–125 KB, a few thousand rows, so buffering them costs
 * nothing. The same trick against a weekly file would not fit in memory, which
 * is exactly why weekly reloads go through the streaming ingest instead.
 */
const parsed = new Map<string, { kind: 'license' | 'application'; rows: any }>();

async function prefetch(staged: Array<{ c: Candidate; file: string }>) {
  parsed.clear();
  for (const { c, file } of staged) {
    parsed.set(file, { kind: c.src.kind, rows: await readDelta(file, c.src.kind) });
  }
}

interface LicenseDelta {
  hd: unknown[][];
  am: unknown[][];
  en: unknown[][];
}
interface AppDelta {
  vc: unknown[][];
  hd: unknown[][];
  ad: unknown[][];
  am: unknown[][];
  en: unknown[][];
  pending: Array<[number, string | null, string | null, string]>;
  seen: number[];
  hdCalls: Array<[number, string, string | null]>;
}

async function readDelta(zip: string, kind: 'license' | 'application'): Promise<LicenseDelta | AppDelta> {
  const collect = async (member: string, map: (f: string[]) => unknown[] | null) => {
    const rows: unknown[][] = [];
    await streamMember(zip, member, map, (b) => rows.push(...b));
    return rows;
  };

  if (kind === 'license') {
    return {
      hd: await collect('HD.dat', (f) => {
        if (f.length < 45 || f[0] !== 'HD') return null;
        if (f[6] !== 'HA' && f[6] !== 'HV') return null;
        if (!f[4]) return null;
        return [Number(f[1]), f[4], f[5] || null, usDate(f[7]), usDate(f[8]), usDate(f[9]), usDate(f[43])];
      }),
      am: await collect('AM.dat', (f) =>
        f.length < 18 || f[0] !== 'AM' || !f[5] ? null : [f[5], Number(f[1])],
      ),
      en: await collect('EN.dat', (f) =>
        f.length < 25 || f[0] !== 'EN' ? null : [f[7] || null, f[17] || null, Number(f[1])],
      ),
    };
  }

  const pending: Array<[number, string | null, string | null, string]> = [];
  const seen: number[] = [];
  const ad = await collect('AD.dat', (f) => {
    if (f.length < 22 || f[0] !== 'AD') return null;
    const usi = Number(f[1]);
    seen.push(usi);
    if (OPEN_APP_STATUSES.has(f[5])) pending.push([usi, f[4] || null, usDate(f[10]), f[5]]);
    return [f[4] || null, f[5] || null, usDate(f[10]), usDate(f[21]), usi];
  });

  const hdCalls: Array<[number, string, string | null]> = [];
  const hd = await collect('HD.dat', (f) => {
    if (f.length < 10 || f[0] !== 'HD') return null;
    const usi = Number(f[1]);
    const call = (f[4] || '').trim().toUpperCase();
    if (call) hdCalls.push([usi, call, f[2] || null]);
    return [usi, f[2] || null, f[4] || null, f[6] || null];
  });

  return {
    vc: await collect('VC.dat', (f) => {
      if (f.length < 6 || f[0] !== 'VC') return null;
      const seq = Number(f[4]);
      const call = (f[5] || '').trim().toUpperCase();
      if (!call || !Number.isFinite(seq)) return null;
      return [Number(f[1]), seq, call];
    }),
    hd,
    ad,
    am: await collect('AM.dat', (f) =>
      f.length < 18 || f[0] !== 'AM' ? null : [f[5] || null, f[13] || null, f[14] || null, Number(f[1])],
    ),
    en: await collect('EN.dat', (f) =>
      f.length < 25 || f[0] !== 'EN'
        ? null
        : [f[7] || null, f[17] || null, f[22] || null, Number(f[1])],
    ),
    pending,
    seen,
    hdCalls,
  };
}

function applyLicenseDeltaSync(db: DB, file: string): number {
  const d = parsed.get(file)!.rows as LicenseDelta;
  const ins = db.prepare(`
    INSERT INTO license_min (usi,call,status,grant_date,expired_date,cancel_date,last_action_date)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(usi) DO UPDATE SET
      call=excluded.call, status=excluded.status, grant_date=excluded.grant_date,
      expired_date=excluded.expired_date, cancel_date=excluded.cancel_date,
      last_action_date=excluded.last_action_date
  `);
  for (const r of d.hd) ins.run(...(r as never[]));
  const am = db.prepare('UPDATE license_min SET operator_class=? WHERE usi=?');
  for (const r of d.am) am.run(...(r as never[]));
  const en = db.prepare('UPDATE license_min SET entity_name=?, state=? WHERE usi=?');
  for (const r of d.en) en.run(...(r as never[]));
  return d.hd.length;
}

function applyApplicationDeltaSync(db: DB, file: string): { vc: number; hd: number; unlisted: number } {
  const d = parsed.get(file)!.rows as AppDelta;

  const insVc = db.prepare('INSERT OR REPLACE INTO application_call (usi,seq,call) VALUES (?,?,?)');
  for (const r of d.vc) insVc.run(...(r as never[]));

  const known = new Set<number>(
    (db.prepare('SELECT usi FROM application').all() as Array<{ usi: number }>).map((r) => r.usi),
  );
  for (const r of db.prepare('SELECT DISTINCT usi FROM application_call').all() as Array<{ usi: number }>) {
    known.add(r.usi);
  }

  const insHd = db.prepare(`
    INSERT INTO application (usi,file_number,applicant_call,radio_service)
    VALUES (?,?,?,?)
    ON CONFLICT(usi) DO UPDATE SET
      file_number=excluded.file_number, applicant_call=excluded.applicant_call,
      radio_service=excluded.radio_service
  `);
  let hdN = 0;
  for (const r of d.hd) {
    if (!known.has(r[0] as number)) continue;
    insHd.run(...(r as never[]));
    hdN++;
  }

  const updAd = db.prepare(
    'UPDATE application SET purpose=?, app_status=?, receipt_date=?, action_date=? WHERE usi=?',
  );
  for (const r of d.ad) if (known.has(r[4] as number)) updAd.run(...(r as never[]));

  const updAm = db.prepare('UPDATE application SET operator_class=?, request_type=?, relationship=? WHERE usi=?');
  for (const r of d.am) if (known.has(r[3] as number)) updAm.run(...(r as never[]));

  const updEn = db.prepare('UPDATE application SET entity_name=?, state=?, frn=? WHERE usi=?');
  for (const r of d.en) if (known.has(r[3] as number)) updEn.run(...(r as never[]));

  // Rebuild the block rows for every application this file mentions: one that
  // has just been granted must stop freezing its call.
  const clear = db.prepare('DELETE FROM call_block WHERE usi = ?');
  for (const usi of d.seen) clear.run(usi);

  const callOf = new Map<number, [string, string | null]>();
  for (const [usi, call, fn] of d.hdCalls) callOf.set(usi, [call, fn]);
  const blockIns = db.prepare(
    'INSERT OR REPLACE INTO call_block (call,usi,file_number,purpose,receipt_date,kind) VALUES (?,?,?,?,?,?)',
  );
  for (const [usi, purpose, receipt, status] of d.pending) {
    const c = callOf.get(usi);
    if (!c) continue;
    const kind = status === 'R' ? 'RETURNED' : purpose && RENEWAL_PURPOSES.has(purpose) ? 'RENEWAL' : 'OTHER';
    blockIns.run(c[0], usi, c[1], purpose, receipt, kind);
  }

  db.exec('DELETE FROM application_call WHERE usi NOT IN (SELECT usi FROM application);');

  // Vanity headers the FCC has published without their preference lists.
  //
  // Every application this file mentions is re-evaluated: one that has just
  // acquired its VC rows graduates into `application` above and must stop being
  // listed here, and one that has been granted or dismissed stops mattering.
  const clearUn = db.prepare('DELETE FROM application_unlisted WHERE usi = ?');
  for (const usi of d.seen) clearUn.run(usi);
  for (const r of d.hd) clearUn.run(r[0] as number);

  const status = new Map<number, { s: string; receipt: string | null }>();
  for (const r of d.ad) status.set(r[4] as number, { s: String(r[1] ?? ''), receipt: (r[2] as string) ?? null });

  const insUn = db.prepare(
    'INSERT OR REPLACE INTO application_unlisted (usi,file_number,applicant_call,receipt_date,app_status) VALUES (?,?,?,?,?)',
  );
  // Same two liveness tests as the full ingest: still pending, and recent
  // enough that the FCC has not simply parked it for manual review.
  const liveFrom = new Date(Date.now() - STALE_PENDING_DAYS * 86400000).toISOString().slice(0, 10);
  let unlisted = 0;
  for (const r of d.hd) {
    const usi = r[0] as number;
    if (known.has(usi)) continue;          // its preference list is on file
    if (r[3] !== 'HV') continue;           // not identifiably a vanity request
    const st = status.get(usi);
    if (!st || st.s !== PENDING_STATUS) continue;
    if (!st.receipt || st.receipt < liveFrom) continue;
    insUn.run(usi, r[1] ?? null, r[2] ?? null, st.receipt, st.s);
    unlisted++;
  }

  return { vc: d.vc.length, hd: hdN, unlisted };
}

// ------------------------------------------------------------------ main
/**
 * Refuses to run against a database built before license_min was made durable.
 *
 * The rebuild derives call_state from license_min. If that table is empty
 * because an older ingest dropped it, the derive succeeds, produces zero rows,
 * and silently erases every callsign on the site. Checking costs one query;
 * not checking costs the database.
 */
function assertRebuildable(db: DB) {
  const n = db.prepare('SELECT COUNT(*) c FROM license_min').get() as { c: number };
  if (n.c === 0) {
    throw new Error(
      'license_min is empty — this database predates the incremental refresh. ' +
        'Run a full ingest once (npm run deploy:full) before enabling refresh.',
    );
  }
}

async function once(db: DB, opts: { check: boolean; force: boolean }): Promise<boolean> {
  log('checking FCC for new data …');
  const news = await findNew(db, opts.force);
  if (news.length === 0) {
    log('nothing new');
    return false;
  }
  for (const c of news) log(`  NEW ${c.src.name.padEnd(14)} ${c.lastModified}`);
  if (opts.check) return false;
  assertRebuildable(db);
  return applyAll(db, news);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const db = getDb();
  initSchema(db);

  const opts = { check: args.has('--check'), force: args.has('--force') };

  if (!args.has('--watch')) {
    const changed = await once(db, opts);
    if (changed) db.pragma('wal_checkpoint(TRUNCATE)');
    return;
  }

  log('watch mode: polling on the FCC publication schedule');
  for (;;) {
    try {
      const changed = await once(db, opts);
      if (changed) db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // A failed refresh must never take the site with it. The previous
      // snapshot is still committed and still being served.
      console.error('[refresh] failed, keeping the current dataset:', e);
    }
    const wait = pollIntervalMs();
    log(`next check in ${Math.round(wait / 60000)} min`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
