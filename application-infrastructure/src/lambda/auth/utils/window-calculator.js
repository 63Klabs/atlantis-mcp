/**
 * Window Calculator Utility for Auth Lambda
 *
 * Provides interval-aligned window boundary computation and session
 * partition key hashing. These functions replicate the exact algorithms
 * used by the Read Lambda's rate limiter (`utils/rate-limiter.js`) so
 * that the Auth Lambda can look up the correct Sessions Table record
 * for a given user and window.
 *
 * @module utils/window-calculator
 */

'use strict';

const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/*  Conversion Helpers (private, same as Read Lambda)                 */
/* ------------------------------------------------------------------ */

/**
 * Convert minutes to milliseconds.
 *
 * @private
 * @param {number} minutes - Value in minutes
 * @returns {number} Equivalent value in milliseconds
 * @example
 * // In tests only via TestHarness
 * const { convertFromMinutesToMilli } = TestHarness.getInternals();
 * convertFromMinutesToMilli(5); // 300000
 */
function convertFromMinutesToMilli(minutes) {
	return minutes * 60 * 1000;
}

/**
 * Convert milliseconds to minutes, rounding up to the nearest minute.
 *
 * @private
 * @param {number} milliSeconds - Value in milliseconds
 * @returns {number} Equivalent value in minutes (rounded up)
 * @example
 * // In tests only via TestHarness
 * const { convertFromMilliToMinutes } = TestHarness.getInternals();
 * convertFromMilliToMinutes(300000); // 5
 * convertFromMilliToMinutes(300001); // 6
 */
function convertFromMilliToMinutes(milliSeconds) {
	return Math.ceil(milliSeconds / (60 * 1000));
}

/* ------------------------------------------------------------------ */
/*  Window Boundary Computation                                       */
/* ------------------------------------------------------------------ */

/**
 * Compute the next window reset time aligned to clock boundaries in Etc/UTC.
 *
 * This is the same algorithm as the Read Lambda's `nextIntervalInMinutes`.
 * The result is always strictly in the future and evenly divisible by
 * `intervalInMinutes` when measured as minutes since midnight Etc/UTC.
 *
 * @private
 * @param {number} intervalInMinutes - Window size (e.g. 60, 1440)
 * @returns {number} Next reset time in minutes since epoch
 * @example
 * // In tests only via TestHarness
 * const { nextIntervalInMinutes } = TestHarness.getInternals();
 * const resetMinutes = nextIntervalInMinutes(60); // next top-of-hour
 */
function nextIntervalInMinutes(intervalInMinutes) {
	let timestampInMinutes = convertFromMilliToMinutes(Date.now());
	let date = new Date(convertFromMinutesToMilli(timestampInMinutes));
	let coeff = convertFromMinutesToMilli(intervalInMinutes);
	let rounded = new Date(Math.ceil(date.getTime() / coeff) * coeff);
	let nextInMinutes = convertFromMilliToMinutes(rounded.getTime());
	return nextInMinutes;
}

/**
 * Compute the current window boundaries for a given window size.
 *
 * Uses interval-aligned logic from midnight UTC, matching the Read
 * Lambda's rate limiter algorithm exactly. The window start is the
 * beginning of the current interval, and the reset time is the end.
 *
 * @param {number} windowInMinutes - Window duration in minutes (e.g. 60, 1440)
 * @returns {{windowStartMinutes: number, resetTimeMinutes: number}} Window boundaries in minutes since epoch
 * @example
 * const { computeWindowBoundaries } = require('./utils/window-calculator');
 * const { windowStartMinutes, resetTimeMinutes } = computeWindowBoundaries(60);
 * // windowStartMinutes: start of current 60-minute window
 * // resetTimeMinutes: end of current 60-minute window (next boundary)
 */
function computeWindowBoundaries(windowInMinutes) {
	const resetTimeMinutes = nextIntervalInMinutes(windowInMinutes);
	const windowStartMinutes = resetTimeMinutes - windowInMinutes;
	return { windowStartMinutes, resetTimeMinutes };
}

/* ------------------------------------------------------------------ */
/*  Session Key Computation                                           */
/* ------------------------------------------------------------------ */

/**
 * Compute the Sessions Table partition key for a given user and window.
 *
 * Uses SHA-256 hash of `cognitoSub + windowStartMinutes + salt`, matching
 * the Read Lambda's `hashClientIdentifier` function exactly. This ensures
 * the Auth Lambda can look up the correct session record.
 *
 * @param {string} cognitoSub - The Cognito user's `sub` claim
 * @param {number} windowStartMinutes - Current window start in minutes since epoch
 * @param {string} salt - Secret salt from `Mcp_SessionHashSalt` SSM parameter
 * @returns {string} 64-character hex SHA-256 hash (Sessions Table partition key)
 * @example
 * const { computeSessionKey } = require('./utils/window-calculator');
 * const pk = computeSessionKey('abc-123-def', 29340, 'my-secret-salt');
 * // pk: '3f2a...' (64 hex chars)
 */
function computeSessionKey(cognitoSub, windowStartMinutes, salt) {
	// >! Use crypto.createHash for SHA-256 — same algorithm as Read Lambda's hashClientIdentifier
	return crypto
		.createHash('sha256')
		.update(`${cognitoSub}${windowStartMinutes}${salt}`)
		.digest('hex');
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal functions for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{computeWindowBoundaries: Function, computeSessionKey: Function, nextIntervalInMinutes: Function, convertFromMinutesToMilli: Function, convertFromMilliToMinutes: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../utils/window-calculator');
	 * const { computeWindowBoundaries, computeSessionKey, nextIntervalInMinutes } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			computeWindowBoundaries,
			computeSessionKey,
			nextIntervalInMinutes,
			convertFromMinutesToMilli,
			convertFromMilliToMinutes
		};
	}
}

module.exports = {
	computeWindowBoundaries,
	computeSessionKey,
	TestHarness
};
