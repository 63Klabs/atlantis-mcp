/**
 * Unit tests for the Auth function's status definitions
 *
 * Tests utils/status-codes.js:
 * - USER_NOT_FOUND_STATUS is 422
 * - UNKNOWN_ROUTE_STATUS is 400
 * - Neither is 403 or 404
 *
 * >! CloudFront rewrites every origin response with status 403 or 404 to /index.html with
 * >! status 200, so no status the Auth function chooses may be one of those two.
 * >! The literals 422 and 400 are written out in this file ON PURPOSE, and only here: every
 * >! other test imports the constants, so this file is the one place that pins the numbers.
 *
 * @module tests/unit/status-codes
 */
'use strict';

const { USER_NOT_FOUND_STATUS, UNKNOWN_ROUTE_STATUS } = require('../../utils/status-codes');

/** Statuses the Edge rewrites to the landing page. */
const REWRITTEN_STATUSES = [403, 404];

describe('Auth function status definitions', () => {
	it('USER_NOT_FOUND_STATUS is 422', () => {
		expect(USER_NOT_FOUND_STATUS).toBe(422);
	});

	it('UNKNOWN_ROUTE_STATUS is 400', () => {
		expect(UNKNOWN_ROUTE_STATUS).toBe(400);
	});

	it.each([
		['USER_NOT_FOUND_STATUS', USER_NOT_FOUND_STATUS],
		['UNKNOWN_ROUTE_STATUS', UNKNOWN_ROUTE_STATUS]
	])('%s is neither 403 nor 404', (_name, status) => {
		// >! 403 and 404 become index.html with HTTP 200 at the Edge
		expect(REWRITTEN_STATUSES).not.toContain(status);
	});
});
