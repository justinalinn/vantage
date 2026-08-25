import { describe, it, expect } from 'vitest';
import { parseCall, suggestZeroFix } from './format';
import { groupForCall, classCanHold, isValidPrefix } from './groups';
import { morseWeight, phoneticWeight, confusability } from './weights';
import { isReserved, reservedReason } from './reserved';
import { regionForCall, regionForState, isGeographicallyRestricted } from './regions';
import { computeAvailability } from '../fcc/availability';
import { timelineFor, receiptDateFor, batchDateFor, filingDateFor } from '../fcc/timeline';
import { isFederalHoliday, isWorkday, utc } from '../fcc/holidays';
import { desirability } from './desirability';

describe('callsign parsing', () => {
  it('parses each vanity format', () => {
    expect(parseCall('K1AB')?.format).toBe('1x2');
    expect(parseCall('KA1B')?.format).toBe('2x1');
    expect(parseCall('KA1BC')?.format).toBe('2x2');
    expect(parseCall('K1ABC')?.format).toBe('1x3');
    expect(parseCall('KA1BCD')?.format).toBe('2x3');
  });

  it('rejects malformed input', () => {
    expect(parseCall('1KAB')).toBeNull();
    expect(parseCall('KABC')).toBeNull();
    expect(parseCall('K1ABCD')).toBeNull();
  });

  it('offers the letter-O-for-zero correction that the FCC dismisses', () => {
    expect(suggestZeroFix('KOAB')).toBe('K0AB');
    expect(suggestZeroFix('K1AB')).toBeNull();
  });
});

describe('call sign groups', () => {
  it('assigns mainland groups', () => {
    expect(groupForCall('K1AB')).toBe('A'); // 1x2
    expect(groupForCall('KA1B')).toBe('A'); // 2x1
    expect(groupForCall('AA1AB')).toBe('A'); // 2x2 starting with A
    expect(groupForCall('KA1BC')).toBe('B'); // 2x2 K/N/W
    expect(groupForCall('K1ABC')).toBe('C'); // 1x3
    expect(groupForCall('KA1BCD')).toBe('D'); // 2x3
  });

  it('shifts the territory ladder down one rung', () => {
    // Territories have no 1x2 or 1x3, so 2x2 fills the lower slots.
    expect(groupForCall('KL7A')).toBe('A'); // 2x1
    expect(groupForCall('KL7AB')).toBe('C'); // 2x2 K/N/W -> General
    expect(groupForCall('AL7AB')).toBe('B'); // 2x2 A-prefix -> Advanced
    expect(groupForCall('KL7ABC')).toBe('D'); // 2x3
  });

  it('treats KP as the documented exception among territory 2x2', () => {
    // Verified against ULS group_code: KP 2x2 is B in 99.9% of 1,062 records,
    // while every other territory 2x2 is C.
    expect(groupForCall('KP4AB')).toBe('B');
    expect(groupForCall('NP4AB')).toBe('C');
    expect(groupForCall('WP4AB')).toBe('C');
  });

  it('rejects prefixes allocated to other countries', () => {
    expect(isValidPrefix('AM')).toBe(false);
    expect(isValidPrefix('AZ')).toBe(false);
    expect(isValidPrefix('AA')).toBe(true);
    expect(isValidPrefix('AK')).toBe(true);
  });

  it('does not issue N-prefix 2x3', () => {
    expect(groupForCall('NA1BCD')).toBeNull();
  });

  it('enforces class eligibility as a ladder', () => {
    expect(classCanHold('E', 'A')).toBe(true);
    expect(classCanHold('A', 'A')).toBe(false);
    expect(classCanHold('A', 'B')).toBe(true);
    expect(classCanHold('G', 'B')).toBe(false);
    expect(classCanHold('G', 'C')).toBe(true);
    expect(classCanHold('N', 'C')).toBe(false);
    expect(classCanHold('N', 'D')).toBe(true);
  });
});

describe('weights', () => {
  // Verified against AE7Q's published values.
  it('reproduces AE7Q Morse weights', () => {
    expect(morseWeight('K1AK')).toBe(52);
    expect(morseWeight('K1AU')).toBe(50);
    expect(morseWeight('K1BH')).toBe(54);
  });

  it('reproduces AE7Q phonetic weights', () => {
    expect(phoneticWeight('K1AK')).toBe(7);
    expect(phoneticWeight('K1AU')).toBe(8);
    expect(phoneticWeight('N1GI')).toBe(8);
    expect(phoneticWeight('K1SS')).toBe(9);
  });

  it('scores adjacent confusable characters', () => {
    expect(confusability('BD')).toBeGreaterThan(0);
    expect(confusability('AQ')).toBe(0);
  });
});

describe('reserved blocks', () => {
  it('blocks the documented ranges and suffixes', () => {
    expect(isReserved('KA2AA')).toBe(true); // US Army Japan
    expect(isReserved('KG4AB')).toBe(true); // Guantanamo
    expect(isReserved('K1SOS')).toBe(true); // distress
    expect(isReserved('K1QRZ')).toBe(true); // Q-signal
    expect(isReserved('K1ABC')).toBe(false);
  });

  it('explains why', () => {
    expect(reservedReason('K1SOS')?.reason).toBe('Reserved suffix');
    expect(reservedReason('AM1AB')?.reason).toBe('Foreign allocation');
  });
});

describe('regions', () => {
  it('lets a territory prefix override the digit', () => {
    expect(regionForCall('KL', 7)).toBe(11); // Alaska, not district 7
    expect(regionForCall('KP', 4)).toBe(12); // Caribbean
    expect(regionForCall('KH', 6)).toBe(13); // Pacific
    expect(regionForCall('K', 6)).toBe(6);
  });

  it('maps states to home regions', () => {
    expect(regionForState('CA')).toBe(6);
    expect(regionForState('AK')).toBe(11);
    expect(regionForState('PR')).toBe(12);
  });

  it('flags geographic restriction', () => {
    expect(isGeographicallyRestricted('KL')).toBe(true);
    expect(isGeographicallyRestricted('KA')).toBe(false);
  });
});

describe('availability', () => {
  const base = { grantDate: null, expiredDate: null, cancelDate: null, lastActionDate: null };

  it('holds a canceled call for two calendar years and a day', () => {
    // 2024 is a leap year, so this span is 732 actual days. Treating the term
    // as a fixed 731 days would return 2026-01-01 and invite a dismissal.
    const r = computeAvailability(
      { ...base, status: 'C', cancelDate: '2024-01-01', lastActionDate: '2024-01-01' },
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r.availableDate).toBe('2026-01-02');
    expect(r.availableNow).toBe(true);
    expect(r.boundByVisibilityRule).toBe(false);
  });

  it('applies the 30-day visibility rule when it binds later', () => {
    // The FCC back-sets cancel_date so the two terms collide deliberately.
    const r = computeAvailability(
      { ...base, status: 'C', cancelDate: '2024-01-01', lastActionDate: '2026-05-01' },
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r.availableDate).toBe('2026-06-01');
    expect(r.boundByVisibilityRule).toBe(true);
  });

  it('treats an expired record as already past its hold', () => {
    const r = computeAvailability(
      { ...base, status: 'E', expiredDate: '2023-01-01', cancelDate: '2025-01-02' },
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r.availableNow).toBe(true);
  });

  it('does not release a licence that is still in force', () => {
    const r = computeAvailability(
      { ...base, status: 'A', expiredDate: '2030-01-01' },
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(r.availableNow).toBe(false);
    // Still projected, because an unrenewed licence opens on a knowable date and
    // that projection is the whole basis of the upcoming-calls pipeline.
    expect(r.availableDate).toBe('2032-01-02');
  });

  it('releases a lapsed licence the FCC still records as active', () => {
    // The single most consequential rule in the file. ULS leaves status 'A' for
    // the entire 2-year grace period, so reading the status letter as "in use"
    // hides every call that is about to open — and every call that already has.
    // K3UF is the worked example: expired 2024-08-17, open 2026-08-18, and both
    // K2CR and the FCC's own index agree.
    const r = computeAvailability(
      { ...base, status: 'A', expiredDate: '2024-08-17' },
      new Date('2026-08-18T12:00:00Z'),
    );
    expect(r.availableDate).toBe('2026-08-18');
    expect(r.availableNow).toBe(true);
  });

  it('holds a lapsed licence for one more day at the boundary', () => {
    // Filing even a day early is dismissed outright and the fee is forfeit, so
    // an off-by-one here costs the user money rather than accuracy.
    const r = computeAvailability(
      { ...base, status: 'A', expiredDate: '2024-08-17' },
      new Date('2026-08-17T23:59:59Z'),
    );
    expect(r.availableNow).toBe(false);
  });

  it('treats a call with no record as permanently open', () => {
    const r = computeAvailability({ ...base, status: null });
    expect(r.availableNow).toBe(true);
  });
});

describe('filing timeline', () => {
  it('recognises federal holidays with observance shifts', () => {
    // 2026-07-04 falls on a Saturday, so it is observed on Friday the 3rd.
    expect(isFederalHoliday(utc(2026, 7, 3))).toBe(true);
    expect(isWorkday(utc(2026, 7, 3))).toBe(false);
    expect(isFederalHoliday(utc(2026, 12, 25))).toBe(true);
    // A weekend day is never a workday regardless of holiday status.
    expect(isWorkday(utc(2026, 7, 4))).toBe(false);
  });

  it('rolls a weekend filing to the next workday', () => {
    // 2026-08-15 is a Saturday.
    expect(receiptDateFor(utc(2026, 8, 15)).getUTCDay()).toBe(1); // Monday
  });

  it('batches more than 17 days past receipt, on a workday', () => {
    const receipt = utc(2026, 8, 3); // Monday
    const batch = batchDateFor(receipt);
    const gap = (batch.getTime() - receipt.getTime()) / 86400000;
    expect(gap).toBeGreaterThan(17);
    expect(isWorkday(batch)).toBe(true);
  });

  it('produces the documented 18-20 day total delay', () => {
    for (let d = 1; d <= 28; d++) {
      const tl = timelineFor(utc(2026, 9, d));
      expect(tl.totalDays).toBeGreaterThanOrEqual(18);
      expect(tl.totalDays).toBeLessThanOrEqual(25); // holidays can extend it
    }
  });
});

describe('desirability', () => {
  it('rewards repeating and sequential suffixes', () => {
    expect(desirability('K1AAA').repetition).toBeGreaterThan(desirability('K1XQJ').repetition);
    expect(desirability('W9ABC').repetition).toBeGreaterThan(desirability('W9XQJ').repetition);
  });

  it('rewards short Morse', () => {
    expect(desirability('W1EE').brevity).toBeGreaterThan(desirability('KJ0QQQ').brevity);
  });

  it('honours personal context', () => {
    const withInitials = desirability('K1XY', undefined, { initials: 'XY' });
    const without = desirability('K1XY');
    expect(withInitials.personal).toBeGreaterThan(without.personal);
  });
});

describe('filing date for a call that is about to open', () => {
  // The highest-stakes number on the site. One day early is dismissed and the
  // $35 is forfeit; one day late loses the call to whoever filed on day zero,
  // because the FCC works batches in receipt-date order.

  it('files on the opening day itself', () => {
    const f = filingDateFor(utc(2026, 9, 15)); // a Tuesday
    expect(f.file).toBe('2026-09-15');
    expect(f.receipt).toBe('2026-09-15');
  });

  it('never produces a receipt date earlier than the opening date', () => {
    // Walk a full year. A receipt before the opening date would be dismissed as
    // premature, so this invariant is the whole point of the function.
    for (let i = 0; i < 365; i++) {
      const open = new Date(Date.UTC(2026, 0, 1 + i));
      const f = filingDateFor(open);
      expect(f.receipt >= f.file).toBe(true);
    }
  });

  it('rolls a weekend opening to the next workday receipt', () => {
    // 2026-09-19 is a Saturday. Filing that day and filing on the Monday share
    // a receipt date, so they share a draw — filing on the day is never worse.
    const sat = filingDateFor(utc(2026, 9, 19));
    expect(sat.file).toBe('2026-09-19');
    expect(sat.receipt).toBe('2026-09-21');
    expect(filingDateFor(utc(2026, 9, 21)).receipt).toBe(sat.receipt);
  });
});
