/**
 * When does a callsign become available?
 *
 * The rules, from 47 CFR 97.19 and the ULS field semantics documented by AE7Q:
 *
 *  - Canceled license: available 2 years + 1 day after the cancel date, OR 31
 *    days after the last action date, whichever is LATER. The second term
 *    enforces 97.19(c)(3)'s 30-day visibility rule, which matters because the
 *    FCC sometimes back-sets cancel_date to (last_action + 30d - 2y) so the two
 *    terms deliberately collide.
 *  - Expired license: the FCC leaves status "Active" until 2 years + 1 day past
 *    the expiration date, then flips it to "Expired" and stamps cancel_date and
 *    last_action_date with the current date. Once that flip happens the call is
 *    immediately available.
 *  - Active license whose expiry has already passed: the licence is inside the
 *    2-year grace window and the call opens at expiry + 2 years + 1 day. See
 *    the long note on the 'A' branch below — this is the single highest-impact
 *    rule in the file.
 *  - Active license not yet expired: opens at expiry + 2 years + 1 day *if* the
 *    holder lets it lapse. Most renew, so this is a projection, not a promise.
 *  - Never issued: available now, permanently, with no competition.
 */

export type LicenseStatus = 'A' | 'C' | 'E' | 'T' | 'X' | string;

export const THIRTY_ONE_DAYS_MS = 31 * 86400000;

/**
 * "Two years and one day" is calendar arithmetic, not a fixed 731 days.
 *
 * A hold that spans a leap day covers 732 actual days, so treating the term as
 * a constant lands a day early — and an application filed one day early is
 * dismissed outright, forfeiting the fee. This adds two calendar years and then
 * one day, which is what the rule actually says.
 */
export function twoYearsAndADay(from: number): number {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

export interface AvailabilityInput {
  status: LicenseStatus | null;
  grantDate: string | null;
  expiredDate: string | null;
  cancelDate: string | null;
  lastActionDate: string | null;
}

export interface AvailabilityResult {
  /** ISO date the call becomes assignable, or null when it never will/already is. */
  availableDate: string | null;
  /** True when assignable today. */
  availableNow: boolean;
  /** The date the license stopped being active (cancel date, else expiry). */
  endDate: string | null;
  /** Which rule produced the answer — surfaced to the user as a trace. */
  rule: string;
  /** True when the 31-day visibility term bound rather than the 2-year term. */
  boundByVisibilityRule: boolean;
}

function parse(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function computeAvailability(
  input: AvailabilityInput,
  now: Date = new Date(),
): AvailabilityResult {
  const { status } = input;
  const cancel = parse(input.cancelDate);
  const expired = parse(input.expiredDate);
  const lastAction = parse(input.lastActionDate);
  const nowMs = now.getTime();

  const endDate = cancel ?? expired;

  // Never issued / no record at all.
  if (!status) {
    return {
      availableDate: null,
      availableNow: true,
      endDate: null,
      rule: 'No license record exists in the complete ULS history — permanently available.',
      boundByVisibilityRule: false,
    };
  }

  if (status === 'A') {
    // "Active" in ULS does not mean "in use". The FCC never flips a record to
    // Expired at its expiration date — it leaves the status at 'A' for the
    // whole 2-year grace period and only sweeps afterwards, stamping
    // cancel_date at that point.
    //
    // Reading 'A' as "not assignable" therefore hides every call that is
    // sitting in, or has already run out, its grace window. Measured against
    // this database that was 508 calls already assignable today (including 8
    // 1x2s) and ~82,000 more with a known future opening date.
    //
    // The proof is in the data rather than the rulebook: of 544,178 records the
    // FCC has since flipped to Expired, 533,257 — 98.0% — carry a cancel_date
    // between 725 and 740 days after their expiration date, clustered on 731
    // and 732. The sweep is mechanical, and the clock it runs on starts at
    // expiry.
    if (expired == null) {
      return {
        availableDate: null,
        availableNow: false,
        endDate: null,
        rule: 'License is active with no expiration on file, so no opening date can be computed.',
        boundByVisibilityRule: false,
      };
    }

    const avail = twoYearsAndADay(expired);
    const lapsed = expired <= nowMs;
    return {
      availableDate: iso(avail),
      // A call only actually opens once the grace period has run *and* the
      // holder has let it lapse. Both are the same test: expiry + 2y + 1d.
      availableNow: avail <= nowMs,
      endDate: iso(expired),
      rule: lapsed
        ? `Expired ${iso(expired)} and not renewed. ULS still shows the record as Active — the FCC leaves it that way for the whole 2-year grace period — so the call opens ${iso(avail)}.`
        : `Licensed through ${iso(expired)}. If the holder does not renew, the 2-year grace period would carry the call to ${iso(avail)}. Most holders renew, so treat this as a projection.`,
      boundByVisibilityRule: false,
    };
  }

  if (status === 'C' || status === 'T') {
    if (cancel == null) {
      return {
        availableDate: null,
        availableNow: false,
        endDate: null,
        rule: 'Canceled but the ULS carries no cancel date, so the hold cannot be computed.',
        boundByVisibilityRule: false,
      };
    }
    const twoYearTerm = twoYearsAndADay(cancel);
    const visibilityTerm = lastAction != null ? lastAction + THIRTY_ONE_DAYS_MS : -Infinity;
    const avail = Math.max(twoYearTerm, visibilityTerm);
    const bound = visibilityTerm > twoYearTerm;
    return {
      availableDate: iso(avail),
      availableNow: avail <= nowMs,
      endDate: iso(cancel),
      rule: bound
        ? `Canceled ${iso(cancel)}. The 30-day visibility rule binds: 31 days past the last action date (${iso(lastAction!)}) falls later than the 2-year hold.`
        : `Canceled ${iso(cancel)}. Available 2 years and 1 day later.`,
      boundByVisibilityRule: bound,
    };
  }

  if (status === 'E') {
    // The FCC only marks a license "Expired" after the 2-year hold has already
    // run, stamping cancel_date with that moment. So an Expired record is
    // available as of its cancel date.
    const avail = cancel ?? expired;
    if (avail == null) {
      return {
        availableDate: null,
        availableNow: true,
        endDate: null,
        rule: 'Marked expired with no dates recorded; treated as available.',
        boundByVisibilityRule: false,
      };
    }
    return {
      availableDate: iso(avail),
      availableNow: avail <= nowMs,
      endDate: iso(expired ?? avail),
      rule: `Expired. The FCC marks a license expired only after the 2-year hold has run, so it became assignable on ${iso(avail)}.`,
      boundByVisibilityRule: false,
    };
  }

  return {
    availableDate: null,
    availableNow: false,
    endDate: endDate ? iso(endDate) : null,
    rule: `Unrecognized license status "${status}".`,
    boundByVisibilityRule: false,
  };
}

/**
 * Silent Key harvesting: when a licensee dies, the call is not assignable for
 * 2 years from the cancellation. Sending the FCC a death notice triggers the
 * cancellation earlier, which starts the clock earlier. This computes what the
 * available date would become if a cancellation were recorded today.
 */
export function silentKeyProjection(now: Date = new Date()): { availableDate: string; note: string } {
  const t = now.getTime();
  const twoYear = twoYearsAndADay(t);
  const visibility = t + THIRTY_ONE_DAYS_MS;
  return {
    availableDate: iso(Math.max(twoYear, visibility)),
    note: 'If a cancellation were recorded today, this is when the call would open. Filing the death notice earlier starts this clock earlier.',
  };
}
