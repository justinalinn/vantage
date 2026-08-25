/**
 * Where ULS data comes from, and when it appears.
 *
 * The FCC publishes two things:
 *
 *   - **Complete files** (`l_amat.zip`, `a_amat.zip`) — the entire amateur
 *     database, rebuilt weekly. ~520 MB together.
 *   - **Daily transaction files** (`l_am_mon.zip` … `a_am_sat.zip`) — only the
 *     records that changed, Tuesday through Saturday, each covering the
 *     previous business day. 27–125 KB each.
 *
 * The daily files are the entire reason this tool can be current. Rebuilding
 * from the weekly dump alone leaves the site up to seven days behind, which is
 * exactly the gap a user notices: an application filed on Monday is invisible
 * until the following Sunday, so a call that is already spoken for still reads
 * as uncontested, and the recommendation built on it is wrong.
 *
 * Note the day-of-week filenames are a rotating six-slot buffer, not an
 * archive: `l_am_tue.zip` is overwritten every Tuesday. There is no way to
 * fetch a specific historical date, so a gap longer than a week can only be
 * closed by re-pulling the complete files.
 */

/**
 * ## Where the incumbents get their data
 *
 * K2CR's footer credits the `fcc-db` project (Josh Cepek, GPLv3). Its
 * `uls-fetch.sh` pulls from `ftp://wirelessftp.fcc.gov/pub/uls/`, using exactly
 * the paths below — `complete/{l,a}_amat.zip` and `daily/{l,a}_am_{day}.zip` —
 * and checks freshness with `curl -I`, the same conditional request this module
 * makes over HTTPS. The FTP host mirrors data.fcc.gov byte for byte: on
 * 2026-08-18 both served `a_am_mon.zip` at 32,686 bytes with an identical
 * timestamp. **There is no bulk feed anyone has that this project does not.**
 *
 * The FTP host does offer one thing HTTPS does not: a directory listing, which
 * answers "what exists and when did it change" in one request instead of
 * twelve HEADs. Worth knowing about; not worth adopting, because it trades a
 * proven path for one that firewalls and passive-mode negotiation can break,
 * and twelve HEADs cost about a second.
 *
 * That listing also confirmed two quirks this module already handles: Sunday
 * slots exist as 212-byte stubs, and a slot can go stale for weeks —
 * `l_am_tue.zip` had not been rewritten since 5 August.
 *
 * So the incumbents' extra freshness is not a better bulk pipeline. K2CR's own
 * FAQ says where it comes from: they additionally scrape the ULS web
 * interface, which yields application entry timestamps (parsed out of the PDF
 * reference copy), payment status, applications pending but not yet exported,
 * and "1 - Submitted" applications that ULS search will not even return —
 * that last one implying they walk application IDs directly rather than
 * searching. They restrict it to outside business hours to avoid loading ULS.
 *
 * That interface answers 403 to this project from every host tried, so the
 * remaining gap is reported rather than closed. See `application_unlisted`.
 */
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];

const BASE = 'https://data.fcc.gov/download/pub/uls';

export interface UlsSource {
  /** Stable key used in the `meta` table to remember what has been applied. */
  key: string;
  name: string;
  url: string;
  kind: 'license' | 'application';
  cadence: 'weekly' | 'daily';
  day?: Day;
}

export const WEEKLY: UlsSource[] = [
  { key: 'src:l_amat', name: 'l_amat.zip', url: `${BASE}/complete/l_amat.zip`, kind: 'license', cadence: 'weekly' },
  { key: 'src:a_amat', name: 'a_amat.zip', url: `${BASE}/complete/a_amat.zip`, kind: 'application', cadence: 'weekly' },
];

/**
 * Sunday is deliberately absent. The FCC publishes a 212-byte stub for it —
 * the weekly rebuild covers that day — and treating the stub as data produces
 * an empty delta that looks like a successful no-op update.
 */
export const DAILY: UlsSource[] = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as Day[]).flatMap((d) => [
  {
    key: `src:l_am_${d}`,
    name: `l_am_${d}.zip`,
    url: `${BASE}/daily/l_am_${d}.zip`,
    kind: 'license' as const,
    cadence: 'daily' as const,
    day: d,
  },
  {
    key: `src:a_am_${d}`,
    name: `a_am_${d}.zip`,
    url: `${BASE}/daily/a_am_${d}.zip`,
    kind: 'application' as const,
    cadence: 'daily' as const,
    day: d,
  },
]);

export const ALL_SOURCES = [...WEEKLY, ...DAILY];

/** Anything at or below this is the FCC's empty-file stub, not a real delta. */
export const STUB_BYTES = 1024;

/**
 * When to bother asking.
 *
 * The FCC's own documentation says complete files are built 05:00 ET Sunday and
 * dailies 05:00 ET Tuesday–Saturday, but the observed `Last-Modified` on
 * data.fcc.gov runs later and moves around: 12:00 UTC on weekdays, 08:00 UTC
 * after a Friday, 13:00 UTC after a Saturday. Publishing lag is not something
 * to hard-code against.
 *
 * So the schedule below is only a hint about when to *poll*, and polling is a
 * conditional HEAD costing a few hundred bytes. What actually triggers an
 * update is a `Last-Modified` newer than the one already applied, which is
 * correct whenever the file lands.
 */
export const POLL_WINDOW_UTC = { startHour: 7, endHour: 16 };

/** Poll every 30 min inside the publication window, every 4 h outside it. */
export function pollIntervalMs(now: Date = new Date()): number {
  const h = now.getUTCHours();
  const inWindow = h >= POLL_WINDOW_UTC.startHour && h <= POLL_WINDOW_UTC.endHour;
  return inWindow ? 30 * 60_000 : 4 * 60 * 60_000;
}

/**
 * Which daily files could plausibly be newer than the given complete-file date.
 *
 * A daily slot is only worth applying when the FCC has rewritten it *since* the
 * weekly rebuild the database was last loaded from. Because the slots rotate
 * weekly, anything older than that has already been folded into the complete
 * file and re-applying it is a no-op at best.
 */
export function dailiesWorthChecking(kind: 'license' | 'application'): UlsSource[] {
  return DAILY.filter((d) => d.kind === kind);
}
