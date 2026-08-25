/**
 * Streams the FCC ULS weekly dumps into SQLite and derives everything on top.
 *
 * Memory is held constant: the zips are piped through `unzip -p` and parsed line
 * by line, and every join is handed to SQLite rather than a JS Map — the
 * uncompressed set is ~2.6 GB and A/EN.dat alone is 471 MB.
 *
 * Stages:
 *   1 licenses      L/HD -> license_min -> collapse -> call_state; L/AM + L/EN enrich
 *   2 applications  A/HD (vanity only) -> application; A/AD + A/AM + A/EN enrich
 *   3 vanity lists  A/VC -> application_call
 *   4 universe      combinatorial -> universe
 *   5 reconcile     universe x call_state x pending -> status
 *   6 predict       RSD engine over every open batch
 */
import path from 'node:path';
import fs from 'node:fs';
import type { Database as DB } from 'better-sqlite3';
import { getDb, initSchema, setMeta } from '../src/lib/db';
import { generateUniverse } from '../src/lib/callsign/universe';
import { morseWeight, phoneticWeight } from '../src/lib/callsign/weights';
import { baseDesirability } from '../src/lib/callsign/desirability';
import { deriveFromLicenseMin, reconcile, log } from '../src/lib/ingest/derive';
import { runPredictions } from '../src/lib/predict/engine';
import { PENDING_STATUS, STALE_PENDING_DAYS, OPEN_APP_STATUSES } from '../src/lib/fcc/uls';
import { streamMember, usDate, BATCH } from '../src/lib/fcc/stream';
import { RENEWAL_PURPOSES, FCC_BANNED } from '../src/lib/fcc/blocks';

const RAW = path.join(process.cwd(), 'data/raw');
const L_ZIP = path.join(RAW, 'l_amat.zip');
const A_ZIP = path.join(RAW, 'a_amat.zip');

// ------------------------------------------------------------------ stage 1
async function ingestLicenses(db: DB) {
  // license_min is declared in schema.sql and kept, not dropped. It is the raw
  // source the whole derived chain is rebuilt from, which is what lets a daily
  // transaction file be applied as an upsert here and then recomputed forward
  // rather than hand-patched into call_state.
  db.exec('DELETE FROM license_min;');

  const ins = db.prepare(
    'INSERT OR REPLACE INTO license_min (usi,call,status,grant_date,expired_date,cancel_date,last_action_date) VALUES (?,?,?,?,?,?,?)',
  );
  const tx = db.transaction((rows: unknown[][]) => {
    for (const r of rows) ins.run(...(r as never[]));
  });

  const n = await streamMember(
    L_ZIP,
    'HD.dat',
    (f) => {
      if (f.length < 45 || f[0] !== 'HD') return null;
      if (f[6] !== 'HA' && f[6] !== 'HV') return null;
      const call = f[4];
      if (!call) return null;
      return [Number(f[1]), call, f[5] || null, usDate(f[7]), usDate(f[8]), usDate(f[9]), usDate(f[43])];
    },
    tx,
  );
  log('licenses', `HD -> license_min: ${n.toLocaleString()}`);

  // Enrichment goes onto license_min, not call_state, and runs before the
  // collapse. call_state is destroyed and rebuilt from license_min on every
  // refresh, so anything attached only to call_state survives exactly until the
  // first daily delta touches one row.
  const updAm = db.prepare('UPDATE license_min SET operator_class=? WHERE usi=?');
  const txAm = db.transaction((rows: unknown[][]) => {
    for (const r of rows) updAm.run(...(r as never[]));
  });
  const nAm = await streamMember(
    L_ZIP,
    'AM.dat',
    (f) => (f.length < 18 || f[0] !== 'AM' || !f[5] ? null : [f[5], Number(f[1])]),
    txAm,
  );
  log('licenses', `AM enrich: ${nAm.toLocaleString()}`);

  const updEn = db.prepare('UPDATE license_min SET entity_name=?, state=? WHERE usi=?');
  const txEn = db.transaction((rows: unknown[][]) => {
    for (const r of rows) updEn.run(...(r as never[]));
  });
  const nEn = await streamMember(
    L_ZIP,
    'EN.dat',
    (f) => (f.length < 25 || f[0] !== 'EN' ? null : [f[7] || null, f[17] || null, Number(f[1])]),
    txEn,
  );
  log('licenses', `EN enrich: ${nEn.toLocaleString()}`);

  deriveFromLicenseMin(db);
}


// ------------------------------------------------------------- stages 2 & 3
/**
 * The preference lists come first, because they are what *defines* a vanity
 * request. Filtering application headers on radio_service alone is wrong in
 * both directions: 'HV' sweeps in routine renewals and address changes on
 * vanity licences, while genuine vanity requests predating the HV service code
 * sit under 'HA'. Loading VC first gives an exact key set to filter headers
 * against, which also keeps the application table ~7x smaller.
 */
async function ingestVanityAndApplications(db: DB) {
  db.exec('DELETE FROM application_call; DELETE FROM application;');

  const insVc = db.prepare('INSERT OR REPLACE INTO application_call (usi,seq,call) VALUES (?,?,?)');
  const txVc = db.transaction((rows: unknown[][]) => {
    for (const r of rows) insVc.run(...(r as never[]));
  });
  const nVc = await streamMember(
    A_ZIP,
    'VC.dat',
    (f) => {
      if (f.length < 6 || f[0] !== 'VC') return null;
      const seq = Number(f[4]);
      const call = (f[5] || '').trim().toUpperCase();
      if (!call || !Number.isFinite(seq)) return null;
      return [Number(f[1]), seq, call];
    },
    txVc,
  );
  log('vanity', `VC -> application_call: ${nVc.toLocaleString()}`);

  // The exact set of vanity-request USIs, held in memory to filter every
  // subsequent pass. ~90k integers.
  const wanted = new Set<number>(
    (db.prepare('SELECT DISTINCT usi FROM application_call').all() as Array<{ usi: number }>).map((r) => r.usi),
  );
  log('vanity', `${wanted.size.toLocaleString()} distinct vanity requests`);

  const ins = db.prepare(
    'INSERT OR REPLACE INTO application (usi,file_number,applicant_call,radio_service) VALUES (?,?,?,?)',
  );
  const tx = db.transaction((rows: unknown[][]) => {
    for (const r of rows) ins.run(...(r as never[]));
  });
  // Headers whose preference list has not been published yet.
  //
  // Collected on the same pass rather than a second one: an HV-service header
  // with no VC rows is a vanity application the FCC has announced but not
  // detailed. Restricting to HV undercounts — genuine vanity requests also
  // arrive under HA, which is exactly why `wanted` is built from VC in the
  // first place — but undercounting a warning is the safe direction.
  const unlisted = new Map<number, { file: string | null; call: string | null }>();

  const n = await streamMember(
    A_ZIP,
    'HD.dat',
    (f) => {
      if (f.length < 10 || f[0] !== 'HD') return null;
      const usi = Number(f[1]);
      if (!wanted.has(usi)) {
        if (f[6] === 'HV') unlisted.set(usi, { file: f[2] || null, call: f[4] || null });
        return null;
      }
      return [usi, f[2] || null, f[4] || null, f[6] || null];
    },
    tx,
  );
  log('apps', `HD -> application: ${n.toLocaleString()}`);

  const updAd = db.prepare(
    'UPDATE application SET purpose=?, app_status=?, receipt_date=?, action_date=? WHERE usi=?',
  );
  const txAd = db.transaction((rows: unknown[][]) => {
    for (const r of rows) updAd.run(...(r as never[]));
  });
  const unlistedMeta = new Map<number, { status: string; receipt: string | null }>();
  const nAd = await streamMember(
    A_ZIP,
    'AD.dat',
    (f) => {
      if (f.length < 22 || f[0] !== 'AD') return null;
      const usi = Number(f[1]);
      if (!wanted.has(usi)) {
        if (unlisted.has(usi)) unlistedMeta.set(usi, { status: f[5], receipt: usDate(f[10]) });
        return null;
      }
      return [f[4] || null, f[5] || null, usDate(f[10]), usDate(f[21]), usi];
    },
    txAd,
  );
  log('apps', `AD enrich: ${nAd.toLocaleString()}`);

  db.exec('DELETE FROM application_unlisted;');
  const insUn = db.prepare(
    'INSERT OR REPLACE INTO application_unlisted (usi,file_number,applicant_call,receipt_date,app_status) VALUES (?,?,?,?,?)',
  );
  // Only live ones matter, and "live" means two things. A header for an
  // application already granted or dismissed says nothing about current
  // competition — and neither does one the FCC has been sitting on since 2011.
  // Without the age filter this count is dominated by applications offlined for
  // manual review, which is a different problem wearing the same clothes.
  const liveFrom = new Date(Date.now() - STALE_PENDING_DAYS * 86400000).toISOString().slice(0, 10);
  let nUn = 0;
  db.transaction(() => {
    for (const [usi, h] of unlisted) {
      const m = unlistedMeta.get(usi);
      if (!m || m.status !== PENDING_STATUS) continue;
      if (!m.receipt || m.receipt < liveFrom) continue;
      insUn.run(usi, h.file, h.call, m.receipt, m.status);
      nUn++;
    }
  })();
  log('apps', `${nUn.toLocaleString()} vanity applications announced but not yet detailed by the FCC`);

  const updAm = db.prepare('UPDATE application SET operator_class=?, request_type=?, relationship=? WHERE usi=?');
  const txAm = db.transaction((rows: unknown[][]) => {
    for (const r of rows) updAm.run(...(r as never[]));
  });
  const nAm = await streamMember(
    A_ZIP,
    'AM.dat',
    (f) => {
      if (f.length < 18 || f[0] !== 'AM') return null;
      const usi = Number(f[1]);
      if (!wanted.has(usi)) return null;
      return [f[5] || null, f[13] || null, f[14] || null, usi];
    },
    txAm,
  );
  log('apps', `AM enrich: ${nAm.toLocaleString()}`);

  const updEn = db.prepare('UPDATE application SET entity_name=?, state=?, frn=? WHERE usi=?');
  const txEn = db.transaction((rows: unknown[][]) => {
    for (const r of rows) updEn.run(...(r as never[]));
  });
  const nEn = await streamMember(
    A_ZIP,
    'EN.dat',
    (f) => {
      if (f.length < 25 || f[0] !== 'EN') return null;
      const usi = Number(f[1]);
      if (!wanted.has(usi)) return null;
      return [f[7] || null, f[17] || null, f[22] || null, usi];
    },
    txEn,
  );
  log('apps', `EN enrich: ${nEn.toLocaleString()}`);

  // VC rows whose header never appeared are unusable.
  db.exec('DELETE FROM application_call WHERE usi NOT IN (SELECT usi FROM application);');

  const c = db.prepare('SELECT COUNT(*) c FROM application').get() as { c: number };
  const p = db.prepare('SELECT COUNT(*) c FROM application WHERE app_status = ?').get(PENDING_STATUS) as { c: number };
  const e = db.prepare('SELECT COUNT(*) c FROM application_call').get() as { c: number };
  log('apps', `${c.c.toLocaleString()} vanity requests, ${p.c.toLocaleString()} pending, ${e.c.toLocaleString()} preference entries`);
}

// ------------------------------------------------------------- stage 3.5
/**
 * Applications pending against a callsign that are *not* vanity requests.
 *
 * The vanity ingest above keys everything off VC.dat, which is right for
 * preference lists and wrong for holds. A renewal filed inside the 2-year grace
 * window freezes the call: it never reaches the pool, no matter what the
 * availability arithmetic says. Nothing in the licence record shows this — the
 * record still reads Active with a past expiry, exactly like a call that is
 * about to open — so without this pass the tool confidently recommends calls
 * that cannot be granted to anybody.
 *
 * AD.dat is streamed first because pending applications are rare (a few
 * thousand out of millions). Collecting their USIs up front turns the HD pass
 * into a cheap set membership test and keeps the whole stage in constant
 * memory, the same trick the vanity stage uses with VC.
 */
async function ingestBlocks(db: DB) {
  db.exec('DELETE FROM call_block;');

  const pending = new Map<number, { purpose: string | null; receipt: string | null; status: string }>();
  await streamMember(
    A_ZIP,
    'AD.dat',
    (f) => {
      if (f.length < 22 || f[0] !== 'AD') return null;
      if (!OPEN_APP_STATUSES.has(f[5])) return null;
      pending.set(Number(f[1]), { purpose: f[4] || null, receipt: usDate(f[10]), status: f[5] });
      return null; // collected in the map; nothing to sink
    },
    () => {},
  );
  log('blocks', `${pending.size.toLocaleString()} pending applications of any kind`);

  const ins = db.prepare(
    'INSERT OR REPLACE INTO call_block (call,usi,file_number,purpose,receipt_date,kind) VALUES (?,?,?,?,?,?)',
  );
  const tx = db.transaction((rows: unknown[][]) => {
    for (const r of rows) ins.run(...(r as never[]));
  });

  const n = await streamMember(
    A_ZIP,
    'HD.dat',
    (f) => {
      if (f.length < 10 || f[0] !== 'HD') return null;
      const usi = Number(f[1]);
      const p = pending.get(usi);
      if (!p) return null;
      const call = (f[4] || '').trim().toUpperCase();
      if (!call) return null;
      const kind = p.status === 'R' ? 'RETURNED' : p.purpose && RENEWAL_PURPOSES.has(p.purpose) ? 'RENEWAL' : 'OTHER';
      return [call, usi, f[2] || null, p.purpose, p.receipt, kind];
    },
    tx,
  );
  log('blocks', `HD -> call_block: ${n.toLocaleString()} pending applications carry a callsign`);

  const r = db
    .prepare("SELECT kind, COUNT(DISTINCT call) c FROM call_block GROUP BY kind ORDER BY c DESC")
    .all() as Array<{ kind: string; c: number }>;
  for (const k of r) log('blocks', `  ${k.kind.padEnd(10)} ${k.c.toLocaleString()} calls`);
}

// ------------------------------------------------------------------ stage 4
function buildUniverse(db: DB) {
  log('universe', 'generating combinatorial callsign space …');
  db.exec('DELETE FROM universe');
  const ins = db.prepare(
    'INSERT OR REPLACE INTO universe (call,prefix,digit,suffix,format,grp,region,region_locked,morse,phonetic,desirability) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  const tx = db.transaction((rows: unknown[][]) => {
    for (const r of rows) ins.run(...(r as never[]));
  });

  let batch: unknown[][] = [];
  let n = 0;
  for (const u of generateUniverse()) {
    batch.push([
      u.call, u.prefix, u.digit, u.suffix, u.format, u.group, u.region,
      u.regionLocked ? 1 : 0, morseWeight(u.call), phoneticWeight(u.call), baseDesirability(u.call),
    ]);
    if (batch.length >= BATCH) {
      tx(batch);
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    tx(batch);
    n += batch.length;
  }
  log('universe', `generated ${n.toLocaleString()} valid callsigns`);
}

// ------------------------------------------------------------------ stage 5

// ------------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const db = getDb();
  initSchema(db);

  const only = process.argv[2];
  const all = !only;
  if (all || only === 'licenses') await ingestLicenses(db);
  if (all || only === 'apps' || only === 'vanity') await ingestVanityAndApplications(db);
  if (all || only === 'blocks') await ingestBlocks(db);
  if (all || only === 'universe') buildUniverse(db);
  if (all || only === 'reconcile') reconcile(db);
  if (all || only === 'predict') runPredictions(db);

  setMeta(db, 'last_ingest', new Date().toISOString());
  for (const [k, f] of [
    ['uls_license_file', L_ZIP],
    ['uls_application_file', A_ZIP],
  ] as const) {
    if (fs.existsSync(f)) setMeta(db, k, new Date(fs.statSync(f).mtime).toISOString());
  }

  db.exec('ANALYZE;');
  log('done', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/**
 * Belt and braces: only run when invoked directly.
 *
 * The shared functions moved to src/lib/ingest/derive.ts precisely so nothing
 * imports this file, and this guard exists so that if something ever does
 * again, the cost is zero instead of an emptied database. A full ingest with no
 * bulk files on disk truncates every source table and succeeds quietly.
 */
const invokedDirectly =
  process.argv[1] != null && /(^|[\\/])ingest\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error('scripts/ingest.ts was imported rather than executed; refusing to run.');
}
