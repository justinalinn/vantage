/**
 * FCC call sign Groups A-D and operator-class eligibility (47 CFR 97.19).
 *
 * Group membership is a pure function of the callsign's shape. Eligibility is a
 * function of the holder's operator class. Keeping the two separate matters:
 * a call can be structurally Group A (so, Extra-only) while *also* being
 * region-locked, and the user needs both facts stated independently.
 */

import type { CallFormat } from './format';
import { parseCall } from './format';
import { TERRITORY_PREFIXES } from './regions';

export type CallGroup = 'A' | 'B' | 'C' | 'D';

/** ULS operator_class codes. */
export type OperatorClass =
  | 'E' // Amateur Extra
  | 'A' // Advanced
  | 'G' // General
  | 'T' // Technician
  | 'P' // Technician Plus
  | 'N'; // Novice

export const OPERATOR_CLASS_LABEL: Record<OperatorClass, string> = {
  E: 'Amateur Extra',
  A: 'Advanced',
  G: 'General',
  T: 'Technician',
  P: 'Technician Plus',
  N: 'Novice',
};

/** Which groups each operator class may hold. Higher classes are supersets. */
export const CLASS_ELIGIBLE_GROUPS: Record<OperatorClass, CallGroup[]> = {
  E: ['A', 'B', 'C', 'D'],
  A: ['B', 'C', 'D'],
  G: ['C', 'D'],
  P: ['C', 'D'],
  T: ['C', 'D'],
  N: ['D'],
};

/**
 * Second letters that make a two-letter prefix a *territory* prefix rather than
 * a mainland one. K/N/W pair with H, L, P; A pairs with H and L.
 */
const TERRITORY_SECOND_LETTERS = new Set(['H', 'L', 'P']);

/** Territory prefixes whose 2x2 format sits at Advanced rather than General. */
const TERRITORY_2X2_ADVANCED = new Set(['AH', 'AL', 'KP']);

/**
 * `A` prefixes allocated to the US amateur service. AM-AZ belong to other
 * countries, so 2x1/2x2 calls beginning AM.. through AZ.. are never assignable.
 */
export function isUsableAPrefix(second: string): boolean {
  // AA-AK are US. AH (Pacific) and AL (Alaska) are territory prefixes handled
  // separately; AL is beyond AK so the range check already excludes it.
  return second >= 'A' && second <= 'K';
}

/** True when a 2-letter prefix is a valid US amateur prefix at all. */
export function isValidPrefix(prefix: string): boolean {
  if (prefix.length === 1) return ['K', 'N', 'W'].includes(prefix);
  const [first, second] = prefix;
  if (!['A', 'K', 'N', 'W'].includes(first)) return false;
  if (TERRITORY_PREFIXES.has(prefix)) return true;
  if (first === 'A') return isUsableAPrefix(second);
  // K/N/W + any letter except the territory second-letters.
  return !TERRITORY_SECOND_LETTERS.has(second);
}

/**
 * Derive the FCC call sign group from the callsign's structure.
 * Returns null when the call is not a valid US amateur assignable format.
 */
export function groupForCall(call: string): CallGroup | null {
  const p = parseCall(call);
  if (!p) return null;
  return groupFor(p.prefix, p.format);
}

export function groupFor(prefix: string, format: CallFormat): CallGroup | null {
  if (!isValidPrefix(prefix)) return null;
  const first = prefix[0];
  const isTerritory = prefix.length === 2 && TERRITORY_PREFIXES.has(prefix);

  switch (format) {
    case '1x2':
      // K#XX / N#XX / W#XX — Extra only.
      return prefix.length === 1 ? 'A' : null;

    case '2x1':
      // Every valid 2x1, mainland or territory, is Group A.
      return prefix.length === 2 ? 'A' : null;

    case '2x2':
      if (prefix.length !== 2) return null;
      // Territories have no 1x2 or 1x3 format, so their ladder sits one rung
      // lower than the mainland's: 2x2 is Advanced for AH/AL/KP and General for
      // the rest. KP is the lone K/N/W prefix that sits at Advanced — verified
      // against ULS group_code across all 1.69M licenses (KP 2x2 is B in 99.9%
      // of 1,062 records, while NP/WP/KH/KL/NH/NL/WH/WL 2x2 are C).
      if (isTerritory) return TERRITORY_2X2_ADVANCED.has(prefix) ? 'B' : 'C';
      // Mainland: 2x2 beginning with A is Extra-only; K/N/W 2x2 is Advanced.
      return first === 'A' ? 'A' : 'B';

    case '1x3':
      // K#XXX / N#XXX / W#XXX — General and up. Mainland only: there is no
      // single-letter territory prefix.
      return prefix.length === 1 ? 'C' : null;

    case '2x3':
      if (prefix.length !== 2) return null;
      // Group D is K and W only. N 2x3 and A 2x3 are not issued.
      if (first !== 'K' && first !== 'W') return null;
      return 'D';

    default:
      return null;
  }
}

export function classCanHold(cls: OperatorClass, group: CallGroup): boolean {
  return CLASS_ELIGIBLE_GROUPS[cls].includes(group);
}

/** The lowest operator class that may hold a given group. */
export const MIN_CLASS_FOR_GROUP: Record<CallGroup, OperatorClass> = {
  A: 'E',
  B: 'A',
  C: 'G',
  D: 'N',
};

export function minClassLabel(group: CallGroup): string {
  return OPERATOR_CLASS_LABEL[MIN_CLASS_FOR_GROUP[group]];
}
