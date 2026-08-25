/**
 * Update scheduling, stored in the database rather than in systemd.
 *
 * The systemd timer fires on a fixed short interval and each run asks *this*
 * module whether it is actually due. That indirection is the whole point: it
 * makes the cadence editable from the site — and from an API call — without
 * root, without rewriting a unit file, and without a restart.
 */
import type { Database as DB } from 'better-sqlite3';
import { getMeta, setMeta } from '../db';

export interface Schedule {
  /** How often to ask the FCC whether new bulk files exist. */
  bulkIntervalMin: number;
  /** Whether to read pending applications off the ULS web interface at all. */
  scrapeEnabled: boolean;
  /** How often to do that. */
  scrapeIntervalMin: number;
  /**
   * Restrict scraping to 22:00-06:00 local.
   *
   * K2CR limits their own scraping to outside business hours to avoid loading
   * ULS, and says so publicly. Same courtesy, defaulted on.
   */
  scrapeOffHoursOnly: boolean;
  /** Upper bound on pages fetched per scrape run. */
  scrapeMaxPages: number;
  /** Seconds to wait between page fetches. */
  scrapeDelaySec: number;
}

export const DEFAULTS: Schedule = {
  bulkIntervalMin: 30,
  scrapeEnabled: false,
  scrapeIntervalMin: 180,
  scrapeOffHoursOnly: true,
  scrapeMaxPages: 120,
  scrapeDelaySec: 6,
};

const KEY = 'schedule';

export function getSchedule(db: DB): Schedule {
  const raw = getMeta(db, KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Schedule>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSchedule(db: DB, patch: Partial<Schedule>): Schedule {
  const next = clamp({ ...getSchedule(db), ...patch });
  setMeta(db, KEY, JSON.stringify(next));
  return next;
}

/**
 * Bounds that keep a mistyped value from becoming a denial-of-service against
 * either the FCC or this box. A 1-minute scrape interval with no ceiling on
 * pages is how a well-meaning tool gets an IP banned.
 */
function clamp(s: Schedule): Schedule {
  return {
    bulkIntervalMin: Math.min(Math.max(Math.round(s.bulkIntervalMin), 5), 24 * 60),
    scrapeEnabled: !!s.scrapeEnabled,
    scrapeIntervalMin: Math.min(Math.max(Math.round(s.scrapeIntervalMin), 30), 7 * 24 * 60),
    scrapeOffHoursOnly: !!s.scrapeOffHoursOnly,
    scrapeMaxPages: Math.min(Math.max(Math.round(s.scrapeMaxPages), 1), 500),
    scrapeDelaySec: Math.min(Math.max(Math.round(s.scrapeDelaySec), 2), 120),
  };
}

function minutesSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (Date.now() - t) / 60000;
}

export function bulkDue(db: DB, now = new Date()): boolean {
  void now;
  return minutesSince(getMeta(db, 'last_bulk_check')) >= getSchedule(db).bulkIntervalMin;
}

export interface ScrapeDecision {
  due: boolean;
  reason: string;
}

export function scrapeDue(db: DB, now = new Date()): ScrapeDecision {
  const s = getSchedule(db);
  if (!s.scrapeEnabled) return { due: false, reason: 'scraping is disabled' };

  const since = minutesSince(getMeta(db, 'last_scrape'));
  if (since < s.scrapeIntervalMin) {
    return { due: false, reason: `last run ${Math.round(since)} min ago, interval is ${s.scrapeIntervalMin}` };
  }

  if (s.scrapeOffHoursOnly) {
    const h = now.getHours();
    if (h >= 6 && h < 22) return { due: false, reason: 'outside the 22:00-06:00 window' };
  }

  // Deliberately not gated on `application_unlisted` being non-empty. The
  // larger gap is applications ULS is serving that have no bulk header at all,
  // and those are invisible here until the lookup actually runs.
  const pending = (
    db.prepare('SELECT COUNT(*) c FROM application_unlisted').get() as { c: number }
  ).c;
  return {
    due: true,
    reason: pending
      ? `${pending} known applications await preference lists, plus anything ULS has that we do not`
      : 'checking ULS for applications not yet in the published files',
  };
}
