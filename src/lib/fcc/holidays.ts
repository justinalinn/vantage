/**
 * US federal holidays. The FCC's vanity batch schedule counts Federal workdays,
 * so holiday handling directly shifts a user's predicted grant date.
 *
 * Observance rule: a holiday falling on Saturday is observed the preceding
 * Friday; one falling on Sunday is observed the following Monday.
 */

export function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + shift + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, last.getUTCDate() - shift);
}

/** Actual (unobserved) federal holiday dates for a year. */
function baseHolidays(year: number): Date[] {
  return [
    utc(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // MLK Jr. Day — 3rd Monday
    nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday — 3rd Monday
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day — last Monday
    utc(year, 6, 19), // Juneteenth
    utc(year, 7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day — 1st Monday
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus Day — 2nd Monday
    utc(year, 11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving — 4th Thursday
    utc(year, 12, 25), // Christmas
  ];
}

function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - 86400000); // Sat -> Fri
  if (dow === 0) return new Date(d.getTime() + 86400000); // Sun -> Mon
  return d;
}

const cache = new Map<number, Set<string>>();

export function federalHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<string>();
  for (const d of baseHolidays(year)) set.add(ymd(observed(d)));
  // A Jan 1 falling on Saturday is observed Dec 31 of the prior year, which
  // lands in this year's calendar only when we look at the next year.
  for (const d of baseHolidays(year + 1)) {
    const o = observed(d);
    if (o.getUTCFullYear() === year) set.add(ymd(o));
  }
  cache.set(year, set);
  return set;
}

export function isFederalHoliday(d: Date): boolean {
  return federalHolidays(d.getUTCFullYear()).has(ymd(d));
}

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** A Federal workday: not a weekend, not a holiday. */
export function isWorkday(d: Date): boolean {
  return !isWeekend(d) && !isFederalHoliday(d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** The first Federal workday on or after `d`. */
export function nextWorkdayOnOrAfter(d: Date): Date {
  let cur = d;
  for (let i = 0; i < 30; i++) {
    if (isWorkday(cur)) return cur;
    cur = addDays(cur, 1);
  }
  return cur;
}

/** The first Federal workday strictly after `d`. */
export function nextWorkdayAfter(d: Date): Date {
  return nextWorkdayOnOrAfter(addDays(d, 1));
}
