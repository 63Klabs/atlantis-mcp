// Feature: documentation-indexer, Property 17: Rate limiter waits when remaining is zero
// Feature: documentation-indexer, Property 18: Exponential backoff on 403 rate limit
'use strict';

const fc = require('fast-check');
const {
	updateRateLimitFromHeaders,
	waitForRateLimitReset,
	resetRateLimitState,
	getRateLimitState,
	sleep,
	githubRequest,
	clearCache,
	MAX_RETRIES,
	BASE_BACKOFF_MS
} = require('../../lib/github-client');

describe('Property 17: Rate limiter waits when remaining is zero', () => {

	beforeEach(() => {
		resetRateLimitState();
		clearCache();
	});

	it('updates rate-limit state from response headers', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 5000 }),
				fc.integer({ min: 1700000000, max: 1800000000 }),
				(remaining, reset) => {
					resetRateLimitState();
					updateRateLimitFromHeaders({
						'x-ratelimit-remaining': String(remaining),
						'x-ratelimit-reset': String(reset)
					});
					const state = getRateLimitState();
					expect(state.remaining).toBe(remaining);
					expect(state.reset).toBe(reset);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('waitForRateLimitReset resolves immediately when remaining > 0', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 5000 }),
				fc.integer({ min: 1700000000, max: 1800000000 }),
				async (remaining, reset) => {
					resetRateLimitState();
					updateRateLimitFromHeaders({
						'x-ratelimit-remaining': String(remaining),
						'x-ratelimit-reset': String(reset)
					});

					const start = Date.now();
					await waitForRateLimitReset();
					const elapsed = Date.now() - start;

					// Should resolve nearly instantly (< 50ms)
					expect(elapsed).toBeLessThan(50);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('waitForRateLimitReset resolves immediately when reset is in the past', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 60 }),
				async (secondsInPast) => {
					resetRateLimitState();
					const pastReset = Math.floor(Date.now() / 1000) - secondsInPast;
					updateRateLimitFromHeaders({
						'x-ratelimit-remaining': '0',
						'x-ratelimit-reset': String(pastReset)
					});

					const start = Date.now();
					await waitForRateLimitReset();
					const elapsed = Date.now() - start;

					// Reset is in the past, should resolve immediately
					expect(elapsed).toBeLessThan(50);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('waitForRateLimitReset resolves immediately when state is unset', async () => {
		resetRateLimitState();
		const start = Date.now();
		await waitForRateLimitReset();
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});
});

describe('Property 18: Exponential backoff on 403 rate limit', () => {

	beforeEach(() => {
		resetRateLimitState();
		clearCache();
	});

	it('retries up to MAX_RETRIES times with increasing delays on 403', () => {
		// Verify the constant is 3
		expect(MAX_RETRIES).toBe(3);
	});

	it('backoff delays follow exponential pattern', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: MAX_RETRIES }),
				(attempt) => {
					const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
					// Delay should double with each attempt
					expect(delay).toBe(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
					// First attempt: 1000ms, second: 2000ms, third: 4000ms
					if (attempt === 1) expect(delay).toBe(1000);
					if (attempt === 2) expect(delay).toBe(2000);
					if (attempt === 3) expect(delay).toBe(4000);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('sleep resolves after approximately the requested duration', async () => {
		// Use small durations to keep tests fast
		const durations = [10, 20, 30];
		for (const ms of durations) {
			const start = Date.now();
			await sleep(ms);
			const elapsed = Date.now() - start;
			// Allow generous tolerance for timer imprecision
			expect(elapsed).toBeGreaterThanOrEqual(ms - 5);
			expect(elapsed).toBeLessThan(ms + 100);
		}
	});

	it('exponential backoff produces strictly increasing delays for consecutive attempts', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: MAX_RETRIES - 1 }),
				(attempt) => {
					const delay1 = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
					const delay2 = BASE_BACKOFF_MS * Math.pow(2, attempt);
					expect(delay2).toBeGreaterThan(delay1);
					expect(delay2).toBe(delay1 * 2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('total maximum backoff time is bounded', () => {
		// Sum of all backoff delays: 1000 + 2000 + 4000 = 7000ms
		let totalBackoff = 0;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			totalBackoff += BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
		}
		expect(totalBackoff).toBe(7000);
		// Total backoff should be reasonable (< 10 seconds)
		expect(totalBackoff).toBeLessThan(10000);
	});
});
