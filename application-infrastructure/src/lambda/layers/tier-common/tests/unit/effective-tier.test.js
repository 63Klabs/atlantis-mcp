'use strict';
/**
 * Unit tests for effective-tier.js (tier-common Lambda Layer).
 *
 * Purpose: Pin the one rule for reading a user's `tierExpiresAt`:
 *   - every accepted form parses to the expected instant;
 *   - every rejected form is `malformed`, and `null`/`undefined` are `none`;
 *   - the boundary instant (equal to now) is `lapsed`;
 *   - the Fallback table (a remembered lower tier) of Requirement 19;
 *   - `fallbackFromRecord`, `resolveRecordTier`, `tierRank`, and
 *     `malformedExpiryLogFields`;
 *   - no promotable tier outranks `private`.
 *
 * Setup: None. The module is pure (no AWS SDK, no I/O, no logging) and reads
 * the clock only through the `nowMs` argument, which every case fixes.
 *
 * Written before the module exists (spec 0-0-7-lapsed-tier-downgrade, task 6.2),
 * so these tests fail with "Cannot find module" until task 6.3.
 *
 * Validates: Requirements 7.1 to 7.7, 8.1, 8.7, 15.1, 15.10, 15.11, 19.1,
 * 19.4, 19.5, 19.8, 19.9, 19.12.
 */

const {
  TIER_RANK,
  EXPIRY_STATE,
  parseTierExpiry,
  computeEffectiveTier,
  fallbackFromRecord,
  resolveRecordTier,
  tierRank,
  malformedExpiryLogFields
} = require('../../nodejs/effective-tier');

/** Fixed "now" for every case: 2026-06-15T12:00:00.000Z. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0, 0);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Tiers a voucher may grant (mirrors PROMOTABLE_TIERS in the auth-function, Design 9). */
const PROMOTABLE_TIERS = ['paid', 'private'];

/** An ISO 8601 string `deltaMs` away from NOW. */
const isoFromNow = (deltaMs) => new Date(NOW + deltaMs).toISOString();

describe('constants', () => {
  test('TIER_RANK orders public < registered < paid < private', () => {
    expect(TIER_RANK).toEqual({ public: 0, registered: 1, paid: 2, private: 3 });
  });

  test('TIER_RANK and EXPIRY_STATE are frozen', () => {
    expect(Object.isFrozen(TIER_RANK)).toBe(true);
    expect(Object.isFrozen(EXPIRY_STATE)).toBe(true);
  });

  test('EXPIRY_STATE holds the four states', () => {
    expect(EXPIRY_STATE).toEqual({
      NONE: 'none',
      ACTIVE: 'active',
      LAPSED: 'lapsed',
      MALFORMED: 'malformed'
    });
  });
});

describe('parseTierExpiry - accepted forms', () => {
  // [description, input, expected instant in ms since epoch]
  const acceptedForms = [
    ['date only means 00:00:00 UTC', '2030-12-31', Date.UTC(2030, 11, 31)],
    ['HH:mm with Z', '2030-12-31T10:30Z', Date.UTC(2030, 11, 31, 10, 30)],
    ['HH:mm:ss with Z', '2030-12-31T10:30:45Z', Date.UTC(2030, 11, 31, 10, 30, 45)],
    ['one fraction digit is padded on the right (.5 = 500 ms)', '2030-12-31T10:30:45.5Z', Date.UTC(2030, 11, 31, 10, 30, 45, 500)],
    ['two fraction digits (.05 = 50 ms)', '2030-12-31T10:30:45.05Z', Date.UTC(2030, 11, 31, 10, 30, 45, 50)],
    ['three fraction digits', '2030-12-31T10:30:45.123Z', Date.UTC(2030, 11, 31, 10, 30, 45, 123)],
    ['three fraction digits, leading zeros (.007)', '2030-12-31T10:30:45.007Z', Date.UTC(2030, 11, 31, 10, 30, 45, 7)],
    ['positive offset with minutes is subtracted (+05:30)', '2030-12-31T10:30:00+05:30', Date.UTC(2030, 11, 31, 5, 0)],
    ['negative offset is added (-08:00)', '2030-12-31T10:30:00-08:00', Date.UTC(2030, 11, 31, 18, 30)],
    ['HH:mm with an offset', '2030-12-31T10:30+01:00', Date.UTC(2030, 11, 31, 9, 30)],
    ['offset moves the instant to the previous day', '2030-12-31T01:00:00+05:00', Date.UTC(2030, 11, 30, 20, 0)],
    ['offset moves the instant into the next year', '2030-12-31T22:00:00-05:00', Date.UTC(2031, 0, 1, 3, 0)],
    ['largest offset (+23:59)', '2030-12-31T10:00:00+23:59', Date.UTC(2030, 11, 31, 10, 0) - (23 * 60 + 59) * 60 * 1000],
    ['zero offset written numerically (+00:00)', '2030-12-31T10:00:00+00:00', Date.UTC(2030, 11, 31, 10, 0)],
    ['last second of the day', '2030-12-31T23:59:59Z', Date.UTC(2030, 11, 31, 23, 59, 59)],
    ['longest accepted form (29 characters)', '2030-12-31T10:30:45.123+05:30', Date.UTC(2030, 11, 31, 5, 0, 45, 123)]
  ];

  test.each(acceptedForms)('%s: %s', (_description, input, expectedMs) => {
    // Evaluate far from the instant so the state is unambiguous
    const farBefore = parseTierExpiry(input, expectedMs - 365 * DAY_MS);
    expect(farBefore).toEqual({ state: 'active', expiresAtMs: expectedMs });
    const farAfter = parseTierExpiry(input, expectedMs + 365 * DAY_MS);
    expect(farAfter).toEqual({ state: 'lapsed', expiresAtMs: expectedMs });
  });

  test('the longest accepted form is exactly 29 characters', () => {
    expect('2030-12-31T10:30:45.123+05:30'.length).toBe(29);
  });

  test('a leap day is valid in a leap year (2028-02-29)', () => {
    expect(parseTierExpiry('2028-02-29', 0)).toEqual({ state: 'active', expiresAtMs: Date.UTC(2028, 1, 29) });
  });

  test('2000-02-29 is valid (divisible by 400)', () => {
    expect(parseTierExpiry('2000-02-29', 0)).toEqual({ state: 'active', expiresAtMs: Date.UTC(2000, 1, 29) });
  });

  test('years 0 to 99 are read as written, not as 1900 to 1999', () => {
    const expectedMs = new Date(0).setUTCFullYear(50, 0, 1);
    expect(expectedMs).not.toBe(Date.UTC(50, 0, 1));
    // Evaluate one ms before the instant: year 0050 is before the epoch, so now = 0 would make it lapsed
    expect(parseTierExpiry('0050-01-01', expectedMs - 1)).toEqual({ state: 'active', expiresAtMs: expectedMs });
    expect(parseTierExpiry('0050-01-01', expectedMs)).toEqual({ state: 'lapsed', expiresAtMs: expectedMs });
  });

  test('uses the real clock when nowMs is omitted', () => {
    expect(parseTierExpiry('9999-12-31').state).toBe('active');
    expect(parseTierExpiry('2000-01-01').state).toBe('lapsed');
  });
});

describe('parseTierExpiry - none', () => {
  test('null is none', () => {
    expect(parseTierExpiry(null, NOW)).toEqual({ state: 'none', expiresAtMs: null });
  });

  test('undefined is none', () => {
    expect(parseTierExpiry(undefined, NOW)).toEqual({ state: 'none', expiresAtMs: null });
  });
});

describe('parseTierExpiry - boundary', () => {
  test('an instant equal to now is lapsed', () => {
    const result = parseTierExpiry('2026-06-15T12:00:00Z', NOW);
    expect(result).toEqual({ state: 'lapsed', expiresAtMs: NOW });
  });

  test('an instant one millisecond after now is active', () => {
    const result = parseTierExpiry('2026-06-15T12:00:00.001Z', NOW);
    expect(result).toEqual({ state: 'active', expiresAtMs: NOW + 1 });
  });

  test('an instant one millisecond before now is lapsed', () => {
    const result = parseTierExpiry('2026-06-15T11:59:59.999Z', NOW);
    expect(result).toEqual({ state: 'lapsed', expiresAtMs: NOW - 1 });
  });

  test('a date-only value is lapsed from the first instant of that day (00:00:00 UTC)', () => {
    const midnight = Date.UTC(2026, 5, 15);
    expect(parseTierExpiry('2026-06-15', midnight).state).toBe('lapsed');
    expect(parseTierExpiry('2026-06-15', midnight - 1).state).toBe('active');
  });

  test('the same instant written with different offsets has the same state', () => {
    // 12:00Z == 17:30+05:30 == 04:00-08:00
    const forms = ['2026-06-15T12:00:00Z', '2026-06-15T17:30:00+05:30', '2026-06-15T04:00:00-08:00'];
    for (const form of forms) {
      expect(parseTierExpiry(form, NOW)).toEqual({ state: 'lapsed', expiresAtMs: NOW });
      expect(parseTierExpiry(form, NOW - 1)).toEqual({ state: 'active', expiresAtMs: NOW });
    }
  });
});

describe('parseTierExpiry - malformed', () => {
  const malformedStrings = [
    ['empty string', ''],
    ['leading whitespace', ' 2026-12-31'],
    ['trailing whitespace', '2026-12-31 '],
    ['trailing newline', '2026-12-31\n'],
    ['lower-case z', '2026-12-31T00:00:00z'],
    ['date-time without an offset', '2026-12-31T00:00:00'],
    ['HH:mm without an offset', '2026-12-31T00:00'],
    ['offset after a date-only value', '2026-12-31Z'],
    ['numeric offset after a date-only value', '2026-12-31+05:00'],
    ['space instead of T', '2026-12-31 00:00:00Z'],
    ['hour only', '2026-12-31T00Z'],
    ['fraction without seconds', '2026-12-31T00:00.5Z'],
    ['four fraction digits', '2026-12-31T00:00:00.1234Z'],
    ['empty fraction', '2026-12-31T00:00:00.Z'],
    ['offset without a colon', '2026-12-31T00:00:00+0500'],
    ['offset hours only', '2026-12-31T00:00:00+05'],
    ['two-digit year', '26-12-31'],
    ['single-digit month', '2026-1-31'],
    ['slashes', '2026/12/31'],
    ['compact basic format', '20261231'],
    ['non-ASCII digits', '\u0662\u0660\u0662\u0666-12-31'],
    ['plain text', 'never'],
    ['an epoch number as a string', '1767225600']
  ];

  test.each(malformedStrings)('%s is malformed', (_description, input) => {
    expect(parseTierExpiry(input, NOW)).toEqual({ state: 'malformed', expiresAtMs: null });
  });

  const outOfRange = [
    ['a day that does not exist (2026-02-30)', '2026-02-30'],
    ['Feb 29 in a non-leap year (2026-02-29)', '2026-02-29'],
    ['Feb 29 in a century that is not a leap year (2100-02-29)', '2100-02-29'],
    ['April 31', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['day 32', '2026-01-32'],
    ['hour 24', '2026-12-31T24:00Z'],
    ['minute 60', '2026-12-31T00:60Z'],
    ['second 60', '2026-12-31T00:00:60Z'],
    ['offset hour 24', '2026-12-31T00:00:00+24:00'],
    ['negative offset hour 24', '2026-12-31T00:00:00-24:00'],
    ['offset minute 60', '2026-12-31T00:00:00+05:60']
  ];

  test.each(outOfRange)('%s is malformed', (_description, input) => {
    expect(parseTierExpiry(input, NOW)).toEqual({ state: 'malformed', expiresAtMs: null });
  });

  const nonStrings = [
    ['an epoch number', 1767225600],
    ['zero', 0],
    ['NaN', NaN],
    ['true', true],
    ['false', false],
    ['an empty object', {}],
    ['an empty array', []],
    ['an array holding a valid string', ['2026-12-31']],
    ['a Date object', new Date(Date.UTC(2030, 0, 1))],
    ['a bigint', 10n],
    ['a function', () => '2030-01-01']
  ];

  test.each(nonStrings)('%s is malformed', (_description, input) => {
    expect(parseTierExpiry(input, NOW)).toEqual({ state: 'malformed', expiresAtMs: null });
  });

  test('a valid form followed by extra characters is malformed (longer than 29 characters)', () => {
    expect(parseTierExpiry('2030-12-31T10:30:45.123+05:30X', NOW).state).toBe('malformed');
    expect(parseTierExpiry('2030-12-31T10:30:45.123+05:30' + ' '.repeat(50), NOW).state).toBe('malformed');
  });

  test('a long string of digits is malformed', () => {
    expect(parseTierExpiry('1'.repeat(30), NOW).state).toBe('malformed');
  });

  test('does not rely on Date.parse or new Date(string) (Requirement 7.7)', () => {
    // Date.parse accepts these; the layer's grammar does not
    const acceptedByDateParse = ['2026-12-31T00:00:00', 'Dec 31 2026', '2026-12-31 00:00:00Z', '2026/12/31'];
    for (const input of acceptedByDateParse) {
      expect(Number.isNaN(Date.parse(input))).toBe(false);
      expect(parseTierExpiry(input, NOW).state).toBe('malformed');
    }
    const parseSpy = jest.spyOn(Date, 'parse');
    parseTierExpiry('2030-12-31T10:30:45Z', NOW);
    parseTierExpiry('not a date', NOW);
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });
});

describe('tierRank', () => {
  test('returns the rank of each known tier', () => {
    expect(tierRank('public')).toBe(0);
    expect(tierRank('registered')).toBe(1);
    expect(tierRank('paid')).toBe(2);
    expect(tierRank('private')).toBe(3);
  });

  test('returns undefined for an unknown tier', () => {
    expect(tierRank('gold')).toBeUndefined();
    expect(tierRank('')).toBeUndefined();
    expect(tierRank('PAID')).toBeUndefined();
  });

  test('returns undefined for names inherited from Object.prototype', () => {
    expect(tierRank('constructor')).toBeUndefined();
    expect(tierRank('__proto__')).toBeUndefined();
    expect(tierRank('toString')).toBeUndefined();
    expect(tierRank('hasOwnProperty')).toBeUndefined();
  });

  test('returns undefined for values that are not strings', () => {
    expect(tierRank(undefined)).toBeUndefined();
    expect(tierRank(null)).toBeUndefined();
    expect(tierRank(2)).toBeUndefined();
    expect(tierRank({})).toBeUndefined();
  });
});

describe('computeEffectiveTier - without a Fallback', () => {
  test('none keeps the stored tier', () => {
    expect(computeEffectiveTier('paid', null, NOW)).toEqual({
      tier: 'paid',
      state: 'none',
      expiresAtMs: null,
      restoreTo: null,
      fallbackState: null
    });
    expect(computeEffectiveTier('private', undefined, NOW).tier).toBe('private');
  });

  test('active keeps the stored tier and reports the end instant', () => {
    const end = isoFromNow(DAY_MS);
    expect(computeEffectiveTier('paid', end, NOW)).toEqual({
      tier: 'paid',
      state: 'active',
      expiresAtMs: NOW + DAY_MS,
      restoreTo: null,
      fallbackState: null
    });
  });

  test('lapsed gives registered, with fallbackState absent', () => {
    expect(computeEffectiveTier('paid', isoFromNow(-DAY_MS), NOW)).toEqual({
      tier: 'registered',
      state: 'lapsed',
      expiresAtMs: NOW - DAY_MS,
      restoreTo: null,
      fallbackState: 'absent'
    });
  });

  test('an end date equal to now is lapsed', () => {
    const result = computeEffectiveTier('private', isoFromNow(0), NOW);
    expect(result.state).toBe('lapsed');
    expect(result.tier).toBe('registered');
  });

  test('malformed gives registered and no instant', () => {
    expect(computeEffectiveTier('paid', 1767225600, NOW)).toEqual({
      tier: 'registered',
      state: 'malformed',
      expiresAtMs: null,
      restoreTo: null,
      fallbackState: null
    });
    expect(computeEffectiveTier('private', 'next tuesday', NOW).tier).toBe('registered');
  });

  test('a stored tier outside the tier rank passes through for none and active (Requirement 8.7)', () => {
    expect(computeEffectiveTier('gold', null, NOW).tier).toBe('gold');
    expect(computeEffectiveTier('gold', isoFromNow(DAY_MS), NOW).tier).toBe('gold');
  });

  test('a stored tier outside the tier rank becomes registered when lapsed or malformed', () => {
    expect(computeEffectiveTier('gold', isoFromNow(-1), NOW).tier).toBe('registered');
    expect(computeEffectiveTier('gold', 'bad', NOW).tier).toBe('registered');
  });

  test('uses the real clock when nowMs is omitted or undefined', () => {
    expect(computeEffectiveTier('paid', '2000-01-01T00:00:00Z').tier).toBe('registered');
    expect(computeEffectiveTier('paid', '2000-01-01T00:00:00Z', undefined).tier).toBe('registered');
    expect(computeEffectiveTier('paid', '9999-12-31T00:00:00Z', undefined).tier).toBe('paid');
  });
});

describe('computeEffectiveTier - Fallback table (Requirement 19)', () => {
  const LAPSED = isoFromNow(-DAY_MS);
  const FUTURE = isoFromNow(30 * DAY_MS);
  const PAST = isoFromNow(-2 * DAY_MS);

  test('valid: a permanent remembered tier (null end date)', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: null });
    expect(result).toEqual({
      tier: 'paid',
      state: 'lapsed',
      expiresAtMs: NOW - DAY_MS,
      restoreTo: { tier: 'paid', tierExpiresAt: null, state: 'none', expiresAtMs: null },
      fallbackState: 'valid'
    });
  });

  test('valid: a remembered tier with an active end date', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: FUTURE });
    expect(result.tier).toBe('paid');
    expect(result.fallbackState).toBe('valid');
    expect(result.restoreTo).toEqual({
      tier: 'paid',
      tierExpiresAt: FUTURE,
      state: 'active',
      expiresAtMs: NOW + 30 * DAY_MS
    });
  });

  test('valid: an absent end date is restored as null', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid' });
    expect(result.fallbackState).toBe('valid');
    expect(result.restoreTo).toEqual({ tier: 'paid', tierExpiresAt: null, state: 'none', expiresAtMs: null });
  });

  test('valid: an undefined end date is restored as null', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: undefined });
    expect(result.restoreTo.tierExpiresAt).toBeNull();
  });

  test('valid: the end date may use any accepted form', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: '2099-01-01' });
    expect(result.fallbackState).toBe('valid');
    expect(result.restoreTo.tierExpiresAt).toBe('2099-01-01');
    expect(result.restoreTo.expiresAtMs).toBe(Date.UTC(2099, 0, 1));
  });

  test('absent: null, undefined, and values that are not objects', () => {
    for (const fallback of [null, undefined, 'paid', 2, true]) {
      const result = computeEffectiveTier('private', LAPSED, NOW, fallback);
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBe('absent');
    }
  });

  test('absent: when the argument is omitted', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW);
    expect(result.fallbackState).toBe('absent');
  });

  test('lapsed: a remembered end date at or before now gives registered', () => {
    const past = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: PAST });
    expect(past.tier).toBe('registered');
    expect(past.restoreTo).toBeNull();
    expect(past.fallbackState).toBe('lapsed');
    const atNow = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: isoFromNow(0) });
    expect(atNow.fallbackState).toBe('lapsed');
    expect(atNow.tier).toBe('registered');
  });

  test('malformed: a remembered end date that does not parse gives registered', () => {
    for (const bad of ['soon', 1767225600, '2026-02-30', '', {}]) {
      const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: bad });
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBe('malformed');
    }
  });

  test('invalid: a tier name that is not in the tier rank', () => {
    for (const tier of ['gold', '', 'PAID', 'constructor', '__proto__', 'toString', 5, null, undefined, {}]) {
      const result = computeEffectiveTier('private', LAPSED, NOW, { tier, tierExpiresAt: null });
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBe('invalid');
    }
  });

  test('invalid: a remembered tier that ranks at or below registered', () => {
    for (const tier of ['public', 'registered']) {
      const result = computeEffectiveTier('private', LAPSED, NOW, { tier, tierExpiresAt: null });
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBe('invalid');
    }
  });

  test('invalid: a remembered tier that ranks at or above the stored tier', () => {
    const cases = [
      ['paid', 'paid'],
      ['paid', 'private'],
      ['private', 'private']
    ];
    for (const [storedTier, tier] of cases) {
      const result = computeEffectiveTier(storedTier, LAPSED, NOW, { tier, tierExpiresAt: null });
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBe('invalid');
    }
  });

  test('invalid: a stored tier with no rank has nothing to restore under', () => {
    const result = computeEffectiveTier('gold', LAPSED, NOW, { tier: 'paid', tierExpiresAt: null });
    expect(result.tier).toBe('registered');
    expect(result.restoreTo).toBeNull();
    expect(result.fallbackState).toBe('invalid');
  });

  test('invalid: a registered stored tier has nothing to restore under', () => {
    const result = computeEffectiveTier('registered', LAPSED, NOW, { tier: 'paid', tierExpiresAt: null });
    expect(result.tier).toBe('registered');
    expect(result.fallbackState).toBe('invalid');
  });

  test('the tier is checked before the end date (unknown tier with a malformed end date is invalid)', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'gold', tierExpiresAt: 'soon' });
    expect(result.fallbackState).toBe('invalid');
  });

  test('a restore never names a tier above the one that lapsed', () => {
    const result = computeEffectiveTier('private', LAPSED, NOW, { tier: 'paid', tierExpiresAt: null });
    expect(tierRank(result.restoreTo.tier)).toBeLessThan(tierRank('private'));
    expect(tierRank(result.restoreTo.tier)).toBeGreaterThan(tierRank('registered'));
  });

  describe('ignored unless the stored end date is lapsed', () => {
    const validFallback = { tier: 'paid', tierExpiresAt: null };

    test('none: the stored tier stays', () => {
      const result = computeEffectiveTier('private', null, NOW, validFallback);
      expect(result.tier).toBe('private');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBeNull();
    });

    test('active: the stored tier stays', () => {
      const result = computeEffectiveTier('private', FUTURE, NOW, validFallback);
      expect(result.tier).toBe('private');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBeNull();
    });

    test('malformed: registered, and the Fallback is not used', () => {
      const result = computeEffectiveTier('private', 'bad', NOW, validFallback);
      expect(result.tier).toBe('registered');
      expect(result.restoreTo).toBeNull();
      expect(result.fallbackState).toBeNull();
    });
  });
});

describe('fallbackFromRecord', () => {
  test('returns null when the record has no fallbackTier', () => {
    expect(fallbackFromRecord({})).toBeNull();
    expect(fallbackFromRecord({ tier: 'private', tierExpiresAt: null })).toBeNull();
  });

  test('returns null when fallbackTier is null or undefined', () => {
    expect(fallbackFromRecord({ fallbackTier: null })).toBeNull();
    expect(fallbackFromRecord({ fallbackTier: undefined, fallbackExpiresAt: '2030-01-01' })).toBeNull();
  });

  test('copies tier and end date', () => {
    expect(fallbackFromRecord({ fallbackTier: 'paid', fallbackExpiresAt: '2027-08-29T00:00:00.000Z' })).toEqual({
      tier: 'paid',
      tierExpiresAt: '2027-08-29T00:00:00.000Z'
    });
  });

  test('a null end date stays null', () => {
    expect(fallbackFromRecord({ fallbackTier: 'paid', fallbackExpiresAt: null })).toEqual({
      tier: 'paid',
      tierExpiresAt: null
    });
  });

  test('an absent end date becomes null', () => {
    expect(fallbackFromRecord({ fallbackTier: 'paid' })).toEqual({ tier: 'paid', tierExpiresAt: null });
  });

  test('passes through a fallbackTier that is not a valid tier (the layer judges validity later)', () => {
    expect(fallbackFromRecord({ fallbackTier: '', fallbackExpiresAt: null })).toEqual({ tier: '', tierExpiresAt: null });
    expect(fallbackFromRecord({ fallbackTier: 5 })).toEqual({ tier: 5, tierExpiresAt: null });
  });

  test('does not read the main tier attributes', () => {
    const fallback = fallbackFromRecord({ tier: 'private', tierExpiresAt: '2030-01-01', fallbackTier: 'paid' });
    expect(fallback).toEqual({ tier: 'paid', tierExpiresAt: null });
  });
});

describe('resolveRecordTier', () => {
  test('a record with no end date keeps its tier', () => {
    expect(resolveRecordTier({ tier: 'paid' }, NOW)).toEqual(computeEffectiveTier('paid', undefined, NOW, null));
    expect(resolveRecordTier({ tier: 'paid', tierExpiresAt: null }, NOW).tier).toBe('paid');
  });

  test('an active record keeps its tier', () => {
    const record = { tier: 'private', tierExpiresAt: isoFromNow(DAY_MS) };
    expect(resolveRecordTier(record, NOW).tier).toBe('private');
    expect(resolveRecordTier(record, NOW).state).toBe('active');
  });

  test('a lapsed record without a Fallback is registered', () => {
    const result = resolveRecordTier({ tier: 'paid', tierExpiresAt: isoFromNow(-1) }, NOW);
    expect(result.tier).toBe('registered');
    expect(result.fallbackState).toBe('absent');
  });

  test('a lapsed record with a valid Fallback returns the remembered tier and what to restore', () => {
    const fallbackEnd = isoFromNow(60 * DAY_MS);
    const record = {
      tier: 'private',
      tierExpiresAt: isoFromNow(-1),
      fallbackTier: 'paid',
      fallbackExpiresAt: fallbackEnd
    };
    const result = resolveRecordTier(record, NOW);
    expect(result.tier).toBe('paid');
    expect(result.fallbackState).toBe('valid');
    expect(result.restoreTo).toEqual({
      tier: 'paid',
      tierExpiresAt: fallbackEnd,
      state: 'active',
      expiresAtMs: NOW + 60 * DAY_MS
    });
  });

  test('a lapsed record with an invalid Fallback is registered', () => {
    const record = { tier: 'paid', tierExpiresAt: isoFromNow(-1), fallbackTier: 'private', fallbackExpiresAt: null };
    const result = resolveRecordTier(record, NOW);
    expect(result.tier).toBe('registered');
    expect(result.fallbackState).toBe('invalid');
  });

  test('a lapsed record with a malformed Fallback end date is registered', () => {
    const record = { tier: 'private', tierExpiresAt: isoFromNow(-1), fallbackTier: 'paid', fallbackExpiresAt: 'x' };
    const result = resolveRecordTier(record, NOW);
    expect(result.tier).toBe('registered');
    expect(result.fallbackState).toBe('malformed');
  });

  test('equals computeEffectiveTier called with the record fields and fallbackFromRecord', () => {
    const records = [
      { tier: 'paid' },
      { tier: 'paid', tierExpiresAt: 12345 },
      { tier: 'private', tierExpiresAt: isoFromNow(-5), fallbackTier: 'paid' },
      { tier: 'private', tierExpiresAt: isoFromNow(5), fallbackTier: 'paid' },
      { tier: 'gold', tierExpiresAt: isoFromNow(-5), fallbackTier: 'paid', fallbackExpiresAt: null }
    ];
    for (const record of records) {
      expect(resolveRecordTier(record, NOW)).toEqual(
        computeEffectiveTier(record.tier, record.tierExpiresAt, NOW, fallbackFromRecord(record))
      );
    }
  });

  test('uses the real clock when nowMs is omitted', () => {
    expect(resolveRecordTier({ tier: 'paid', tierExpiresAt: '2000-01-01' }).tier).toBe('registered');
    expect(resolveRecordTier({ tier: 'paid', tierExpiresAt: '9999-12-31' }).tier).toBe('paid');
  });
});

describe('promotable tiers', () => {
  test('no promotable tier outranks private', () => {
    for (const tier of PROMOTABLE_TIERS) {
      expect(tierRank(tier)).toBeDefined();
      expect(tierRank(tier)).toBeLessThanOrEqual(tierRank('private'));
    }
  });

  test('private is the highest tier in the tier rank, so a new tier forces the redemption rule to be revisited', () => {
    const highest = Math.max(...Object.values(TIER_RANK));
    expect(TIER_RANK.private).toBe(highest);
    expect(Object.keys(TIER_RANK).filter((tier) => TIER_RANK[tier] === highest)).toEqual(['private']);
  });
});

describe('malformedExpiryLogFields', () => {
  test('describes a string value', () => {
    expect(malformedExpiryLogFields('paid', 'next tuesday')).toEqual({
      field: 'tierExpiresAt',
      storedTier: 'paid',
      valueType: 'string',
      value: 'next tuesday'
    });
  });

  test('describes a number by its JSON text', () => {
    expect(malformedExpiryLogFields('paid', 1767225600)).toEqual({
      field: 'tierExpiresAt',
      storedTier: 'paid',
      valueType: 'number',
      value: '1767225600'
    });
  });

  test('describes a boolean', () => {
    const fields = malformedExpiryLogFields('paid', true);
    expect(fields.valueType).toBe('boolean');
    expect(fields.value).toBe('true');
  });

  test('describes an object by its JSON text', () => {
    const fields = malformedExpiryLogFields('paid', { a: 1 });
    expect(fields.valueType).toBe('object');
    expect(fields.value).toBe('{"a":1}');
  });

  test('describes an array as "array"', () => {
    const fields = malformedExpiryLogFields('paid', [1, 2]);
    expect(fields.valueType).toBe('array');
    expect(fields.value).toBe('[1,2]');
  });

  test('cuts a long string value to 40 characters', () => {
    const fields = malformedExpiryLogFields('paid', 'x'.repeat(100));
    expect(fields.value).toBe('x'.repeat(40));
  });

  test('keeps a string value of exactly 40 characters', () => {
    const fields = malformedExpiryLogFields('paid', 'y'.repeat(40));
    expect(fields.value).toBe('y'.repeat(40));
  });

  test('cuts long JSON text to 40 characters', () => {
    const fields = malformedExpiryLogFields('paid', { note: 'z'.repeat(100) });
    expect(fields.valueType).toBe('object');
    expect(fields.value).toHaveLength(40);
    expect(fields.value.startsWith('{"note":"zzz')).toBe(true);
  });

  test('cuts the stored tier to 20 characters', () => {
    const fields = malformedExpiryLogFields('t'.repeat(50), 'bad');
    expect(fields.storedTier).toBe('t'.repeat(20));
  });

  test('keeps a stored tier of exactly 20 characters', () => {
    const fields = malformedExpiryLogFields('s'.repeat(20), 'bad');
    expect(fields.storedTier).toBe('s'.repeat(20));
  });

  test('returns the stored tier as a string even when the record has none', () => {
    expect(typeof malformedExpiryLogFields(undefined, 'bad').storedTier).toBe('string');
  });

  test('reports [unserializable] for a circular object', () => {
    const circular = {};
    circular.self = circular;
    const fields = malformedExpiryLogFields('paid', circular);
    expect(fields.valueType).toBe('object');
    expect(fields.value).toBe('[unserializable]');
  });

  test('reports [unserializable] for a bigint', () => {
    const fields = malformedExpiryLogFields('paid', 10n);
    expect(fields.valueType).toBe('bigint');
    expect(fields.value).toBe('[unserializable]');
  });

  test('uses the field argument, defaulting to tierExpiresAt', () => {
    expect(malformedExpiryLogFields('paid', 'bad').field).toBe('tierExpiresAt');
    expect(malformedExpiryLogFields('paid', 'bad', 'fallbackExpiresAt').field).toBe('fallbackExpiresAt');
  });

  test('returns exactly the four log fields', () => {
    expect(Object.keys(malformedExpiryLogFields('paid', 'bad')).sort()).toEqual(
      ['field', 'storedTier', 'value', 'valueType']
    );
  });
});
