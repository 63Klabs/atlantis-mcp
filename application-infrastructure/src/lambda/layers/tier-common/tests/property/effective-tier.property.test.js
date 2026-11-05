'use strict';
/**
 * Property tests for effective-tier.js (tier-common Lambda Layer).
 *
 * Purpose: Show that the parsing and tier rules hold across generated input,
 * not only for the table cases in the unit tests:
 *   Property 1: every accepted form parses to the expected instant, and the
 *               instant itself is `lapsed` while one millisecond earlier is `active`.
 *   Property 2: strings outside the grammar are `malformed`.
 *   Property 3: non-string values (other than null and undefined) are `malformed`.
 *   Property 4: the stored tier is returned for `none` and `active`, and only
 *               `registered` can come back unchanged for `lapsed` and `malformed`.
 *   Property 5: a 100,000-character input finishes in under 50 ms.
 *   Property 6: a returned `restoreTo` always names a tier above `registered` and
 *               below the stored tier, with a `none` or `active` end date.
 *
 * Setup: None. The module is pure; every case passes a fixed `nowMs`.
 * Every property uses { numRuns: 100 }. No test spawns a process.
 *
 * Written before the module exists (spec 0-0-7-lapsed-tier-downgrade, task 6.2),
 * so these tests fail with "Cannot find module" until task 6.3.
 *
 * Validates: Requirements 7.1 to 7.7, 8.1, 15.1, 19.4, 19.5.
 */

const fc = require('fast-check');
const {
  parseTierExpiry,
  computeEffectiveTier,
  tierRank
} = require('../../nodejs/effective-tier');

const NUM_RUNS = 100;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0, 0);
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A test-local statement of the grammar, used only to filter generated strings. */
const GRAMMAR = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

const pad = (value, width) => String(value).padStart(width, '0');

/* ------------------------------------------------------------------ */
/* Property 1: accepted forms                                          */
/* ------------------------------------------------------------------ */

/**
 * Generates `{ text, expectedMs }`: a string in one of the accepted forms and the
 * instant it names. The wall-clock fields are written from an instant shifted by
 * the offset, so the expected instant is the wall clock minus the offset.
 */
const acceptedFormArb = fc
  .record({
    date: fc.date({ min: new Date('1971-01-01T00:00:00.000Z'), max: new Date('2099-12-31T00:00:00.000Z') }),
    form: fc.constantFrom('date', 'minutes', 'seconds', 'frac1', 'frac2', 'frac3'),
    useZ: fc.boolean(),
    sign: fc.constantFrom(1, -1),
    offsetHours: fc.integer({ min: 0, max: 23 }),
    offsetMinutes: fc.integer({ min: 0, max: 59 })
  })
  .map(({ date, form, useZ, sign, offsetHours, offsetMinutes }) => {
    const offsetMs = form === 'date' || useZ ? 0 : sign * (offsetHours * 60 + offsetMinutes) * MINUTE_MS;
    const wall = new Date(date.getTime() + offsetMs);
    const year = wall.getUTCFullYear();
    const month = wall.getUTCMonth();
    const day = wall.getUTCDate();
    const hour = wall.getUTCHours();
    const minute = wall.getUTCMinutes();
    const second = wall.getUTCSeconds();
    const millis = wall.getUTCMilliseconds();
    const datePart = `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(day, 2)}`;
    const offsetText = useZ
      ? 'Z'
      : `${sign < 0 ? '-' : '+'}${pad(offsetHours, 2)}:${pad(offsetMinutes, 2)}`;
    const hhmm = `T${pad(hour, 2)}:${pad(minute, 2)}`;
    const hhmmss = `${hhmm}:${pad(second, 2)}`;
    const fractionDigits = pad(millis, 3);

    switch (form) {
      case 'date':
        return { text: datePart, expectedMs: Date.UTC(year, month, day) };
      case 'minutes':
        return { text: `${datePart}${hhmm}${offsetText}`, expectedMs: Date.UTC(year, month, day, hour, minute) - offsetMs };
      case 'seconds':
        return {
          text: `${datePart}${hhmmss}${offsetText}`,
          expectedMs: Date.UTC(year, month, day, hour, minute, second) - offsetMs
        };
      default: {
        const digits = Number(form.slice(4));
        const written = fractionDigits.slice(0, digits);
        const fractionMs = Number(written.padEnd(3, '0'));
        return {
          text: `${datePart}${hhmmss}.${written}${offsetText}`,
          expectedMs: Date.UTC(year, month, day, hour, minute, second, fractionMs) - offsetMs
        };
      }
    }
  });

describe('Property 1: every accepted form parses to the expected instant', () => {
  test('the instant is the wall clock minus the offset, and equals-now is lapsed', () => {
    fc.assert(
      fc.property(acceptedFormArb, ({ text, expectedMs }) => {
        const atInstant = parseTierExpiry(text, expectedMs);
        const justBefore = parseTierExpiry(text, expectedMs - 1);
        return (
          atInstant.state === 'lapsed' &&
          atInstant.expiresAtMs === expectedMs &&
          justBefore.state === 'active' &&
          justBefore.expiresAtMs === expectedMs
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('a form never longer than 29 characters is accepted', () => {
    fc.assert(
      fc.property(acceptedFormArb, ({ text, expectedMs }) => {
        return text.length <= 29 && parseTierExpiry(text, expectedMs - 1).state === 'active';
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ */
/* Property 2: strings outside the grammar                             */
/* ------------------------------------------------------------------ */

/** Applies one random edit to a valid form. */
const mutatedFormArb = fc
  .tuple(
    acceptedFormArb,
    fc.constantFrom('insert', 'delete', 'replace', 'prepend', 'append', 'lowerZ'),
    fc.nat(),
    fc.constantFrom(' ', 'x', '-', ':', '.', 'T', '/', '\n', '0')
  )
  .map(([{ text }, edit, position, character]) => {
    const at = position % (text.length + 1);
    switch (edit) {
      case 'insert':
        return text.slice(0, at) + character + text.slice(at);
      case 'delete':
        return text.slice(0, at) + text.slice(at + 1);
      case 'replace':
        return text.slice(0, at) + character + text.slice(at + 1);
      case 'prepend':
        return character + text;
      case 'append':
        return text + character;
      default:
        return text.replace('Z', 'z');
    }
  });

describe('Property 2: strings outside the grammar are malformed', () => {
  test('arbitrary strings that do not match the grammar', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }).filter((text) => !GRAMMAR.test(text)),
        (text) => {
          const result = parseTierExpiry(text, NOW);
          return result.state === 'malformed' && result.expiresAtMs === null;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test('arbitrary unicode strings that do not match the grammar', () => {
    fc.assert(
      fc.property(
        fc.fullUnicodeString({ maxLength: 40 }).filter((text) => !GRAMMAR.test(text)),
        (text) => parseTierExpiry(text, NOW).state === 'malformed'
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test('a valid form with one edit that leaves the grammar', () => {
    fc.assert(
      fc.property(
        mutatedFormArb.filter((text) => !GRAMMAR.test(text)),
        (text) => parseTierExpiry(text, NOW).state === 'malformed'
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test('any string longer than 29 characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 30, maxLength: 200 }), (text) => {
        return parseTierExpiry(text, NOW).state === 'malformed';
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('a valid form followed by padding that pushes it past 29 characters', () => {
    fc.assert(
      fc.property(acceptedFormArb, fc.integer({ min: 1, max: 60 }), ({ text }, count) => {
        const padded = text + ' '.repeat(Math.max(count, 30 - text.length));
        return parseTierExpiry(padded, NOW).state === 'malformed';
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('out-of-range fields in an otherwise well-formed string', () => {
    const outOfRangeArb = fc.oneof(
      fc.record({ month: fc.integer({ min: 13, max: 99 }), day: fc.integer({ min: 1, max: 28 }) }),
      fc.record({ month: fc.constant(0), day: fc.integer({ min: 1, max: 28 }) }),
      fc.record({ month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 32, max: 99 }) }),
      fc.record({ month: fc.integer({ min: 1, max: 12 }), day: fc.constant(0) })
    );
    fc.assert(
      fc.property(fc.integer({ min: 1971, max: 2099 }), outOfRangeArb, (year, { month, day }) => {
        const text = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
        return parseTierExpiry(text, NOW).state === 'malformed';
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ */
/* Property 3: non-string values                                       */
/* ------------------------------------------------------------------ */

describe('Property 3: non-string values are malformed', () => {
  test('numbers, booleans, objects, arrays, and bigints', () => {
    const nonStringArb = fc
      .oneof(
        fc.integer(),
        fc.double({ noNaN: false }),
        fc.boolean(),
        fc.bigInt(),
        fc.array(fc.string({ maxLength: 10 }), { maxLength: 3 }),
        fc.dictionary(fc.string({ maxLength: 5 }), fc.string({ maxLength: 5 }), { maxKeys: 3 }),
        fc.date()
      );
    fc.assert(
      fc.property(nonStringArb, (value) => {
        const result = parseTierExpiry(value, NOW);
        return result.state === 'malformed' && result.expiresAtMs === null;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('any generated value that is not a string, null, or undefined', () => {
    fc.assert(
      fc.property(
        fc.anything().filter((value) => value !== null && value !== undefined && typeof value !== 'string'),
        (value) => parseTierExpiry(value, NOW).state === 'malformed'
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ */
/* Property 4: the stored tier is returned for none and active         */
/* ------------------------------------------------------------------ */

/** A stored tier: the four known tiers, or an arbitrary string with no rank. */
const storedTierArb = fc.oneof(
  fc.constantFrom('public', 'registered', 'paid', 'private'),
  fc.string({ maxLength: 12 })
);

/** A generated `tierExpiresAt` with the state it must have at NOW. */
const expiryArb = fc.oneof(
  fc.constantFrom(null, undefined).map((value) => ({ value, expectedState: 'none' })),
  fc.integer({ min: 1, max: 5 * 365 * DAY_MS }).map((delta) => ({
    value: new Date(NOW + delta).toISOString(),
    expectedState: 'active'
  })),
  fc.integer({ min: 0, max: 5 * 365 * DAY_MS }).map((delta) => ({
    value: new Date(NOW - delta).toISOString(),
    expectedState: 'lapsed'
  })),
  fc.oneof(
    fc.integer(),
    fc.boolean(),
    fc.constantFrom('', 'soon', '2026-02-30', '2026-12-31T00:00:00', ' 2026-12-31'),
    fc.string({ minLength: 30, maxLength: 60 })
  ).map((value) => ({ value, expectedState: 'malformed' }))
);

/** A Fallback to hand to computeEffectiveTier: absent, or any tier and any kind of end date. */
const fallbackArb = fc.oneof(
  fc.constant(null),
  fc.record({
    tier: fc.oneof(fc.constantFrom('public', 'registered', 'paid', 'private'), fc.string({ maxLength: 8 })),
    tierExpiresAt: expiryArb.map(({ value }) => value)
  })
);

describe('Property 4: the stored tier survives only none and active', () => {
  test('none and active return the stored tier exactly, whatever the Fallback', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, fallbackArb, (storedTier, { value, expectedState }, fallback) => {
        const result = computeEffectiveTier(storedTier, value, NOW, fallback);
        if (result.state !== expectedState) {
          return false;
        }
        if (result.state === 'none' || result.state === 'active') {
          return result.tier === storedTier && result.restoreTo === null && result.fallbackState === null;
        }
        return true;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('lapsed and malformed never return a stored tier other than registered, unless a valid Fallback restores a lower one', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, fallbackArb, (storedTier, { value }, fallback) => {
        const result = computeEffectiveTier(storedTier, value, NOW, fallback);
        if (result.state !== 'lapsed' && result.state !== 'malformed') {
          return true;
        }
        if (result.restoreTo !== null) {
          return result.state === 'lapsed' && result.tier === result.restoreTo.tier && result.tier !== storedTier;
        }
        return result.tier === 'registered';
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('the instant is reported for every state except none and malformed', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, (storedTier, { value }) => {
        const result = computeEffectiveTier(storedTier, value, NOW);
        if (result.state === 'none' || result.state === 'malformed') {
          return result.expiresAtMs === null;
        }
        return typeof result.expiresAtMs === 'number';
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

/* ------------------------------------------------------------------ */
/* Property 5: bounded work on very long input                         */
/* ------------------------------------------------------------------ */

describe('Property 5: a 100,000-character input finishes in under 50 ms', () => {
  const LONG_LENGTH = 100000;
  const MAX_ELAPSED_MS = 50;

  /** Inputs that would make a backtracking expression slow. */
  const longInputs = [
    ['digits', '1'.repeat(LONG_LENGTH)],
    ['letters', 'a'.repeat(LONG_LENGTH)],
    ['a valid form with trailing spaces', '2030-12-31T10:30:45.123+05:30' + ' '.repeat(LONG_LENGTH - 29)],
    ['a valid prefix then a long fraction', '2030-12-31T10:30:45.' + '1'.repeat(LONG_LENGTH - 20)],
    ['a long run of dashes', '2030' + '-'.repeat(LONG_LENGTH - 4)],
    ['a long run of colons and plus signs', '2030-12-31T10:30' + ':+'.repeat((LONG_LENGTH - 16) / 2)]
  ];

  test.each(longInputs)('%s is malformed in under 50 ms', (_description, input) => {
    expect(input.length).toBe(LONG_LENGTH);
    // Warm up so JIT compilation is not counted
    parseTierExpiry('2030-12-31', NOW);

    const start = process.hrtime.bigint();
    const result = parseTierExpiry(input, NOW);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    expect(result).toEqual({ state: 'malformed', expiresAtMs: null });
    expect(elapsedMs).toBeLessThan(MAX_ELAPSED_MS);
  });

  test('generated strings of 100,000 characters are malformed in under 50 ms', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('0', '9', '-', ':', '.', 'Z', 'T', '+', ' ', 'a'),
        fc.constantFrom('2030-12-31T', '2030-12-31', '', '2030-12-31T10:30:45.'),
        (character, prefix) => {
          const input = prefix + character.repeat(LONG_LENGTH - prefix.length);
          const start = process.hrtime.bigint();
          const result = parseTierExpiry(input, NOW);
          const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
          return result.state === 'malformed' && elapsedMs < MAX_ELAPSED_MS;
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test('computeEffectiveTier on a 100,000-character end date is also fast', () => {
    const input = '9'.repeat(LONG_LENGTH);
    const start = process.hrtime.bigint();
    const result = computeEffectiveTier('paid', input, NOW, { tier: 'registered', tierExpiresAt: input });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(result.tier).toBe('registered');
    expect(elapsedMs).toBeLessThan(MAX_ELAPSED_MS);
  });
});

/* ------------------------------------------------------------------ */
/* Property 6: a restore is always a step down, never a promotion      */
/* ------------------------------------------------------------------ */

describe('Property 6: restoreTo names a tier between registered and the stored tier', () => {
  test('any returned restoreTo ranks above registered and below the stored tier, with a none or active end date', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, fallbackArb, (storedTier, { value }, fallback) => {
        const result = computeEffectiveTier(storedTier, value, NOW, fallback);
        if (result.restoreTo === null) {
          return true;
        }
        const restoreRank = tierRank(result.restoreTo.tier);
        const storedRank = tierRank(storedTier);
        return (
          result.state === 'lapsed' &&
          result.fallbackState === 'valid' &&
          result.tier === result.restoreTo.tier &&
          restoreRank !== undefined &&
          storedRank !== undefined &&
          restoreRank > tierRank('registered') &&
          restoreRank < storedRank &&
          (result.restoreTo.state === 'none' || result.restoreTo.state === 'active') &&
          (result.restoreTo.expiresAtMs === null || result.restoreTo.expiresAtMs > NOW)
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('a restore is returned exactly when a lapsed record holds a valid Fallback', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, fallbackArb, (storedTier, { value, expectedState }, fallback) => {
        const result = computeEffectiveTier(storedTier, value, NOW, fallback);

        // An oracle that restates Requirement 19.4 independently of the module
        let expectRestore = false;
        if (expectedState === 'lapsed' && fallback !== null) {
          const storedRank = tierRank(storedTier);
          const fallbackRank = tierRank(fallback.tier);
          const endState = parseTierExpiry(fallback.tierExpiresAt, NOW).state;
          expectRestore =
            storedRank !== undefined &&
            fallbackRank !== undefined &&
            fallbackRank > 1 &&
            fallbackRank < storedRank &&
            (endState === 'none' || endState === 'active');
        }

        return expectRestore ? result.restoreTo !== null : result.restoreTo === null;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('without a restore the effective tier of a lapsed record is registered', () => {
    fc.assert(
      fc.property(storedTierArb, expiryArb, fallbackArb, (storedTier, { value }, fallback) => {
        const result = computeEffectiveTier(storedTier, value, NOW, fallback);
        return result.state !== 'lapsed' || result.restoreTo !== null || result.tier === 'registered';
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
