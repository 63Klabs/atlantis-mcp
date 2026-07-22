/**
 * Unit tests for window-calculator utility
 *
 * Validates that window boundary computation and session key hashing
 * match the Read Lambda's rate limiter algorithms exactly.
 */

'use strict';

const crypto = require('crypto');
const { computeWindowBoundaries, computeSessionKey, TestHarness } = require('../../utils/window-calculator');

const {
	nextIntervalInMinutes,
	convertFromMinutesToMilli,
	convertFromMilliToMinutes
} = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  convertFromMinutesToMilli                                         */
/* ------------------------------------------------------------------ */

describe('convertFromMinutesToMilli', () => {
	test('converts 1 minute to 60000 milliseconds', () => {
		expect(convertFromMinutesToMilli(1)).toBe(60000);
	});

	test('converts 60 minutes to 3600000 milliseconds', () => {
		expect(convertFromMinutesToMilli(60)).toBe(3600000);
	});

	test('converts 1440 minutes to 86400000 milliseconds', () => {
		expect(convertFromMinutesToMilli(1440)).toBe(86400000);
	});

	test('converts 0 minutes to 0 milliseconds', () => {
		expect(convertFromMinutesToMilli(0)).toBe(0);
	});
});

/* ------------------------------------------------------------------ */
/*  convertFromMilliToMinutes                                         */
/* ------------------------------------------------------------------ */

describe('convertFromMilliToMinutes', () => {
	test('converts 60000 milliseconds to 1 minute', () => {
		expect(convertFromMilliToMinutes(60000)).toBe(1);
	});

	test('rounds up partial minutes', () => {
		expect(convertFromMilliToMinutes(60001)).toBe(2);
	});

	test('converts exact 5 minutes', () => {
		expect(convertFromMilliToMinutes(300000)).toBe(5);
	});

	test('converts 0 milliseconds to 0 minutes', () => {
		expect(convertFromMilliToMinutes(0)).toBe(0);
	});
});

/* ------------------------------------------------------------------ */
/*  nextIntervalInMinutes                                             */
/* ------------------------------------------------------------------ */

describe('nextIntervalInMinutes', () => {
	test('returns a value strictly in the future', () => {
		const nowMinutes = convertFromMilliToMinutes(Date.now());
		const result = nextIntervalInMinutes(60);
		expect(result).toBeGreaterThanOrEqual(nowMinutes);
	});

	test('result is evenly divisible by the interval', () => {
		const result60 = nextIntervalInMinutes(60);
		expect(result60 % 60).toBe(0);

		const result1440 = nextIntervalInMinutes(1440);
		expect(result1440 % 1440).toBe(0);
	});

	test('result minus interval gives a valid window start', () => {
		const interval = 60;
		const reset = nextIntervalInMinutes(interval);
		const windowStart = reset - interval;
		expect(windowStart).toBeGreaterThan(0);
		expect(windowStart % interval).toBe(0);
	});
});

/* ------------------------------------------------------------------ */
/*  computeWindowBoundaries                                           */
/* ------------------------------------------------------------------ */

describe('computeWindowBoundaries', () => {
	test('returns windowStartMinutes and resetTimeMinutes', () => {
		const result = computeWindowBoundaries(60);
		expect(result).toHaveProperty('windowStartMinutes');
		expect(result).toHaveProperty('resetTimeMinutes');
	});

	test('resetTimeMinutes - windowStartMinutes equals windowInMinutes', () => {
		const result60 = computeWindowBoundaries(60);
		expect(result60.resetTimeMinutes - result60.windowStartMinutes).toBe(60);

		const result1440 = computeWindowBoundaries(1440);
		expect(result1440.resetTimeMinutes - result1440.windowStartMinutes).toBe(1440);
	});

	test('resetTimeMinutes is aligned to the interval', () => {
		const result = computeWindowBoundaries(60);
		expect(result.resetTimeMinutes % 60).toBe(0);
	});

	test('windowStartMinutes is aligned to the interval', () => {
		const result = computeWindowBoundaries(60);
		expect(result.windowStartMinutes % 60).toBe(0);
	});

	test('windowStartMinutes is in the past or present', () => {
		const nowMinutes = Math.floor(Date.now() / (60 * 1000));
		const result = computeWindowBoundaries(60);
		expect(result.windowStartMinutes).toBeLessThanOrEqual(nowMinutes + 1);
	});
});

/* ------------------------------------------------------------------ */
/*  computeSessionKey                                                 */
/* ------------------------------------------------------------------ */

describe('computeSessionKey', () => {
	test('produces a 64-character hex string', () => {
		const result = computeSessionKey('abc-123', 29340, 'test-salt');
		expect(result).toMatch(/^[0-9a-f]{64}$/);
	});

	test('is deterministic — same inputs produce same output', () => {
		const a = computeSessionKey('user-sub', 12345, 'salt');
		const b = computeSessionKey('user-sub', 12345, 'salt');
		expect(a).toBe(b);
	});

	test('different cognitoSub produces different hash', () => {
		const a = computeSessionKey('user-a', 12345, 'salt');
		const b = computeSessionKey('user-b', 12345, 'salt');
		expect(a).not.toBe(b);
	});

	test('different windowStartMinutes produces different hash', () => {
		const a = computeSessionKey('user-sub', 12345, 'salt');
		const b = computeSessionKey('user-sub', 12346, 'salt');
		expect(a).not.toBe(b);
	});

	test('different salt produces different hash', () => {
		const a = computeSessionKey('user-sub', 12345, 'salt-a');
		const b = computeSessionKey('user-sub', 12345, 'salt-b');
		expect(a).not.toBe(b);
	});

	test('matches Read Lambda hashClientIdentifier algorithm exactly', () => {
		// Replicate the Read Lambda's hashClientIdentifier inline
		const cognitoSub = 'test-cognito-sub-uuid';
		const windowStart = 29340;
		const salt = 'my-secret-session-salt';

		const expected = crypto
			.createHash('sha256')
			.update(`${cognitoSub}${windowStart}${salt}`)
			.digest('hex');

		const actual = computeSessionKey(cognitoSub, windowStart, salt);
		expect(actual).toBe(expected);
	});
});
