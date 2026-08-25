/**
 * The FCC vanity application timeline.
 *
 *   file  -> receipt date  = first Federal workday on/after filing (23:59 ET cutoff)
 *         -> +10 calendar days: FCC waits for payments to arrive
 *         -> +7 more calendar days: FCC waits for payments to clear
 *         -> batch date    = first Federal workday more than 17 days past receipt
 *         -> process date  = the next day; 00:00-02:00 ET the whole batch is
 *                            processed in uniformly random order
 *
 * Total delay is 18-20 days depending on the weekday. Documented by AE7Q and
 * reproduced here with full holiday awareness.
 */

import { addDays, isWorkday, nextWorkdayAfter, nextWorkdayOnOrAfter, ymd } from './holidays';

/** Days the FCC waits for payments to arrive before starting the clearing wait. */
export const PAYMENT_WINDOW_DAYS = 10;
/** Additional days the FCC waits for payments to clear. */
export const CLEARING_DAYS = 7;
/** Total calendar days past receipt before a batch may run. */
export const BATCH_DELAY_DAYS = PAYMENT_WINDOW_DAYS + CLEARING_DAYS; // 17

export const FILING_FEE_USD = 35;

export interface Timeline {
  filed: string;
  receipt: string;
  /** Payment must reach the FCC by this date or the application is dismissed. */
  paymentDeadline: string;
  batch: string;
  process: string;
  /** Calendar days from filing to process. */
  totalDays: number;
  /** True when the filing date itself was not a Federal workday. */
  filedOnNonWorkday: boolean;
}

/**
 * Receipt date: the first Federal workday on or after the filing date.
 * Online filings before 23:59 ET count for that day.
 */
export function receiptDateFor(filed: Date): Date {
  return nextWorkdayOnOrAfter(filed);
}

/**
 * Batch date: the first Federal workday *more than* 17 days past the receipt
 * date. If receipt + 18 is itself a workday, that is the batch date.
 */
export function batchDateFor(receipt: Date): Date {
  return nextWorkdayOnOrAfter(addDays(receipt, BATCH_DELAY_DAYS + 1));
}

/**
 * Process date: the calendar day after the batch date. Processing happens
 * 00:00-02:00 ET that morning. This is a real calendar day, not a workday —
 * a Friday batch processes Saturday.
 */
export function processDateFor(batch: Date): Date {
  return addDays(batch, 1);
}

export function timelineFor(filed: Date): Timeline {
  const receipt = receiptDateFor(filed);
  const batch = batchDateFor(receipt);
  const process = processDateFor(batch);
  return {
    filed: ymd(filed),
    receipt: ymd(receipt),
    paymentDeadline: ymd(addDays(receipt, PAYMENT_WINDOW_DAYS)),
    batch: ymd(batch),
    process: ymd(process),
    totalDays: Math.round((process.getTime() - filed.getTime()) / 86400000),
    filedOnNonWorkday: !isWorkday(filed),
  };
}

/** Given a receipt date, when does that batch resolve? */
export function timelineForReceipt(receipt: Date): Timeline {
  const batch = batchDateFor(receipt);
  const process = processDateFor(batch);
  return {
    filed: ymd(receipt),
    receipt: ymd(receipt),
    paymentDeadline: ymd(addDays(receipt, PAYMENT_WINDOW_DAYS)),
    batch: ymd(batch),
    process: ymd(process),
    totalDays: Math.round((process.getTime() - receipt.getTime()) / 86400000),
    filedOnNonWorkday: false,
  };
}

export interface TimelineStage {
  key: 'filed' | 'receipt' | 'payment' | 'batch' | 'process';
  label: string;
  date: string;
  description: string;
  /** Position 0-1 along the timeline, for rendering. */
  t: number;
}

export function stagesFor(tl: Timeline): TimelineStage[] {
  const t0 = Date.parse(tl.filed);
  const t1 = Date.parse(tl.process);
  const span = Math.max(1, t1 - t0);
  const at = (d: string) => (Date.parse(d) - t0) / span;
  return [
    {
      key: 'filed',
      label: 'Filed',
      date: tl.filed,
      description: tl.filedOnNonWorkday
        ? 'Filed on a non-workday, so the FCC clock does not start until the next Federal workday.'
        : 'Application submitted through the ULS.',
      t: at(tl.filed),
    },
    {
      key: 'receipt',
      label: 'Receipt date',
      date: tl.receipt,
      description:
        'The official receipt date. Every eligibility test — your operator class, the 2-year hold — is evaluated against this date, not the filing date.',
      t: at(tl.receipt),
    },
    {
      key: 'payment',
      label: 'Payment due',
      date: tl.paymentDeadline,
      description:
        `The $${FILING_FEE_USD} fee must reach the FCC within 10 days of receipt. Paying late means dismissal; paying on day 2-3 lets you scout competition first.`,
      t: at(tl.paymentDeadline),
    },
    {
      key: 'batch',
      label: 'Batch',
      date: tl.batch,
      description:
        'The FCC batches every application sharing your receipt date for overnight processing.',
      t: at(tl.batch),
    },
    {
      key: 'process',
      label: 'Lottery',
      date: tl.process,
      description:
        'Between 00:00 and 02:00 ET the batch is processed in uniformly random order. Grants appear in the ULS within minutes.',
      t: at(tl.process),
    },
  ];
}

/**
 * Filing-date arbitrage: the batch you land in is determined by your receipt
 * date, and receipt dates are workdays. Filing Friday, Saturday and Sunday all
 * land you in Monday's batch — so a weekend filer shares a batch with three
 * days' worth of competitors while gaining nothing.
 */
export function receiptCollisionDays(filed: Date): number {
  const receipt = receiptDateFor(filed);
  let n = 0;
  for (let i = -4; i <= 0; i++) {
    const d = addDays(receipt, i);
    if (ymd(receiptDateFor(d)) === ymd(receipt)) n++;
  }
  return n;
}

/** Candidate filing dates over the next `days`, annotated for strategy. */
export function filingOptions(from: Date, days = 14) {
  const out: Array<{ date: string; receipt: string; process: string; collisionDays: number; isWorkday: boolean }> = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const tl = timelineFor(d);
    out.push({
      date: ymd(d),
      receipt: tl.receipt,
      process: tl.process,
      collisionDays: receiptCollisionDays(d),
      isWorkday: isWorkday(d),
    });
  }
  return out;
}

/**
 * The one day to file for a call that opens on `open`.
 *
 * Eligibility is tested against the receipt date, and the receipt date is the
 * first Federal workday on or after the filing date. So the earliest receipt
 * anyone can obtain for this call is `nextWorkdayOnOrAfter(open)` — and every
 * applicant who reaches it goes into the same uniformly random draw.
 *
 * That makes the opening date a deadline rather than a starting gun. File
 * before it and the request is dismissed for being too early, with no refund of
 * the $35. File after it and, if anyone at all filed on day zero, the call is
 * gone before your batch is ever considered — the FCC processes batches in
 * receipt-date order and a later batch only ever sees what the earlier one left
 * behind.
 *
 * Filing *on* the opening date is therefore both the earliest and the only
 * competitive choice, including when it falls on a weekend: a Saturday filing
 * and the Monday filing that follows it share a receipt date and share a draw.
 */
export function filingDateFor(open: Date): { file: string; receipt: string; process: string } {
  const receipt = nextWorkdayOnOrAfter(open);
  return {
    file: ymd(open),
    receipt: ymd(receipt),
    process: ymd(processDateFor(batchDateFor(receipt))),
  };
}

export { nextWorkdayAfter, nextWorkdayOnOrAfter };
