/**
 * US amateur callsign structure.
 *
 * A callsign is PREFIX + DIGIT + SUFFIX where the prefix is 1-2 letters and the
 * suffix is 1-3 letters. Format is named `<prefix letters>x<suffix letters>`,
 * e.g. K1AB is 2 letters total in prefix+... no: K1AB = prefix "K" (1), digit
 * "1", suffix "AB" (2) => "1x2".
 */

export type CallFormat = '1x1' | '1x2' | '2x1' | '1x3' | '2x2' | '2x3';

export const ALL_FORMATS: CallFormat[] = ['1x2', '2x1', '2x2', '1x3', '2x3'];

/** 1x1 calls are special-event only and never assignable as vanity. */
export const VANITY_FORMATS: CallFormat[] = ['1x2', '2x1', '2x2', '1x3', '2x3'];

export interface ParsedCall {
  call: string;
  prefix: string; // 1-2 letters
  digit: number; // 0-9
  suffix: string; // 1-3 letters
  format: CallFormat;
}

const CALL_RE = /^([A-Z]{1,2})(\d)([A-Z]{1,3})$/;

export function parseCall(input: string): ParsedCall | null {
  const call = input.trim().toUpperCase();
  const m = CALL_RE.exec(call);
  if (!m) return null;
  const [, prefix, d, suffix] = m;
  const format = `${prefix.length}x${suffix.length}` as CallFormat;
  // 1x1 is structurally matchable but is not a vanity format.
  if (!['1x1', '1x2', '2x1', '1x3', '2x2', '2x3'].includes(format)) return null;
  return { call, prefix, digit: Number(d), suffix, format };
}

export function isValidCallStructure(input: string): boolean {
  return parseCall(input) !== null;
}

/**
 * A frequent applicant error: typing the letter O where a zero belongs (or a
 * slashed-zero glyph). AE7Q dismisses these as "Invalid Format". We detect and
 * offer the correction rather than silently failing.
 */
export function suggestZeroFix(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/Ø|∅/g, '0');
  if (parseCall(raw)) return raw === input.trim().toUpperCase() ? null : raw;
  // Try replacing an O in the digit position.
  const m = /^([A-Z]{1,2})O([A-Z]{1,3})$/.exec(raw);
  if (m) {
    const fixed = `${m[1]}0${m[2]}`;
    if (parseCall(fixed)) return fixed;
  }
  return null;
}

export function formatOf(call: string): CallFormat | null {
  return parseCall(call)?.format ?? null;
}
