/**
 * Query parser for the command bar.
 *
 * Accepts a mix of structured tokens and loose natural phrasing so a user can
 * type "2x1 region 6 ending in vowel" or "K?A* never issued P>60" and get what
 * they meant. Anything unrecognised falls through to a callsign pattern match,
 * which is what people type most often.
 */

import type { CallFormat } from '../callsign/format';
import type { CallGroup, OperatorClass } from '../callsign/groups';
import type { StatusKey } from '../ui/status';

export interface ParsedQuery {
  formats: CallFormat[];
  regions: number[];
  prefixes: string[];
  /** Glob over the whole callsign: * = any run, ? = single char. */
  pattern: string | null;
  /** Suffix constraints. */
  suffixEndsWith: string | null;
  suffixStartsWith: string | null;
  suffixClass: 'vowel' | 'consonant' | null;
  statuses: StatusKey[];
  groups: CallGroup[];
  operatorClass: OperatorClass | null;
  minProbability: number | null;
  maxMorse: number | null;
  minDesirability: number | null;
  /** Only calls available within N days (0 = available now). */
  availableWithinDays: number | null;
  /** Suffix must be a repeated letter (AAA) or sequential (ABC). */
  repeatingOnly: boolean;
  /** Free text left over, echoed back so the UI can show what was ignored. */
  unparsed: string[];
}

export const EMPTY_QUERY: ParsedQuery = {
  formats: [],
  regions: [],
  prefixes: [],
  pattern: null,
  suffixEndsWith: null,
  suffixStartsWith: null,
  suffixClass: null,
  statuses: [],
  groups: [],
  operatorClass: null,
  minProbability: null,
  maxMorse: null,
  minDesirability: null,
  availableWithinDays: null,
  repeatingOnly: false,
  unparsed: [],
};

const FORMAT_RE = /^([12])x([123])$/;

const STATUS_WORDS: Record<string, StatusKey> = {
  never: 'NEVER_ISSUED',
  'never-issued': 'NEVER_ISSUED',
  neverissued: 'NEVER_ISSUED',
  unissued: 'NEVER_ISSUED',
  virgin: 'NEVER_ISSUED',
  available: 'AVAILABLE',
  open: 'AVAILABLE',
  free: 'AVAILABLE',
  contested: 'AVAILABLE_CONTESTED',
  competed: 'AVAILABLE_CONTESTED',
  pending: 'PENDING',
  lottery: 'PENDING',
  upcoming: 'UPCOMING',
  soon: 'UPCOMING',
  expired: 'EXPIRED_WAITING',
  canceled: 'CANCELED_WAITING',
  cancelled: 'CANCELED_WAITING',
  active: 'ACTIVE',
  licensed: 'ACTIVE',
  taken: 'ACTIVE',
  anomaly: 'ANOMALY',
  blocked: 'BLOCKED_PENDING',
  frozen: 'BLOCKED_PENDING',
  renewal: 'BLOCKED_PENDING',
  banned: 'BANNED',
  withheld: 'BANNED',
  reserved: 'RESERVED',
};

const CLASS_WORDS: Record<string, OperatorClass> = {
  extra: 'E',
  e: 'E',
  advanced: 'A',
  general: 'G',
  g: 'G',
  technician: 'T',
  tech: 'T',
  novice: 'N',
};

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = { ...EMPTY_QUERY, formats: [], regions: [], prefixes: [], statuses: [], groups: [], unparsed: [] };
  if (!input?.trim()) return q;

  // Normalise multi-word phrases into single tokens before splitting.
  let s = ` ${input.toLowerCase().trim()} `
    .replace(/\bnever\s+issued\b/g, ' never ')
    .replace(/\bin\s+lottery\b/g, ' pending ')
    .replace(/\bending\s+in\s+a\s+vowel\b/g, ' endvowel ')
    .replace(/\bending\s+in\s+vowel\b/g, ' endvowel ')
    .replace(/\bends?\s+with\s+/g, ' endswith:')
    .replace(/\bending\s+in\s+/g, ' endswith:')
    .replace(/\bstarts?\s+with\s+/g, ' startswith:')
    .replace(/\bavailable\s+now\b/g, ' avail:0 ')
    .replace(/\bdistrict\s+/g, ' region ')
    .replace(/\bregion\s+/g, ' region:')
    .replace(/\bprefix\s+/g, ' prefix:')
    .replace(/\bwithin\s+(\d+)\s+days?\b/g, ' avail:$1 ')
    .replace(/\brepeat(?:ing|ers?)?\b/g, ' repeating ');

  const tokens = s.split(/\s+/).filter(Boolean);

  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;

    // format: 2x1
    const fm = FORMAT_RE.exec(t);
    if (fm) {
      q.formats.push(t as CallFormat);
      continue;
    }

    // region:6  (also accepts region:1,2,3)
    if (t.startsWith('region:')) {
      for (const part of t.slice(7).split(',')) {
        const n = Number(part);
        if (Number.isFinite(n)) q.regions.push(n);
      }
      continue;
    }

    if (t.startsWith('prefix:')) {
      const p = t.slice(7).toUpperCase().replace(/[^A-Z]/g, '');
      if (p) q.prefixes.push(p);
      continue;
    }

    if (t.startsWith('endswith:')) {
      const v = t.slice(9).toUpperCase().replace(/[^A-Z]/g, '');
      if (v === 'VOWEL') q.suffixClass = 'vowel';
      else if (v === 'CONSONANT') q.suffixClass = 'consonant';
      else if (v) q.suffixEndsWith = v;
      continue;
    }

    if (t.startsWith('startswith:')) {
      const v = t.slice(11).toUpperCase().replace(/[^A-Z]/g, '');
      if (v) q.suffixStartsWith = v;
      continue;
    }

    if (t === 'endvowel') {
      q.suffixClass = 'vowel';
      continue;
    }

    if (t === 'repeating') {
      q.repeatingOnly = true;
      continue;
    }

    if (t.startsWith('avail:')) {
      const n = Number(t.slice(6));
      if (Number.isFinite(n)) q.availableWithinDays = n;
      continue;
    }

    // p>60 / p>60% / p>=0.6
    const pm = /^p\s*>=?\s*([\d.]+)%?$/.exec(t);
    if (pm) {
      const v = Number(pm[1]);
      q.minProbability = v > 1 ? v / 100 : v;
      continue;
    }

    const cwm = /^(?:cw|morse)\s*<=?\s*(\d+)$/.exec(t);
    if (cwm) {
      q.maxMorse = Number(cwm[1]);
      continue;
    }

    const dm = /^(?:des|score)\s*>=?\s*(\d+)$/.exec(t);
    if (dm) {
      q.minDesirability = Number(dm[1]);
      continue;
    }

    // group:A
    const gm = /^group:([abcd])$/.exec(t);
    if (gm) {
      q.groups.push(gm[1].toUpperCase() as CallGroup);
      continue;
    }

    if (STATUS_WORDS[t]) {
      q.statuses.push(STATUS_WORDS[t]);
      continue;
    }

    if (CLASS_WORDS[t] && t.length > 1) {
      q.operatorClass = CLASS_WORDS[t];
      continue;
    }

    // Bare region digit, e.g. "6" on its own.
    if (/^\d$/.test(t)) {
      q.regions.push(Number(t));
      continue;
    }

    // Callsign or glob pattern.
    if (/^[a-z0-9?*]{1,7}$/.test(t) && /[a-z0-9]/.test(t)) {
      q.pattern = t.toUpperCase();
      continue;
    }

    q.unparsed.push(t);
  }

  return q;
}

/** Convert a user glob into a SQL LIKE pattern. */
export function globToLike(glob: string): string {
  return glob.replace(/\*/g, '%').replace(/\?/g, '_');
}

/** Human-readable echo of what the parser understood. */
export function describeQuery(q: ParsedQuery): string[] {
  const out: string[] = [];
  if (q.formats.length) out.push(`format ${q.formats.join(', ')}`);
  if (q.regions.length) out.push(`region ${q.regions.join(', ')}`);
  if (q.prefixes.length) out.push(`prefix ${q.prefixes.join(', ')}`);
  if (q.pattern) out.push(`matching ${q.pattern}`);
  if (q.suffixEndsWith) out.push(`suffix ends "${q.suffixEndsWith}"`);
  if (q.suffixStartsWith) out.push(`suffix starts "${q.suffixStartsWith}"`);
  if (q.suffixClass) out.push(`suffix ends in a ${q.suffixClass}`);
  if (q.repeatingOnly) out.push('repeating or sequential suffix');
  if (q.statuses.length) out.push(`status ${q.statuses.join(', ')}`);
  if (q.groups.length) out.push(`group ${q.groups.join(', ')}`);
  if (q.operatorClass) out.push(`holdable by class ${q.operatorClass}`);
  if (q.minProbability != null) out.push(`still open with ≥ ${(q.minProbability * 100).toFixed(0)}% chance`);
  if (q.maxMorse != null) out.push(`CW ≤ ${q.maxMorse}`);
  if (q.minDesirability != null) out.push(`score ≥ ${q.minDesirability}`);
  if (q.availableWithinDays != null) {
    out.push(q.availableWithinDays === 0 ? 'available now' : `available within ${q.availableWithinDays} days`);
  }
  return out;
}
