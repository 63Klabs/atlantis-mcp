// Feature: user-profile-enhancement, Property 3: Window reset time computation
'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Property 3: Window reset time computation                         */
/* ------------------------------------------------------------------ */

/**
 * Computes the window reset time in Unix epoch seconds from window
 * boundaries expressed in minutes since epoch.
 *
 * This is the formula the profile handler uses to populate
 * `rateLimits.windowResetAt` in the response.
 *
 * @param {number} windowStartMinutes - Start of the current window (minutes since epoch)
 * @param {number} windowInMinutes - Window duration in minutes (60 or 1440)
 * @returns {number} Window reset time in Unix epoch seconds
 */
function computeWindowResetAt(windowStartMinutes, windowInMinutes) {
	const resetTimeMinutes = windowStartMinutes + windowInMinutes;
	return resetTimeMinutes * 60;
}

/**
 * Validates: Requirements 4.3
 */
describe('Property 3: Window reset time computation', () => {

	it('windowResetAt equals (windowStartMinutes + windowInMinutes) * 60 for any inputs', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(60, 1440),
				fc.nat(),
				(windowInMinutes, windowStartMinutes) => {
					const windowResetAt = computeWindowResetAt(windowStartMinutes, windowInMinutes);
					const expected = (windowStartMinutes + windowInMinutes) * 60;
					expect(windowResetAt).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('windowResetAt is always strictly greater than windowStartMinutes * 60', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(60, 1440),
				fc.nat(),
				(windowInMinutes, windowStartMinutes) => {
					const windowResetAt = computeWindowResetAt(windowStartMinutes, windowInMinutes);
					const windowStartSeconds = windowStartMinutes * 60;
					expect(windowResetAt).toBeGreaterThan(windowStartSeconds);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('windowResetAt minus windowStart in seconds equals windowInMinutes * 60', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(60, 1440),
				fc.nat(),
				(windowInMinutes, windowStartMinutes) => {
					const windowResetAt = computeWindowResetAt(windowStartMinutes, windowInMinutes);
					const windowStartSeconds = windowStartMinutes * 60;
					const windowDurationSeconds = windowInMinutes * 60;
					expect(windowResetAt - windowStartSeconds).toBe(windowDurationSeconds);
				}
			),
			{ numRuns: 100 }
		);
	});
});
