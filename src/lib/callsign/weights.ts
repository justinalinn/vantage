/**
 * Morse and phonetic weights — how long a callsign takes to send or say.
 *
 * The Morse algorithm reproduces AE7Q's exactly so numbers are comparable
 * across sites: each dot counts 2 (element + trailing space), each dash counts
 * 4, and 2 more is added per character for the inter-character gap. Verified
 * against AE7Q's published values (K1AK = 52, K1AU = 50).
 *
 * Phonetic weight is the ITU syllable count. Verified against AE7Q
 * (K1AK = 7, K1SS = 9, N1GI = 8).
 */

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

/** ITU/NATO phonetic syllable counts. */
const SYLLABLES: Record<string, number> = {
  A: 2, B: 2, C: 2, D: 2, E: 2, F: 2, G: 1, H: 2, I: 3, J: 3, K: 2, L: 2,
  M: 1, N: 3, O: 2, P: 2, Q: 2, R: 3, S: 3, T: 2, U: 3, V: 2, W: 2, X: 2,
  Y: 2, Z: 2,
  '0': 2, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 2, '8': 1, '9': 1,
};

/** Weight of a single character: dots=2, dashes=4, plus 2 for the gap. */
export function morseWeightOfChar(ch: string): number {
  const code = MORSE[ch];
  if (!code) return 0;
  // Replacing '-' with '==' makes each dash count double a dot, then *2 turns
  // dot=1 into dot=2. +2 is the inter-character space.
  return code.replace(/-/g, '==').length * 2 + 2;
}

export function morseWeight(call: string): number {
  let total = 0;
  for (const ch of call.toUpperCase()) total += morseWeightOfChar(ch);
  return total;
}

export function phoneticWeight(call: string): number {
  let total = 0;
  for (const ch of call.toUpperCase()) total += SYLLABLES[ch] ?? 0;
  return total;
}

export function morseOf(call: string): string {
  return call
    .toUpperCase()
    .split('')
    .map((c) => MORSE[c] ?? '')
    .join(' ');
}

/**
 * Characters that are easy to confuse under noise or in a pileup. Used by the
 * desirability model: a suffix built from mutually-confusable letters gets
 * copied wrong on the air.
 */
const CONFUSION_SETS: string[][] = [
  ['B', 'D', 'V', '6'],
  ['S', 'H', '5'],
  ['M', 'O'],
  ['U', 'V'],
  ['N', 'D'],
  ['A', 'W'],
  ['I', 'S'],
  ['E', 'T'],
  ['1', 'J'],
  ['0', 'O'],
];

const CONFUSION_MAP = new Map<string, Set<string>>();
for (const set of CONFUSION_SETS) {
  for (const ch of set) {
    if (!CONFUSION_MAP.has(ch)) CONFUSION_MAP.set(ch, new Set());
    for (const other of set) if (other !== ch) CONFUSION_MAP.get(ch)!.add(other);
  }
}

/**
 * 0 = no confusable adjacency, 1 = every adjacent pair is confusable.
 * Adjacency matters more than mere presence: "BD" is worse than "B7D".
 */
export function confusability(call: string): number {
  const s = call.toUpperCase();
  if (s.length < 2) return 0;
  let hits = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (CONFUSION_MAP.get(s[i])?.has(s[i + 1])) hits++;
  }
  return hits / (s.length - 1);
}
