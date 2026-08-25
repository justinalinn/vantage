/**
 * The derived half of the pipeline: everything rebuilt from the source tables.
 *
 * This lives under src/lib rather than in scripts/ for one specific reason. The
 * incremental refresh needs these two functions, and importing them from
 * `scripts/ingest.ts` executes that file's top-level `main()` as a side effect
 * of the import — which runs a *full* ingest against whatever happens to be on
 * disk. With no bulk files present that is not a no-op: it truncates every
 * source table and rebuilds an empty universe.
 *
 * That is not hypothetical. It emptied the production database once, and the
 * guard meant to catch it ran after the import had already done the damage.
 * Shared logic belongs in a library; scripts are entry points and must never be
 * imported.
 *
 * The dependency direction is strict and one-way:
 *   license_min -> license_period -> call_state -> universe status -> predictions
 * Each stage destroys and recreates its output rather than patching it. See
 * scripts/refresh.ts for why that is safe to do against a live database.
 */
import type { Database as DB } from 'better-sqlite3';
import { computeAvailability } from '../fcc/availability';
import { PENDING_STATUS, STALE_PENDING_DAYS } from '../fcc/uls';
import { FCC_BANNED } from '../fcc/blocks';

export function log(stage: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${stage.padEnd(11)} ${msg}`);
}

/**
 * Rebuilds every licence-derived table from `license_min`.
 *
 * Split out because the incremental refresh needs exactly this and nothing
 * else: upsert changed source rows, then recompute the whole derived chain.
 * Patching `call_state` in place instead would be faster and has twice produced
 * a database that is internally inconsistent in ways that read as plausible
 * data rather than as an error.
 */
export function deriveFromLicenseMin(db: DB) {
  log('licenses', 'building licence periods …');
  db.exec(`
    DELETE FROM license_period;
    INSERT OR REPLACE INTO license_period (call, usi, start_date, end_date, status)
    SELECT call, usi, grant_date,
           CASE
             WHEN status = 'A' THEN NULL
             WHEN status = 'E' THEN COALESCE(expired_date, cancel_date)
             ELSE COALESCE(cancel_date, expired_date)
           END,
           status
    FROM license_min
    WHERE call IS NOT NULL AND grant_date IS NOT NULL;
  `);
  const lp = db.prepare('SELECT COUNT(*) c FROM license_period').get() as { c: number };
  log('licenses', `${lp.c.toLocaleString()} licence periods`);

  // Collapse to one authoritative record per callsign: an active license always
  // wins, otherwise the most recent action date does.
  log('licenses', 'collapsing to current state per callsign …');
  db.exec(`
    DELETE FROM call_state;
    INSERT INTO call_state (call, usi, status, grant_date, expired_date, cancel_date,
                            last_action_date, operator_class, entity_name, state, ever_issued)
    SELECT call, usi, status, grant_date, expired_date, cancel_date,
           last_action_date, operator_class, entity_name, state, 1
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY call
        ORDER BY (CASE WHEN status='A' THEN 0 ELSE 1 END),
                 COALESCE(last_action_date,'') DESC, usi DESC
      ) rn FROM license_min
    ) WHERE rn = 1;
    CREATE INDEX IF NOT EXISTS idx_call_state_usi ON call_state(usi);
  `);
  const cs = db.prepare('SELECT COUNT(*) c FROM call_state').get() as { c: number };
  log('licenses', `${cs.c.toLocaleString()} distinct callsigns`);
}

export function reconcile(db: DB) {
  log('reconcile', 'computing availability …');
  const rows = db
    .prepare('SELECT call, status, grant_date, expired_date, cancel_date, last_action_date FROM call_state')
    .all() as Array<Record<string, string>>;

  const upd = db.prepare(
    'UPDATE call_state SET available_date=?, available_now=?, avail_rule=?, visibility_bound=? WHERE call=?',
  );
  db.transaction(() => {
    for (const r of rows) {
      const a = computeAvailability({
        status: r.status,
        grantDate: r.grant_date,
        expiredDate: r.expired_date,
        cancelDate: r.cancel_date,
        lastActionDate: r.last_action_date,
      });
      upd.run(a.availableDate, a.availableNow ? 1 : 0, a.rule, a.boundByVisibilityRule ? 1 : 0, r.call);
    }
  })();
  log('reconcile', `availability computed for ${rows.length.toLocaleString()} callsigns`);

  log('reconcile', 'counting pending applications …');
  db.exec(`
    UPDATE universe SET pending_count = 0, status = 'NEVER_ISSUED', available_date = NULL;
    UPDATE universe SET pending_count = COALESCE((
      SELECT COUNT(*) FROM application_call ac
      JOIN application ap ON ap.usi = ac.usi
      WHERE ac.call = universe.call AND ap.app_status = '${PENDING_STATUS}'
        AND ap.receipt_date >= date('now','-${STALE_PENDING_DAYS} day')
    ), 0);
  `);

  log('reconcile', 'assigning status …');
  db.exec(`
    UPDATE universe SET
      available_date = (SELECT cs.available_date FROM call_state cs WHERE cs.call = universe.call),
      status = (SELECT CASE
          -- Availability is decided by the date arithmetic, not by the ULS
          -- status letter. A record still reading 'A' whose grace period has
          -- run is assignable today; testing the letter first is what used to
          -- hide those calls completely.
          WHEN cs.available_now = 1 THEN 'AVAILABLE'
          WHEN cs.status = 'A' AND cs.expired_date IS NOT NULL AND cs.expired_date < date('now')
            THEN 'EXPIRED_WAITING'
          WHEN cs.status = 'A' THEN 'ACTIVE'
          WHEN cs.status = 'E' THEN 'EXPIRED_WAITING'
          WHEN cs.status IN ('C','T') THEN 'CANCELED_WAITING'
          ELSE 'ACTIVE' END
        FROM call_state cs WHERE cs.call = universe.call)
    WHERE EXISTS (SELECT 1 FROM call_state cs WHERE cs.call = universe.call);

    UPDATE universe SET status='AVAILABLE_CONTESTED'
      WHERE status IN ('AVAILABLE','NEVER_ISSUED') AND pending_count > 0;

    UPDATE universe SET status='UPCOMING'
      WHERE status IN ('EXPIRED_WAITING','CANCELED_WAITING')
        AND available_date IS NOT NULL AND available_date <= date('now','+365 day');

    UPDATE universe SET status='REGION_LOCKED'
      WHERE region_locked = 1 AND status IN ('NEVER_ISSUED','AVAILABLE');
  `);

  // An open application outranks every other signal: the call looks open, the
  // arithmetic says open, and it will not be granted to anyone while the
  // Commission still has something in front of it. Applied only where it
  // changes the answer — an application against a licence that lapsed last
  // month is unremarkable, and flagging those would bury the real cases.
  //
  // Deliberately not restricted to renewals. Amending a pending renewal
  // rewrites its purpose code to AM, so filtering on RO/RM misses a third of
  // them; see src/lib/fcc/blocks.ts.
  log('reconcile', 'applying holds …');
  db.exec(`
    UPDATE universe SET status='BLOCKED_PENDING'
      WHERE status IN ('AVAILABLE','AVAILABLE_CONTESTED','UPCOMING')
        AND EXISTS (SELECT 1 FROM call_block cb WHERE cb.call = universe.call);
  `);

  const banned = Object.keys(FCC_BANNED);
  if (banned.length) {
    db.prepare(
      `UPDATE universe SET status='BANNED' WHERE call IN (${banned.map(() => '?').join(',')})`,
    ).run(...banned);
  }

  // Anomaly: open on paper for over a year, yet every application for it has
  // been dismissed. That is the fingerprint of an undocumented FCC hold.
  log('reconcile', 'detecting anomalies …');
  db.exec(`
    UPDATE universe SET status='ANOMALY'
    WHERE status IN ('AVAILABLE','AVAILABLE_CONTESTED')
      AND available_date IS NOT NULL
      AND available_date <= date('now','-365 day')
      AND (SELECT COUNT(*) FROM application_call ac JOIN application ap ON ap.usi=ac.usi
           WHERE ac.call = universe.call AND ap.app_status = 'D') >= 2
      AND (SELECT COUNT(*) FROM application_call ac JOIN application ap ON ap.usi=ac.usi
           WHERE ac.call = universe.call AND ap.app_status = 'G') = 0;
  `);

  const counts = db
    .prepare('SELECT status, COUNT(*) c FROM universe GROUP BY status ORDER BY c DESC')
    .all() as Array<{ status: string; c: number }>;
  for (const c of counts) log('reconcile', `  ${c.status.padEnd(22)} ${c.c.toLocaleString()}`);
}
