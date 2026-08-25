/**
 * ULS field-value semantics that are not documented anywhere convenient and had
 * to be established empirically from the bulk data.
 */

/**
 * Application status code for "pending".
 *
 * Determined from the weekly dump: every vanity request received on the file's
 * final day carries status '2' with action_date == receipt_date, whereas
 * resolved requests carry G/D/W with an action_date ~18 days later. The letter
 * codes are the terminal states.
 */
export const PENDING_STATUS = '2';

/**
 * How old a still-pending application must be before we stop treating it as
 * part of a live lottery.
 *
 * The batch cycle is 18-20 days, so anything past ~45 days should already have
 * resolved. Applications that remain pending far beyond that have been taken
 * offline by the FCC for manual review (AE7Q labels this "Offlined by FCC") —
 * the bulk data holds examples still pending since 2018. Counting them as live
 * competitors overstates contention and marks calls contested that nobody is
 * actively pursuing.
 */
export const STALE_PENDING_DAYS = 60;

/**
 * Statuses that mean the Commission still has an open matter on a licence.
 *
 * Wider than PENDING_STATUS on purpose, and only used to decide whether a call
 * is frozen — never to decide who is in a lottery.
 *
 * 'R' is "returned to the applicant". There are 52 of them in the entire
 * amateur file, all from the last few years, and they are neither granted nor
 * dismissed: the application sits in limbo and the call sits with it. WR3C is
 * the worked example — a renewal filed one day after the call's hold expired,
 * returned rather than acted on, and unassignable ever since.
 *
 * A returned application is emphatically *not* a live competitor, though, so it
 * stays out of the batch solver. It cannot win the call; it just stops anyone
 * else winning it either.
 */
export const OPEN_APP_STATUSES = new Set([PENDING_STATUS, 'R']);

export const APP_STATUS_LABEL: Record<string, string> = {
  '2': 'Pending',
  G: 'Granted',
  D: 'Dismissed',
  W: 'Withdrawn',
  R: 'Returned',
};

/**
 * Application purpose codes. Only MD (modification) and AM (amendment) carry a
 * vanity preference list; the rest are routine licence maintenance filed under
 * the same radio service.
 */
export const APP_PURPOSE_LABEL: Record<string, string> = {
  MD: 'Modification (vanity request)',
  AM: 'Amendment',
  AU: 'Administrative update',
  RO: 'Renewal only',
  RM: 'Renewal / modification',
  NE: 'New',
  DU: 'Duplicate',
  WD: 'Withdrawal',
  CA: 'Cancellation',
};

/** Vanity request types, from ULS AM field 14. */
export const REQUEST_TYPE_LABEL: Record<string, string> = {
  E: 'Primary station preference list',
  A: 'Former primary station holder',
  B: 'Close relative of deceased former holder',
  F: 'Club station preference list',
  C: 'Former club station holder',
  D: 'Club station, in memoriam',
};

/** Request types that bypass the 2-year hold. */
export const HOLD_BYPASS_TYPES = new Set(['A', 'B', 'C', 'D']);

export const LICENSE_STATUS_LABEL: Record<string, string> = {
  A: 'Active',
  C: 'Canceled',
  E: 'Expired',
  T: 'Terminated',
};
