/**
 * Executes a ParsedQuery against the universe table.
 *
 * Everything is expressed as SQL so a 1.15M-row universe stays responsive, and
 * probability is joined in from the prediction table rather than recomputed.
 */

import { getDb } from '../db';
import { globToLike, type ParsedQuery } from './parse';
import { CLASS_ELIGIBLE_GROUPS } from '../callsign/groups';
import { filterCall } from '../predict/engine';
import { PENDING_STATUS } from '../fcc/uls';

export interface SearchRow {
  call: string;
  format: string;
  region: number;
  grp: string;
  status: string;
  available_date: string | null;
  pending_count: number;
  eligible_pending: number;
  morse: number;
  phonetic: number;
  desirability: number;
  region_locked: number;
  /** Share of this call already spoken for by pending applicants. */
  claimed_p: number;
  /** Chance the call is still unclaimed once every open batch resolves. */
  survive_p: number;
  /** Leading pending applicant's own win probability — detail views only. */
  p: number | null;
  method: string | null;
  ci: number | null;
}

export interface SearchResult {
  rows: SearchRow[];
  total: number;
  /** True when `total` hit the counting cap and the real figure is larger. */
  approximate: boolean;
  shape: Array<{ status: string; count: number }>;
  tookMs: number;
}

export type SortKey = 'call' | 'avail' | 'comp' | 'morse' | 'des' | 'p' | 'region' | 'open';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
}

const VOWELS = ['A', 'E', 'I', 'O', 'U'];

/** Upper bound on rows counted for the result-shape summary. */
const COUNT_CAP = 100_000;

function buildWhere(q: ParsedQuery): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (q.formats.length) {
    where.push(`u.format IN (${q.formats.map(() => '?').join(',')})`);
    params.push(...q.formats);
  }
  if (q.regions.length) {
    where.push(`u.region IN (${q.regions.map(() => '?').join(',')})`);
    params.push(...q.regions);
  }
  if (q.prefixes.length) {
    where.push(`(${q.prefixes.map(() => 'u.prefix = ?').join(' OR ')})`);
    params.push(...q.prefixes);
  }
  if (q.groups.length) {
    where.push(`u.grp IN (${q.groups.map(() => '?').join(',')})`);
    params.push(...q.groups);
  }
  if (q.statuses.length) {
    where.push(`u.status IN (${q.statuses.map(() => '?').join(',')})`);
    params.push(...q.statuses);
  }
  if (q.pattern) {
    if (q.pattern.includes('*') || q.pattern.includes('?')) {
      where.push('u.call LIKE ?');
      params.push(globToLike(q.pattern));
      // A LIKE whose wildcard is not at the end cannot use the primary key, so
      // "K?A*" would scan all 1.15M rows. The literal head of the pattern is
      // still a valid range bound, which turns the scan back into a seek.
      const head = q.pattern.replace(/[*?].*$/, '');
      if (head.length > 0) {
        where.push('u.call >= ? AND u.call < ?');
        params.push(head, `${head}￿`);
      }
    } else {
      // Bare text: prefix match first, which is what people expect while typing.
      where.push('(u.call = ? OR u.call LIKE ?)');
      params.push(q.pattern, `${q.pattern}%`);
    }
  }
  if (q.suffixEndsWith) {
    where.push('u.suffix LIKE ?');
    params.push(`%${q.suffixEndsWith}`);
  }
  if (q.suffixStartsWith) {
    where.push('u.suffix LIKE ?');
    params.push(`${q.suffixStartsWith}%`);
  }
  if (q.suffixClass === 'vowel') {
    where.push(`substr(u.suffix, -1) IN (${VOWELS.map(() => '?').join(',')})`);
    params.push(...VOWELS);
  } else if (q.suffixClass === 'consonant') {
    where.push(`substr(u.suffix, -1) NOT IN (${VOWELS.map(() => '?').join(',')})`);
    params.push(...VOWELS);
  }
  if (q.repeatingOnly) {
    // Repeated letters, or an ascending/descending run.
    where.push(`(
      (length(u.suffix) >= 2 AND u.suffix = replace(u.suffix, substr(u.suffix,1,1), substr(u.suffix,1,1))
        AND substr(u.suffix,1,1) = substr(u.suffix,2,1)
        AND (length(u.suffix) < 3 OR substr(u.suffix,2,1) = substr(u.suffix,3,1)))
      OR (length(u.suffix) = 3 AND unicode(substr(u.suffix,2,1)) = unicode(substr(u.suffix,1,1)) + 1
          AND unicode(substr(u.suffix,3,1)) = unicode(substr(u.suffix,2,1)) + 1)
      OR (length(u.suffix) = 2 AND unicode(substr(u.suffix,2,1)) = unicode(substr(u.suffix,1,1)) + 1)
    )`);
  }
  if (q.maxMorse != null) {
    where.push('u.morse <= ?');
    params.push(q.maxMorse);
  }
  if (q.minDesirability != null) {
    where.push('u.desirability >= ?');
    params.push(q.minDesirability);
  }
  if (q.operatorClass) {
    const groups = CLASS_ELIGIBLE_GROUPS[q.operatorClass];
    where.push(`u.grp IN (${groups.map(() => '?').join(',')})`);
    params.push(...groups);
  }
  // A survival threshold only means something for calls you could actually be
  // granted. Without this, "P>50" matches every ACTIVE call in the country,
  // because nothing is claiming a call that is not even in the pool.
  if (q.minProbability != null && q.statuses.length === 0) {
    where.push(`u.status IN ('NEVER_ISSUED','AVAILABLE','AVAILABLE_CONTESTED','PENDING')`);
  }
  if (q.availableWithinDays != null) {
    if (q.availableWithinDays === 0) {
      where.push(`u.status IN ('NEVER_ISSUED','AVAILABLE','AVAILABLE_CONTESTED')`);
    } else {
      // ACTIVE is excluded deliberately. Every licensed call now carries a
      // projected opening date — expiry plus the 2-year grace — which is real
      // and useful on the detail page but is not an answer to "what can I file
      // for soon". The holder has to lapse first, and most do not.
      where.push(`(u.status IN ('NEVER_ISSUED','AVAILABLE','AVAILABLE_CONTESTED')
                   OR (u.status != 'ACTIVE' AND u.available_date IS NOT NULL
                       AND u.available_date <= date('now', '+' || ? || ' day')))`);
      params.push(q.availableWithinDays);
    }
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SORT_SQL: Record<SortKey, string> = {
  call: 'u.call',
  avail: `CASE WHEN u.status IN ('NEVER_ISSUED','AVAILABLE','AVAILABLE_CONTESTED') THEN '0000-00-00'
               ELSE COALESCE(u.available_date, '9999-12-31') END`,
  comp: 'u.pending_count',
  morse: 'u.morse',
  des: 'u.desirability',
  p: 'COALESCE(u.p, -1)',
  open: 'u.survive_p',
  region: 'u.region',
};

export function search(q: ParsedQuery, opts: SearchOptions = {}): SearchResult {
  const t0 = Date.now();
  const db = getDb();
  const { sql: whereSql, params } = buildWhere(q);

  let extraWhere = '';
  if (q.minProbability != null) {
    // "P>60" now means "at least a 60% chance this is still open to me", which
    // is the question a prospective filer is actually asking.
    extraWhere = whereSql ? ' AND u.survive_p >= ?' : ' WHERE u.survive_p >= ?';
  }

  const sortKey = opts.sort ?? 'des';
  const dir = (opts.dir ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.min(opts.limit ?? 200, 2000);
  const offset = opts.offset ?? 0;

  const allParams = q.minProbability != null ? [...params, q.minProbability] : params;

  const rows = db
    .prepare(
      `SELECT u.call, u.format, u.region, u.grp, u.status, u.available_date, u.pending_count, u.eligible_pending,
              u.morse, u.phonetic, u.desirability, u.region_locked,
              u.claimed_p, u.survive_p,
              u.p, u.p_method AS method, u.p_ci AS ci
       FROM universe u ${whereSql}${extraWhere}
       ORDER BY ${SORT_SQL[sortKey]} ${dir}, u.call ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...allParams, limit, offset) as SearchRow[];

  // The shape breakdown already partitions the result set, so the total is its
  // sum — a separate COUNT(*) would scan the same rows twice.
  //
  // Counting is capped. A query like "2x2 never issued" matches 438k rows, and
  // no one needs that counted precisely to decide what to do next; what matters
  // is the mix and the top of the list. The cap bounds worst-case latency and
  // the UI renders a capped total as "100,000+".
  const shape = db
    .prepare(
      `SELECT status, COUNT(*) count FROM (
         SELECT u.status FROM universe u ${whereSql}${extraWhere} LIMIT ${COUNT_CAP + 1}
       ) GROUP BY status ORDER BY count DESC`,
    )
    .all(...allParams) as Array<{ status: string; count: number }>;

  const counted = shape.reduce((s, x) => s + x.count, 0);
  const approximate = counted > COUNT_CAP;

  return { rows, total: approximate ? COUNT_CAP : counted, approximate, shape, tookMs: Date.now() - t0 };
}

// --------------------------------------------------------------- detail view

export interface CompetitorRow {
  usi: number;
  file_number: string | null;
  applicant_call: string | null;
  entity_name: string | null;
  state: string | null;
  receipt_date: string | null;
  operator_class: string | null;
  request_type: string | null;
  seq: number;
  p: number | null;
  method: string | null;
  /** Why this application cannot be granted this call, when it cannot. */
  ineligible?: string | null;
  ineligibleDetail?: string | null;
  /** 'bulk' from the FCC export, 'uls' read off the web interface early. */
  source?: string | null;
  provisional?: number | null;
}

export interface CallDetail {
  call: string;
  format: string;
  region: number;
  grp: string;
  status: string;
  available_date: string | null;
  pending_count: number;
  eligible_pending: number;
  morse: number;
  phonetic: number;
  desirability: number;
  region_locked: number;
  licence: {
    status: string | null;
    grant_date: string | null;
    expired_date: string | null;
    cancel_date: string | null;
    last_action_date: string | null;
    operator_class: string | null;
    entity_name: string | null;
    state: string | null;
    avail_rule: string | null;
    visibility_bound: number;
  } | null;
  competitors: CompetitorRow[];
  history: Array<{ date: string; title: string; detail: string }>;
}

export function callDetail(call: string): CallDetail | null {
  const db = getDb();
  const u = db.prepare('SELECT * FROM universe WHERE call = ?').get(call) as CallDetail | undefined;
  if (!u) return null;

  const licence = db
    .prepare(
      `SELECT status, grant_date, expired_date, cancel_date, last_action_date,
              operator_class, entity_name, state, avail_rule, visibility_bound
       FROM call_state WHERE call = ?`,
    )
    .get(call) as CallDetail['licence'];

  const competitors = db
    .prepare(
      `SELECT a.usi, a.file_number, a.applicant_call, a.entity_name, a.state,
              a.receipt_date, a.operator_class, a.request_type, ac.seq,
              pr.p, pr.method, ac.source, a.provisional
       FROM application_call ac
       JOIN application a ON a.usi = ac.usi
       LEFT JOIN prediction pr ON pr.usi = a.usi AND pr.call = ac.call
       WHERE ac.call = ? AND a.app_status = ?
       ORDER BY COALESCE(pr.p, 0) DESC, ac.seq ASC`,
    )
    .all(call, PENDING_STATUS) as CompetitorRow[];

  // Annotate each competitor with the reason it cannot win, if it cannot.
  //
  // A raw list of applicants is misleading in the common case. Most contested
  // calls carry filings that the FCC will dismiss outright — filed before the
  // hold ran out, wrong operator class, wrong region — and counting those as
  // rivals makes a call look taken when nobody eligible is chasing it. This is
  // the same gate the predictor applies; surfacing it turns "five applicants"
  // into "five applicants, four of whom filed too early".
  const frozen =
    (db.prepare('SELECT COUNT(*) c FROM call_block WHERE call = ?').get(call) as { c: number }).c > 0;

  for (const c of competitors) {
    if (!c.receipt_date) continue;
    const r = filterCall(call, {
      operatorClass: c.operator_class,
      state: c.state,
      receiptDate: c.receipt_date,
      availableDate: u.available_date,
      licenseStatus: licence?.status ?? null,
      expiredDate: licence?.expired_date ?? null,
      requestType: c.request_type,
      blockedByRenewal: frozen,
    });
    c.ineligible = r.eligible ? null : (r.reason ?? null);
    c.ineligibleDetail = r.eligible ? null : (r.detail ?? null);
  }

  return { ...u, licence: licence ?? null, competitors, history: buildHistory(u, licence ?? null) };
}

function buildHistory(u: CallDetail, l: CallDetail['licence']): Array<{ date: string; title: string; detail: string }> {
  const h: Array<{ date: string; title: string; detail: string }> = [];
  if (!l) {
    h.push({
      date: '—',
      title: 'Never issued',
      detail: 'No grant record exists anywhere in the complete ULS assignment history.',
    });
    return h;
  }
  if (l.grant_date) {
    h.push({ date: l.grant_date, title: 'Granted', detail: l.entity_name ? `Assigned to ${l.entity_name}.` : 'Licence granted.' });
  }
  if (l.expired_date) {
    h.push({ date: l.expired_date, title: 'Expiration date', detail: 'End of the 10-year licence term.' });
  }
  if (l.cancel_date) {
    h.push({ date: l.cancel_date, title: 'Canceled', detail: 'Licence canceled in the ULS.' });
  }
  if (l.last_action_date) {
    h.push({ date: l.last_action_date, title: 'Last ULS action', detail: 'Most recent change recorded by the FCC.' });
  }
  if (u.available_date) {
    h.push({
      date: u.available_date,
      title: 'Enters the vanity pool',
      detail: l.avail_rule ?? 'Computed from the 2-year hold.',
    });
  }
  return h.sort((a, b) => a.date.localeCompare(b.date));
}
