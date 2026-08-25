/**
 * Plain-language "why is this call in this state" traces.
 *
 * Every incumbent shows a colour and leaves the user to infer the rule. Since
 * each status here is produced by a specific, citable regulation, we emit the
 * actual chain of reasoning alongside the conclusion.
 */

import type { CallDetail } from './query/search';
import { statusDef } from './ui/status';
import { MIN_CLASS_FOR_GROUP, OPERATOR_CLASS_LABEL } from './callsign/groups';
import { REGION_BY_ID } from './callsign/regions';
import { reservedReason } from './callsign/reserved';
import { bannedReason } from './fcc/blocks';
import { filingDateFor } from './fcc/timeline';

export interface RuleTrace {
  tag: string;
  text: string;
}

export interface Explanation {
  summary: string;
  rules: RuleTrace[];
}

export type VerdictAction = 'FILE_NOW' | 'FILE_ON' | 'WATCH' | 'LONG_WAIT' | 'DONT' | 'NOT_YOURS';

export interface Verdict {
  action: VerdictAction;
  /** One line, imperative, no jargon. This is the answer to the question. */
  headline: string;
  /** Why, in a sentence or two. */
  detail: string;
  /** The day to file, when there is one. */
  fileOn?: string;
  daysUntil?: number;
  tone: 'go' | 'plan' | 'wait' | 'stop';
}

/**
 * The single sentence a visitor actually came for.
 *
 * The rule trace below is good at explaining *why* a call is in a state, and
 * bad at telling somebody what to do about it — which is the only thing most
 * people want. Vanity filing is unforgiving in a specific way: the fee is not
 * refunded, a day early is dismissed outright, and a day late usually means the
 * call is gone before your batch is even looked at. So the verdict is phrased
 * as an instruction with a date, not as a status.
 */
export function verdictFor(d: CallDetail): Verdict {
  const today = new Date().toISOString().slice(0, 10);
  const daysUntil = d.available_date
    ? Math.round((Date.parse(d.available_date) - Date.parse(today)) / 86400000)
    : null;

  if (bannedReason(d.call)) {
    return {
      action: 'DONT',
      tone: 'stop',
      headline: 'Do not file for this call.',
      detail:
        'The FCC keeps a hidden ULS record reserving it and dismisses every application. A 2024 FOIA request confirmed it is withheld deliberately. The $35 is not refunded.',
    };
  }

  if (d.status === 'BLOCKED_PENDING') {
    return {
      action: 'DONT',
      tone: 'stop',
      headline: 'Do not file — this call is frozen.',
      detail:
        'Its hold has run out, but the Commission still has an open application on this licence and has not acted on it. Nobody can be granted this call until it does, and there is no deadline by which it must. Some calls have been stuck this way since 2011.',
    };
  }

  if (d.status === 'ANOMALY') {
    return {
      action: 'DONT',
      tone: 'stop',
      headline: 'Filing here is probably wasted money.',
      detail:
        'It has been open on paper for over a year and every application for it has been dismissed, with none granted. That pattern is the signature of an undocumented FCC hold.',
    };
  }

  if (d.status === 'REGION_LOCKED') {
    return {
      action: 'NOT_YOURS',
      tone: 'stop',
      headline: 'Only available with an address in this call region.',
      detail: 'The prefix is reserved to a specific territory, and the FCC checks the mailing address on the application.',
    };
  }

  if (d.status === 'RESERVED') {
    return {
      action: 'DONT',
      tone: 'stop',
      headline: 'This call is never assignable.',
      detail: reservedReason(d.call)?.detail ?? 'It sits in a block the FCC withholds from the vanity system.',
    };
  }

  if (d.status === 'ACTIVE') {
    return {
      action: 'LONG_WAIT',
      tone: 'wait',
      headline: 'Licensed to someone else.',
      detail: d.licence?.expired_date
        ? `The current licence runs to ${d.licence.expired_date}. If it is never renewed the call would open ${d.available_date ?? 'two years and a day later'} — but most holders renew, so treat that as a projection rather than a plan.`
        : 'It is in use and there is no expiry on file to compute an opening date from.',
      fileOn: d.available_date ?? undefined,
      daysUntil: daysUntil ?? undefined,
    };
  }

  if (d.status === 'NEVER_ISSUED') {
    return {
      action: 'FILE_NOW',
      tone: 'go',
      headline: 'File whenever you like — nobody else is in the way.',
      detail:
        'This call has never been assigned to anyone in the entire ULS history. There is no hold to clear and no incumbent. The only competition would be someone else filing on the same day.',
      fileOn: today,
    };
  }

  if (d.status === 'AVAILABLE') {
    return {
      action: 'FILE_NOW',
      tone: 'go',
      headline: 'Open now, and nobody has applied.',
      detail:
        'The hold has run out and no applications are on file. Filing today puts you in a lottery only with people who happen to file the same day — usually nobody.',
      fileOn: today,
    };
  }

  if (d.status === 'AVAILABLE_CONTESTED' || d.status === 'PENDING') {
    // `||` would be a bug here, not a shorthand: zero eligible applicants is
    // the interesting case, not a missing value. K3UF is the worked example —
    // two applications on file, both filed before the call opened, both
    // certain to be dismissed. Falling back to the raw count there tells the
    // user they are third in line for a call nobody can currently win.
    const eligible = d.eligible_pending ?? d.pending_count;
    const dead = d.pending_count - eligible;
    return {
      action: 'FILE_NOW',
      tone: eligible > 3 ? 'plan' : 'go',
      headline:
        eligible === 0
          ? `Open now — ${dead === 1 ? 'the application' : `all ${dead} applications`} on file will be dismissed.`
          : `Open now, with ${eligible} applicant${eligible === 1 ? '' : 's'} ahead of you.`,
      detail:
        eligible === 0
          ? 'Applications exist, but none of them can be granted this call — filed before it opened, wrong licence class, or wrong region. As far as the lottery is concerned the call is uncontested, and the other tools counting those filings are overstating the competition.'
          : `Anyone filing before the current batch resolves shares the draw${dead > 0 ? `; ${dead} further application${dead === 1 ? '' : 's'} on file cannot win and ${dead === 1 ? 'is' : 'are'} excluded from that count` : ''}. Rank it first on your list: your odds depend on being pulled ahead of everyone who also ranks it above their other choices.`,
      fileOn: today,
    };
  }

  // Everything left is waiting out a hold with a known date.
  if (d.available_date && daysUntil != null) {
    const filing = filingDateFor(new Date(`${d.available_date}T00:00:00Z`));
    return {
      action: daysUntil <= 120 ? 'FILE_ON' : 'WATCH',
      tone: daysUntil <= 120 ? 'plan' : 'wait',
      headline: `File on ${d.available_date} — not before, not after.`,
      detail:
        `The hold runs out that day. Filing earlier is dismissed as premature and the $35 is not refunded; filing later means anyone who filed on the day itself is processed in an earlier batch and takes the call first. ` +
        `An application filed that day carries a receipt date of ${filing.receipt} and is drawn on ${filing.process}.`,
      fileOn: d.available_date,
      daysUntil,
    };
  }

  return {
    action: 'WATCH',
    tone: 'wait',
    headline: 'Not assignable yet, and no opening date can be computed.',
    detail: d.licence?.avail_rule ?? 'The ULS record does not carry the dates needed to work out when the hold ends.',
  };
}

export function explainCall(d: CallDetail): Explanation {
  const st = statusDef(d.status);
  const rules: RuleTrace[] = [];
  let summary = st.blurb;

  const minClass = MIN_CLASS_FOR_GROUP[d.grp as 'A' | 'B' | 'C' | 'D'];
  rules.push({
    tag: '§97.19',
    text: `Format ${d.format} places this in call sign Group ${d.grp}, which requires ${OPERATOR_CLASS_LABEL[minClass]} or higher.`,
  });

  const res = reservedReason(d.call);
  if (res) rules.push({ tag: 'RESERVED', text: res.detail });

  if (d.region_locked) {
    const r = REGION_BY_ID.get(d.region);
    rules.push({
      tag: '§97.19(c)',
      text: `The ${d.call.slice(0, 2)} prefix is exclusive to ${r?.label ?? `region ${d.region}`}; a mailing address there is required.`,
    });
  }

  switch (d.status) {
    case 'NEVER_ISSUED':
      rules.push({ tag: 'ULS', text: 'A full scan of the assignment history returns no grant record for this call, ever.' });
      rules.push({ tag: 'RESULT', text: 'No incumbent and no hold. It can be requested immediately.' });
      break;

    case 'AVAILABLE':
      if (d.licence?.avail_rule) rules.push({ tag: 'HOLD', text: d.licence.avail_rule });
      rules.push({ tag: 'RESULT', text: 'No pending applications are on file, so a request today faces no lottery unless someone files the same day.' });
      break;

    case 'AVAILABLE_CONTESTED':
    case 'PENDING':
      if (d.licence?.avail_rule) rules.push({ tag: 'HOLD', text: d.licence.avail_rule });
      {
        const live = d.eligible_pending ?? d.pending_count;
        const dismissed = d.pending_count - live;
        rules.push({
          tag: '§1.933',
          text:
            `${d.pending_count} pending application${d.pending_count === 1 ? '' : 's'} request this call` +
            (dismissed > 0
              ? `, but ${dismissed} of them cannot be granted it and will be dismissed. ${live} remain${live === 1 ? 's' : ''} live. `
              : '. ') +
            'Applications sharing a receipt date are processed in uniformly random order.',
        });
        summary =
          live === 0
            ? `Every application on file for this call will be dismissed, so nothing is actually competing for it.`
            : `${live} applicant${live === 1 ? '' : 's'} are genuinely queued for this call. Your odds depend on being drawn ahead of everyone who ranks it above their other choices.`;
      }
      break;

    case 'EXPIRED_WAITING':
    case 'CANCELED_WAITING':
    case 'UPCOMING':
      if (d.licence?.avail_rule) rules.push({ tag: 'HOLD', text: d.licence.avail_rule });
      if (d.licence?.visibility_bound) {
        rules.push({
          tag: '§97.19(c)(3)',
          text: 'The 30-day visibility rule binds here rather than the 2-year term: the call opens 31 days after the last ULS action, which falls later.',
        });
      }
      if (d.available_date) {
        rules.push({ tag: 'RESULT', text: `Becomes assignable on ${d.available_date}. Filing before then is dismissed as "too early".` });
      }
      break;

    case 'BLOCKED_PENDING':
      if (d.licence?.avail_rule) rules.push({ tag: 'HOLD', text: d.licence.avail_rule });
      rules.push({
        tag: '§97.21',
        text: 'An application is pending on this licence — usually a renewal, sometimes an amendment to one. While the Commission has it in hand the call cannot be reassigned, and there is no deadline by which it must act.',
      });
      summary =
        'This call looks open and is not. The open filing freezes it indefinitely — applications against it are dismissed and the fee is not refunded.';
      break;

    case 'BANNED':
      rules.push({
        tag: 'FOIA',
        text: 'The FCC maintains a hidden ULS record reserving this call. A 2024 FOIA request returned redacted documents indicating it is withheld for similarity to obscenity.',
      });
      summary = 'The FCC will not assign this call. Every application for it has been dismissed.';
      break;

    case 'ACTIVE':
      rules.push({
        tag: 'STATUS',
        text: `Licensed${d.licence?.entity_name ? ` to ${d.licence.entity_name}` : ''}${d.licence?.expired_date ? `, expiring ${d.licence.expired_date}` : ''}.`,
      });
      rules.push({ tag: 'RESULT', text: 'Not assignable. It would need to lapse and then clear the 2-year hold.' });
      break;

    case 'ANOMALY':
      rules.push({
        tag: 'EMPIRICAL',
        text: `Open on paper since ${d.available_date ?? 'over a year ago'}, yet every application filed for it has been dismissed and none granted.`,
      });
      rules.push({
        tag: 'RESULT',
        text: 'That pattern is the fingerprint of an undocumented FCC hold. Applying is likely to forfeit the fee.',
      });
      break;
  }

  return { summary, rules };
}
