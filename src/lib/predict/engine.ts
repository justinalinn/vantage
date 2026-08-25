/**
 * Runs the RSD solver across every open FCC vanity batch.
 *
 * A "batch" is the set of pending vanity applications sharing a receipt date —
 * exactly the set the FCC processes together in random order. Before solving we
 * filter each applicant's preference list down to calls that could actually be
 * granted to *that* applicant on *that* date, because an ineligible entry is
 * simply skipped by the FCC rather than blocking the list.
 */

import type { Database as DB } from 'better-sqlite3';
import { solveBatch, type RsdApplication } from './rsd';
import { groupForCall, classCanHold, type OperatorClass } from '../callsign/groups';
import { reservedReason } from '../callsign/reserved';
import { parseCall } from '../callsign/format';
import { regionForState, isGeographicallyRestricted, regionForCall } from '../callsign/regions';
import { PENDING_STATUS, HOLD_BYPASS_TYPES, STALE_PENDING_DAYS } from '../fcc/uls';
import { bannedReason } from '../fcc/blocks';

export type Outcome =
  | 'ASSIGNMENT'
  | 'COMPETITION'
  | 'AVAILABLE'
  | 'UNNEEDED'
  | 'TAKEN'
  | 'TOO_EARLY'
  | 'ACTIVE_CALLSIGN'
  | 'INSUFFICIENT_CLASS'
  | 'RESTRICTED_REGION'
  | 'RESERVED_CALLSIGN'
  | 'INVALID_FORMAT'
  | 'DUPLICATE'
  | 'OFFLINED'
  | 'BANNED'
  | 'BLOCKED_PENDING'
  | 'NO_ELIGIBLE_CALLS';

export interface CallFilterResult {
  call: string;
  eligible: boolean;
  reason?: Outcome;
  detail?: string;
}

interface PendingApp {
  usi: number;
  applicant_call: string;
  receipt_date: string;
  operator_class: string | null;
  request_type: string | null;
  state: string | null;
  entity_name: string | null;
}

/**
 * Can this applicant be granted this call, on this receipt date?
 * Mirrors the FCC's own dismissal reasons so the UI can explain a rejection.
 */
export function filterCall(
  call: string,
  opts: {
    operatorClass: string | null;
    state: string | null;
    receiptDate: string;
    /** From call_state: null when never issued. */
    availableDate: string | null;
    licenseStatus: string | null;
    /** From call_state, so "active" can be distinguished from "lapsed but held". */
    expiredDate?: string | null;
    requestType: string | null;
    /** A renewal is pending on this call, freezing it indefinitely. */
    blockedByRenewal?: boolean;
  },
): CallFilterResult {
  const parsed = parseCall(call);
  if (!parsed) {
    return { call, eligible: false, reason: 'INVALID_FORMAT', detail: 'Not a valid US amateur callsign format.' };
  }

  const res = reservedReason(call);
  if (res) {
    return { call, eligible: false, reason: 'RESERVED_CALLSIGN', detail: res.detail };
  }

  const group = groupForCall(call);
  if (!group) {
    return { call, eligible: false, reason: 'INVALID_FORMAT', detail: 'No FCC call sign group covers this format.' };
  }

  const cls = (opts.operatorClass ?? '') as OperatorClass;
  if (cls && !classCanHold(cls, group)) {
    return {
      call,
      eligible: false,
      reason: 'INSUFFICIENT_CLASS',
      detail: `Group ${group} requires a higher operator class than ${cls}.`,
    };
  }

  if (isGeographicallyRestricted(parsed.prefix)) {
    const need = regionForCall(parsed.prefix, parsed.digit);
    const have = regionForState(opts.state);
    if (have !== need) {
      return {
        call,
        eligible: false,
        reason: 'RESTRICTED_REGION',
        detail: `Requires a mailing address in region ${need}; applicant is in ${opts.state ?? 'unknown'}.`,
      };
    }
  }

  const ban = bannedReason(call);
  if (ban) {
    return { call, eligible: false, reason: 'BANNED', detail: ban };
  }

  if (opts.blockedByRenewal) {
    return {
      call,
      eligible: false,
      reason: 'BLOCKED_PENDING',
      detail: 'An application is pending on this licence, which freezes the call until the Commission acts on it.',
    };
  }

  // Former-holder and deceased-relative request types bypass the 2-year hold.
  const bypassesHold = opts.requestType != null && HOLD_BYPASS_TYPES.has(opts.requestType);

  // Whether the call was assignable is a question about dates, not about the
  // ULS status letter. A licence still recorded as Active may have lapsed years
  // ago and cleared its grace period; short-circuiting on the letter used to
  // rule those calls out for every applicant, which is why they never appeared
  // as contested and never appeared as winnable.
  const stillLicensed =
    opts.licenseStatus === 'A' &&
    (opts.expiredDate == null || opts.expiredDate >= opts.receiptDate);

  if (stillLicensed) {
    return { call, eligible: false, reason: 'ACTIVE_CALLSIGN', detail: 'Currently licensed to someone else.' };
  }

  if (!bypassesHold && opts.availableDate && opts.availableDate > opts.receiptDate) {
    return {
      call,
      eligible: false,
      reason: 'TOO_EARLY',
      detail: `Not assignable until ${opts.availableDate}, which is after this application's receipt date. The FCC dismisses vanity requests filed even one day early.`,
    };
  }

  if (!bypassesHold && !opts.availableDate && opts.licenseStatus != null) {
    return {
      call,
      eligible: false,
      reason: 'ACTIVE_CALLSIGN',
      detail: 'Licensed, with no expiration recorded from which a hold could be computed.',
    };
  }

  return { call, eligible: true };
}

export function runPredictions(db: DB) {
  const t0 = Date.now();
  console.log('[predict]     loading pending vanity applications …');

  const allPending = db
    .prepare(
      `SELECT usi, applicant_call, receipt_date, operator_class, request_type, state, entity_name
       FROM application
       WHERE app_status = ? AND receipt_date IS NOT NULL`,
    )
    .all(PENDING_STATUS) as PendingApp[];

  // Split off applications the FCC has clearly taken offline for manual review.
  // They are recorded as pending but their batch date passed long ago, so they
  // are not competing for anything and must not inflate contention.
  const cutoff = new Date(Date.now() - STALE_PENDING_DAYS * 86400000).toISOString().slice(0, 10);
  const apps = allPending.filter((a) => a.receipt_date >= cutoff);
  const offlined = allPending.filter((a) => a.receipt_date < cutoff);
  if (offlined.length) {
    console.log(`[predict]     ${offlined.length} offlined (pending past their batch date, oldest ${offlined.reduce((m, a) => (a.receipt_date < m ? a.receipt_date : m), '9999')})`);
  }

  if (apps.length === 0) {
    console.log('[predict]     no pending applications found');
    return;
  }

  const prefStmt = db.prepare('SELECT seq, call FROM application_call WHERE usi = ? ORDER BY seq');
  const stateStmt = db.prepare(
    'SELECT status, available_date, expired_date FROM call_state WHERE call = ?',
  );

  // Calls frozen by an application the FCC has not acted on. Small set (a few
  // hundred), loaded once so the per-preference filter stays a hash lookup.
  const frozen = new Set<string>(
    (db.prepare('SELECT DISTINCT call FROM call_block').all() as Array<{ call: string }>).map((r) => r.call),
  );
  console.log(`[predict]     ${frozen.size.toLocaleString()} calls frozen by a pending FCC action`);

  // Batch by receipt date, then rank the dates: batches resolve on different
  // nights, in receipt-date order. An applicant in an earlier batch takes a
  // contested call before a later batch is ever processed, which is the FCC's
  // "Too Late" dismissal. Solving each batch in isolation misses that entirely
  // and overstates the odds for later filers.
  const batches = new Map<string, PendingApp[]>();
  for (const a of apps) {
    if (!batches.has(a.receipt_date)) batches.set(a.receipt_date, []);
    batches.get(a.receipt_date)!.push(a);
  }
  const tierOf = new Map<string, number>();
  [...batches.keys()].sort().forEach((d, i) => tierOf.set(d, i));
  console.log(
    `[predict]     ${apps.length.toLocaleString()} pending apps across ${batches.size.toLocaleString()} batches (tiered by receipt date)`,
  );

  db.exec('DELETE FROM prediction; DELETE FROM prediction_app;');
  const insPred = db.prepare('INSERT OR REPLACE INTO prediction (usi, call, p, method, ci) VALUES (?,?,?,?,?)');
  const insApp = db.prepare(
    'INSERT OR REPLACE INTO prediction_app (usi, best_call, best_p, p_any, p_nothing, method, outcome) VALUES (?,?,?,?,?,?,?)',
  );

  type CallState = { status: string | null; available_date: string | null; expired_date: string | null };
  const stateCache = new Map<string, CallState>();
  const lookupState = (call: string): CallState => {
    let s = stateCache.get(call);
    if (s === undefined) {
      s = (stateStmt.get(call) as CallState | undefined) ?? {
        status: null,
        available_date: null,
        expired_date: null,
      };
      stateCache.set(call, s);
    }
    return s;
  };

  // call -> number of pending applications that could actually be granted it
  const eligibleByCall = new Map<string, number>();

  let solved = 0;
  let exactCount = 0;
  let mcCount = 0;
  let maxBatch = 0;

  const solveAll = db.transaction((groups: Array<[string, PendingApp[]]>) => {
    // Same-day duplicate filings from one applicant, per 47 CFR 97.19(d)(1).
    //
    // The rule is not "everything is dismissed": the Commission processes only
    // the *first* such application entered into the ULS and dismisses the rest.
    // The unique system identifier is assigned in entry order, so the lowest
    // USI is the survivor. Dismissing the whole set would wrongly zero out a
    // real contender and hand their calls to rivals.
    const duplicates = new Set<number>();
    for (const [, group] of groups) {
      const byApplicant = new Map<string, PendingApp[]>();
      for (const a of group) {
        const k = a.applicant_call || `usi:${a.usi}`;
        if (!byApplicant.has(k)) byApplicant.set(k, []);
        byApplicant.get(k)!.push(a);
      }
      for (const [, list] of byApplicant) {
        if (list.length <= 1) continue;
        const survivor = list.reduce((lo, a) => (a.usi < lo.usi ? a : lo), list[0]);
        for (const a of list) if (a.usi !== survivor.usi) duplicates.add(a.usi);
      }
    }

    const rsdApps: RsdApplication[] = [];
    const skipped = new Map<number, Outcome>();

    for (const [receipt, group] of groups)
    for (const a of group) {
      if (duplicates.has(a.usi)) {
        skipped.set(a.usi, 'DUPLICATE');
        continue;
      }
      const prefs = prefStmt.all(a.usi) as Array<{ seq: number; call: string }>;
      const eligible: string[] = [];
      for (const p of prefs) {
        const cs = lookupState(p.call);
        const r = filterCall(p.call, {
          operatorClass: a.operator_class,
          state: a.state,
          receiptDate: receipt,
          availableDate: cs.available_date,
          licenseStatus: cs.status,
          expiredDate: cs.expired_date,
          requestType: a.request_type,
          blockedByRenewal: frozen.has(p.call),
        });
        if (r.eligible) {
          eligible.push(p.call);
          eligibleByCall.set(p.call, (eligibleByCall.get(p.call) ?? 0) + 1);
        }
      }
      if (eligible.length === 0) {
        skipped.set(a.usi, 'NO_ELIGIBLE_CALLS');
        continue;
      }
      rsdApps.push({ id: String(a.usi), prefs: eligible, tier: tierOf.get(receipt) ?? 0 });
    }

    if (rsdApps.length > 0) {
      const res = solveBatch(rsdApps);
      maxBatch = Math.max(maxBatch, rsdApps.length);

      for (const o of res.outcomes) {
        const usi = Number(o.appId);
        let bestCall: string | null = null;
        let bestP = 0;
        let pAny = 0;
        if (o.method === 'monte-carlo') mcCount++;
        else exactCount++;
        for (const [call, p] of Object.entries(o.byCall)) {
          insPred.run(usi, call, p, o.method, o.ci);
          pAny += p;
          if (p > bestP) {
            bestP = p;
            bestCall = call;
          }
        }
        let outcome: Outcome;
        if (bestP >= 0.9999) outcome = 'ASSIGNMENT';
        else if (pAny >= 0.9999) outcome = 'UNNEEDED';
        else if (pAny <= 1e-9) outcome = 'TAKEN';
        else outcome = 'COMPETITION';
        insApp.run(usi, bestCall, bestP, pAny, o.pNothing, o.method, outcome);
      }
    }

    for (const [usi, reason] of skipped) {
      insApp.run(usi, null, 0, 0, 1, 'rule', reason);
    }
    for (const [, group] of groups) solved += group.length;
  });

  solveAll([...batches.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  const insOfflined = db.transaction(() => {
    for (const a of offlined) insApp.run(a.usi, null, 0, 0, 1, 'rule', 'OFFLINED');
  });
  insOfflined();

  // Write back how many pending applicants are genuinely in contention.
  db.exec('UPDATE universe SET eligible_pending = 0 WHERE eligible_pending != 0;');
  const updElig = db.prepare('UPDATE universe SET eligible_pending = ? WHERE call = ?');
  db.transaction(() => {
    for (const [call, n] of eligibleByCall) updElig.run(n, call);
  })();

  // How much of each call is spoken for by the pending field, and how much
  // survives to a new filer. Summing the per-applicant probabilities is exact:
  // at most one applicant can be granted a given call, so the events are
  // mutually exclusive.
  db.exec(`
    UPDATE universe SET claimed_p = 0, survive_p = 1 WHERE claimed_p != 0 OR survive_p != 1;
    UPDATE universe SET
      claimed_p = COALESCE((SELECT SUM(pr.p) FROM prediction pr WHERE pr.call = universe.call), 0)
    WHERE pending_count > 0;
    UPDATE universe SET survive_p = MAX(0.0, 1.0 - claimed_p) WHERE pending_count > 0;
  `);

  // Denormalize the best probability per call so search stays single-table.
  db.exec(`
    UPDATE universe SET p = NULL, p_method = NULL, p_ci = NULL WHERE p IS NOT NULL;
    UPDATE universe SET
      p        = (SELECT MAX(pr.p)  FROM prediction pr WHERE pr.call = universe.call),
      p_method = (SELECT pr.method  FROM prediction pr WHERE pr.call = universe.call ORDER BY pr.p DESC LIMIT 1),
      p_ci     = (SELECT pr.ci      FROM prediction pr WHERE pr.call = universe.call ORDER BY pr.p DESC LIMIT 1)
    WHERE EXISTS (SELECT 1 FROM prediction pr WHERE pr.call = universe.call);
  `);

  console.log(
    `[predict]     solved ${solved.toLocaleString()} apps — ${exactCount} exact, ${mcCount} sampled, ${maxBatch} apps in the joint solve`,
  );
  console.log(`[predict]     ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
