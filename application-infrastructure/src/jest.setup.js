/**
 * Global Jest setup file to suppress console output during test runs.
 *
 * Lambda functions use console.log/info/warn/error for CloudWatch logging.
 * During tests (especially property-based tests with 100+ iterations), this
 * produces excessive noise that obscures pass/fail results.
 *
 * To re-enable console output for debugging, run tests with:
 *   VERBOSE_TESTS=true npm test
 *
 * Individual tests can still spy on console methods to assert logging behavior:
 *   const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
 *   // ... test code ...
 *   expect(spy).toHaveBeenCalledWith(...);
 */
'use strict';

if (!process.env.VERBOSE_TESTS) {
	const noop = () => {};
	jest.spyOn(console, 'log').mockImplementation(noop);
	jest.spyOn(console, 'info').mockImplementation(noop);
	jest.spyOn(console, 'warn').mockImplementation(noop);
	jest.spyOn(console, 'error').mockImplementation(noop);
	jest.spyOn(console, 'debug').mockImplementation(noop);
}
