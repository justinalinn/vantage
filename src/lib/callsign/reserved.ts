/**
 * Reserved callsign blocks and suffixes that the vanity system will never
 * assign. Applying for one of these guarantees dismissal and forfeits the
 * $35 fee, so we surface them as a hard pre-flight block.
 *
 * Sources: FCC Amateur Call Sign Systems; 47 CFR 97.19; AE7Q "Reserved
 * Callsign" dismissal reason.
 */

import { parseCall } from './format';

export interface ReservedMatch {
  reason: string;
  detail: string;
}

/** Contiguous reserved ranges, compared lexically on the full callsign. */
const RESERVED_RANGES: Array<{ from: string; to: string; detail: string }> = [
  { from: 'KA2AA', to: 'KA9ZZ', detail: 'Reserved for US Army-authorized amateur stations in Japan.' },
  { from: 'KC4AAA', to: 'KC4AAF', detail: "Reserved for the National Science Foundation's Antarctic stations." },
  { from: 'KC4USA', to: 'KC4USZ', detail: 'Reserved for US Navy-authorized amateur stations in Antarctica.' },
  { from: 'KG4AA', to: 'KG4ZZ', detail: 'Reserved for US Navy-authorized amateur stations at Guantanamo Bay.' },
  { from: 'KC6AA', to: 'KC6ZZ', detail: 'Reserved block (former Caroline Islands allocation).' },
  { from: 'KL9KAA', to: 'KL9KHZ', detail: 'Reserved for US personnel stationed in Korea.' },
  { from: 'KX6AA', to: 'KX6ZZ', detail: 'Reserved block (former Marshall Islands allocation).' },
];

/** Suffixes that are never assigned in any prefix/district combination. */
function isReservedSuffix(suffix: string): string | null {
  if (suffix === 'SOS') return 'The suffix SOS is never assigned (distress signal).';
  if (suffix.length === 3 && suffix[0] === 'Q') {
    // QRA-QUZ are the international Q-signal range.
    if (suffix >= 'QRA' && suffix <= 'QUZ') {
      return 'Suffixes QRA through QUZ are never assigned (international Q-signals).';
    }
  }
  return null;
}

export function reservedReason(call: string): ReservedMatch | null {
  const p = parseCall(call);
  if (!p) return null;

  const suffixReason = isReservedSuffix(p.suffix);
  if (suffixReason) {
    return { reason: 'Reserved suffix', detail: suffixReason };
  }

  // AM-AZ prefixes belong to other administrations.
  if (p.prefix.length === 2 && p.prefix[0] === 'A' && p.prefix[1] >= 'M' && p.prefix[1] <= 'Z') {
    return {
      reason: 'Foreign allocation',
      detail: `The prefix ${p.prefix} is allocated to another country, not the US amateur service.`,
    };
  }

  for (const r of RESERVED_RANGES) {
    // Only compare within the same prefix+digit family to avoid spurious
    // lexical hits across differing callsign lengths.
    if (call.length === r.from.length && call >= r.from && call <= r.to) {
      return { reason: 'Reserved block', detail: r.detail };
    }
  }

  return null;
}

export function isReserved(call: string): boolean {
  return reservedReason(call) !== null;
}
