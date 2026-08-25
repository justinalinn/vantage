/**
 * Multi-axis desirability scoring.
 *
 * AE7Q and K2CR both reduce "how good is this call" to a single Morse weight.
 * That conflates several independent things a real operator cares about, so we
 * score each axis separately, expose the weights, and let the user retune them.
 * Every sub-score is normalized to 0-100 where higher is better.
 */

import { parseCall } from './format';
import { confusability, morseWeight, phoneticWeight } from './weights';

export interface DesirabilityWeights {
  brevity: number;
  phonetic: number;
  clarity: number;
  rhythm: number;
  repetition: number;
  personal: number;
}

export const DEFAULT_WEIGHTS: DesirabilityWeights = {
  brevity: 1.0,
  phonetic: 0.7,
  clarity: 0.8,
  rhythm: 0.5,
  repetition: 0.6,
  personal: 1.2,
};

export interface PersonalContext {
  /** e.g. "JL" — a suffix containing these scores higher. */
  initials?: string;
  /** Words or fragments the user wants to see in the suffix, e.g. "CAT". */
  keywords?: string[];
  /** Preferred call region; out-of-region scores lower but is not disqualifying. */
  homeRegion?: number;
}

export interface DesirabilityBreakdown {
  score: number;
  brevity: number;
  phonetic: number;
  clarity: number;
  rhythm: number;
  repetition: number;
  personal: number;
  notes: string[];
}

// Observed Morse-weight bounds across real callsigns, used to normalize.
const MORSE_MIN = 26; // e.g. W1EE-ish
const MORSE_MAX = 130; // long 2x3 with many dashes

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

function clamp(x: number): number {
  return Math.max(0, Math.min(100, x));
}

/** Shorter to send is better. */
function brevityScore(call: string): number {
  const w = morseWeight(call);
  return clamp(((MORSE_MAX - w) / (MORSE_MAX - MORSE_MIN)) * 100);
}

/** Fewer syllables on phone is better. */
function phoneticScore(call: string): number {
  const s = phoneticWeight(call);
  // Real range is roughly 4 (W1EE) to 20 (2x3 with India/November/Juliett).
  return clamp(((20 - s) / 16) * 100);
}

/** Penalize adjacent confusable characters. */
function clarityScore(call: string): number {
  return clamp((1 - confusability(call)) * 100);
}

/**
 * Rhythm: a suffix that alternates dots and dashes is crisper on CW than one
 * that is all dashes. Measured as the balance of dot-heavy vs dash-heavy
 * characters plus vowel presence for phone.
 */
function rhythmScore(call: string): number {
  const p = parseCall(call);
  if (!p) return 50;
  const suffix = p.suffix;
  const hasVowel = [...suffix].some((c) => VOWELS.has(c));
  const w = morseWeight(suffix) / Math.max(1, suffix.length);
  // Per-character weight ranges ~6 (E) to ~22 (0). Mid values read as balanced.
  const balance = 100 - Math.abs(w - 12) * 7;
  return clamp(balance + (hasVowel ? 12 : -6));
}

/**
 * Repeated and sequential letters are memorable and prized on the air
 * (K1AAA, W9XYZ). Palindromes score too.
 */
function repetitionScore(call: string): number {
  const p = parseCall(call);
  if (!p) return 50;
  const s = p.suffix;
  let score = 40;
  const notes: string[] = [];

  const uniq = new Set(s).size;
  if (s.length >= 2 && uniq === 1) score += 45; // AAA / AA
  else if (s.length === 3 && uniq === 2) score += 15;

  // Sequential runs, forward or backward.
  let seq = true;
  let rev = true;
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) + 1) seq = false;
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) - 1) rev = false;
  }
  if (s.length >= 2 && (seq || rev)) score += 25;

  // Palindromic whole call, e.g. N7N.
  const c = p.call;
  if (c === [...c].reverse().join('')) score += 20;

  return clamp(score);
}

function personalScore(call: string, ctx: PersonalContext | undefined, notes: string[]): number {
  if (!ctx) return 50;
  const p = parseCall(call);
  if (!p) return 50;
  let score = 50;

  if (ctx.initials) {
    const init = ctx.initials.toUpperCase().replace(/[^A-Z]/g, '');
    if (init && p.suffix === init) {
      score += 45;
      notes.push(`Suffix is exactly your initials (${init}).`);
    } else if (init && p.suffix.includes(init)) {
      score += 22;
      notes.push(`Suffix contains your initials (${init}).`);
    }
  }

  for (const kw of ctx.keywords ?? []) {
    const k = kw.toUpperCase().replace(/[^A-Z]/g, '');
    if (!k) continue;
    if (p.suffix === k) {
      score += 40;
      notes.push(`Suffix spells "${k}".`);
      break;
    }
    if (p.suffix.includes(k)) {
      score += 18;
      notes.push(`Suffix contains "${k}".`);
      break;
    }
  }

  if (ctx.homeRegion != null) {
    if (p.digit === ctx.homeRegion) {
      score += 10;
      notes.push('Matches your home call region.');
    } else {
      score -= 8;
    }
  }

  return clamp(score);
}

export function desirability(
  call: string,
  weights: DesirabilityWeights = DEFAULT_WEIGHTS,
  ctx?: PersonalContext,
): DesirabilityBreakdown {
  const notes: string[] = [];
  const brevity = brevityScore(call);
  const phonetic = phoneticScore(call);
  const clarity = clarityScore(call);
  const rhythm = rhythmScore(call);
  const repetition = repetitionScore(call);
  const personal = personalScore(call, ctx, notes);

  const totalW =
    weights.brevity + weights.phonetic + weights.clarity + weights.rhythm + weights.repetition + weights.personal;

  const score =
    (brevity * weights.brevity +
      phonetic * weights.phonetic +
      clarity * weights.clarity +
      rhythm * weights.rhythm +
      repetition * weights.repetition +
      personal * weights.personal) /
    (totalW || 1);

  if (repetition > 80) notes.push('Repeating or sequential suffix — highly memorable.');
  if (clarity < 45) notes.push('Contains adjacent characters that are easily confused in a pileup.');
  if (brevity > 80) notes.push('Very fast to send on CW.');

  return {
    score: Math.round(score),
    brevity: Math.round(brevity),
    phonetic: Math.round(phonetic),
    clarity: Math.round(clarity),
    rhythm: Math.round(rhythm),
    repetition: Math.round(repetition),
    personal: Math.round(personal),
    notes,
  };
}

/** Fast path for bulk scoring during ingest: no personal context. */
export function baseDesirability(call: string): number {
  return desirability(call).score;
}
