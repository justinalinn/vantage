/**
 * The complete space of structurally valid US amateur callsigns.
 *
 * This is what none of the incumbent tools do. RadioQTH says outright that
 * "there are valid call signs that will not show up here simply because they
 * have never been held by anyone since the FCC began keeping track" — meaning
 * the most desirable calls of all (never issued, zero competition, permanently
 * open) are invisible. Generating the universe combinatorially and subtracting
 * everything ULS has ever seen surfaces exactly that set.
 */

import type { CallFormat } from './format';
import { groupFor, isValidPrefix, type CallGroup } from './groups';
import { TERRITORY_PREFIXES } from './regions';
import { isReserved } from './reserved';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Formats materialized into the database. 2x3 is excluded: it is the sequential
 * issue pool (8.1M combinations, essentially none of them vanity targets), so we
 * evaluate those on demand instead of storing them.
 */
export const MATERIALIZED_FORMATS: CallFormat[] = ['1x2', '2x1', '2x2', '1x3'];

/** All valid one-letter prefixes. */
export const SINGLE_PREFIXES = ['K', 'N', 'W'];

/** All valid two-letter prefixes, mainland and territory. */
export function twoLetterPrefixes(): string[] {
  const out: string[] = [];
  for (const first of ['A', 'K', 'N', 'W']) {
    for (const second of LETTERS) {
      const p = first + second;
      if (isValidPrefix(p)) out.push(p);
    }
  }
  return out;
}

export function prefixesForFormat(format: CallFormat): string[] {
  switch (format) {
    case '1x2':
    case '1x3':
      return SINGLE_PREFIXES;
    case '2x1':
    case '2x2':
      return twoLetterPrefixes();
    case '2x3':
      // Group D is K and W only.
      return twoLetterPrefixes().filter((p) => p[0] === 'K' || p[0] === 'W');
    default:
      return [];
  }
}

function suffixLength(format: CallFormat): number {
  return Number(format.split('x')[1]);
}

function* suffixes(len: number): Generator<string> {
  if (len === 1) {
    for (const a of LETTERS) yield a;
  } else if (len === 2) {
    for (const a of LETTERS) for (const b of LETTERS) yield a + b;
  } else {
    for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) yield a + b + c;
  }
}

export interface UniverseEntry {
  call: string;
  prefix: string;
  digit: number;
  suffix: string;
  format: CallFormat;
  group: CallGroup;
  region: number;
  /** True when an in-region mailing address is legally required. */
  regionLocked: boolean;
}

/**
 * Territory prefixes carry their own digits. KL7 is Alaska; KL0 is not a thing.
 * Restricting to the digits actually in use avoids generating millions of
 * structurally-valid-but-never-allocated territory calls.
 */
const TERRITORY_DIGITS: Record<string, number[]> = {
  AH: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  KH: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  NH: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  WH: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  AL: [1, 2, 3, 4, 5, 6, 7, 9],
  KL: [1, 2, 3, 4, 5, 6, 7, 9],
  NL: [1, 2, 3, 4, 5, 6, 7, 9],
  WL: [1, 2, 3, 4, 5, 6, 7, 9],
  KP: [1, 2, 3, 4, 5],
  NP: [1, 2, 3, 4, 5],
  WP: [1, 2, 3, 4, 5],
};

function digitsFor(prefix: string): number[] {
  if (prefix.length === 2 && TERRITORY_PREFIXES.has(prefix)) {
    return TERRITORY_DIGITS[prefix] ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  }
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}

function regionOf(prefix: string, digit: number): number {
  if (prefix.length === 2 && TERRITORY_PREFIXES.has(prefix)) {
    if (['AL', 'KL', 'NL', 'WL'].includes(prefix)) return 11;
    if (['KP', 'NP', 'WP'].includes(prefix)) return 12;
    return 13;
  }
  return digit;
}

/** Stream every valid call in a format. Reserved calls are excluded. */
export function* generateFormat(format: CallFormat): Generator<UniverseEntry> {
  const sufLen = suffixLength(format);
  for (const prefix of prefixesForFormat(format)) {
    const group = groupFor(prefix, format);
    if (!group) continue;
    const locked = prefix.length === 2 && TERRITORY_PREFIXES.has(prefix);
    for (const digit of digitsFor(prefix)) {
      const region = regionOf(prefix, digit);
      for (const suffix of suffixes(sufLen)) {
        const call = `${prefix}${digit}${suffix}`;
        if (isReserved(call)) continue;
        yield { call, prefix, digit, suffix, format, group, region, regionLocked: locked };
      }
    }
  }
}

/** Stream the full materialized universe. */
export function* generateUniverse(
  formats: CallFormat[] = MATERIALIZED_FORMATS,
): Generator<UniverseEntry> {
  for (const f of formats) yield* generateFormat(f);
}

export function universeSize(formats: CallFormat[] = MATERIALIZED_FORMATS): number {
  let n = 0;
  for (const _ of generateUniverse(formats)) n++;
  return n;
}
