/**
 * Property-based tests for the `captureClient()` X-Ray instrumentation helper (spec
 * 0-0-6-xray-downstream-tracing, design Correctness Properties 1 and 2).
 *
 * This is the read-function's copy of `utils/xray-capture.js`. Per design Option A
 * (Code-sharing decision), the helper is duplicated across four locations; each copy
 * independently satisfies the same contract, so these property tests are replicated
 * verbatim (aside from the require path) in each of the four packages.
 *
 * The gate (`CACHE_DATA_AWS_X_RAY_ON` / `CacheData_AWSXRayOn`) is read once at module
 * load, so every test sets `process.env` BEFORE `require()`ing the module under test and
 * calls `jest.resetModules()` between cases (test-execution-monitoring / design Testing
 * Strategy).
 *
 * @module tests/unit/xray-capture.property
 */

'use strict';

const fc = require('fast-check');

const HELPER_MODULE_PATH = '../../../utils/xray-capture';
const XRAY_SDK_MODULE_NAME = 'aws-xray-sdk-core';

describe('captureClient() property tests (read-function)', () => {
	const ORIGINAL_ENV = process.env;

	beforeEach(() => {
		// >! The gate is evaluated at module load, so env must be set before require() and
		// >! the registry reset between cases; otherwise a cached module leaks its gate state.
		jest.resetModules();
		process.env = { ...ORIGINAL_ENV };
	});

	afterEach(() => {
		process.env = ORIGINAL_ENV;
		jest.restoreAllMocks();
	});

	/**
	 * fast-check arbitrary generating client-shaped objects: a callable `send` plus
	 * randomized extra keys/values, and edge-case shapes (frozen, null-prototype, carrying
	 * a `middlewareStack` like a real AWS SDK v3 client).
	 *
	 * @returns {fc.Arbitrary<object>} An arbitrary producing client-shaped objects.
	 */
	function arbitraryClient() {
		return fc.oneof(
			fc.dictionary(fc.string(), fc.anything(), { maxKeys: 5 }).map((extra) => ({
				send: () => Promise.resolve({}),
				...extra
			})),
			fc.constant({ send: () => Promise.resolve({}), middlewareStack: { use: () => {} } }),
			fc.constant(Object.freeze({ send: () => Promise.resolve({}) })),
			fc.constant(Object.assign(Object.create(null), { send: () => Promise.resolve({}) }))
		);
	}

	// Feature: 0-0-6-xray-downstream-tracing — Property 1 (Disabled tracing preserves
	// client identity): for any client-shaped object, when the X-Ray gate is disabled,
	// captureClient() returns the identical object reference it was given.
	it('Property 1: returns the identical reference when tracing is disabled', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		delete process.env.CacheData_AWSXRayOn;
		const { captureClient } = require(HELPER_MODULE_PATH);

		fc.assert(
			fc.property(arbitraryClient(), (client) => {
				// >! Identity, not deep equality: only the same reference guarantees that test
				// >! doubles keep intercepting and that no downstream behavior can differ.
				expect(captureClient(client)).toBe(client);
			}),
			{ numRuns: 100, verbose: true }
		);
	});

	/**
	 * fast-check arbitrary over the X-Ray SDK failure modes exercised by Property 2.
	 *
	 * @returns {fc.Arbitrary<string>} An arbitrary producing one of the failure-mode names.
	 */
	function arbitraryFailureMode() {
		return fc.constantFrom(
			'require-throws',
			'capture-fn-absent',
			'capture-fn-throws',
			'capture-returns-null',
			'capture-returns-non-object'
		);
	}

	/**
	 * Mocks `aws-xray-sdk-core` to simulate the given failure mode.
	 *
	 * @param {string} mode - One of the values produced by {@link arbitraryFailureMode}.
	 * @returns {void}
	 */
	function mockXraySdkForFailureMode(mode) {
		switch (mode) {
			case 'require-throws':
				jest.doMock(XRAY_SDK_MODULE_NAME, () => {
					throw new Error('simulated module load failure');
				});
				break;
			case 'capture-fn-absent':
				jest.doMock(XRAY_SDK_MODULE_NAME, () => ({}));
				break;
			case 'capture-fn-throws':
				jest.doMock(XRAY_SDK_MODULE_NAME, () => ({
					captureAWSv3Client: () => { throw new Error('simulated capture failure'); }
				}));
				break;
			case 'capture-returns-null':
				jest.doMock(XRAY_SDK_MODULE_NAME, () => ({
					captureAWSv3Client: () => null
				}));
				break;
			case 'capture-returns-non-object':
				jest.doMock(XRAY_SDK_MODULE_NAME, () => ({
					captureAWSv3Client: () => 'not-an-object'
				}));
				break;
			default:
				throw new Error(`Unknown failure mode: ${mode}`);
		}
	}

	// Feature: 0-0-6-xray-downstream-tracing — Property 2 (Instrumentation never breaks the
	// caller): for any client-shaped object and for any X-Ray failure mode - the module
	// failing to load, captureAWSv3Client being absent, throwing, or returning null or a
	// non-object - captureClient() completes without throwing and returns an object
	// exposing a callable send().
	it('Property 2: never throws and always returns a client with a callable send(), across any failure mode', () => {
		fc.assert(
			fc.property(arbitraryClient(), arbitraryFailureMode(), (client, failureMode) => {
				jest.resetModules();
				process.env = { ...ORIGINAL_ENV, CACHE_DATA_AWS_X_RAY_ON: 'true' };
				delete process.env.CacheData_AWSXRayOn;
				mockXraySdkForFailureMode(failureMode);

				const { captureClient } = require(HELPER_MODULE_PATH);

				let result;
				expect(() => { result = captureClient(client); }).not.toThrow();
				expect(result).toBeTruthy();
				expect(typeof result).toBe('object');
				expect(typeof result.send).toBe('function');

				jest.dontMock(XRAY_SDK_MODULE_NAME);
			}),
			{ numRuns: 100, verbose: true }
		);
	});

	// Feature: 0-0-6-xray-downstream-tracing — Property 3 (Instrumentation is idempotent):
	// for any client-shaped object with the X-Ray gate enabled, applying captureClient()
	// twice yields the same result as applying it once: the second call does not throw
	// and does not apply a second capture wrapper.
	it('Property 3: applying captureClient() twice matches applying it once, with no re-wrap', () => {
		fc.assert(
			fc.property(arbitraryClient(), (client) => {
				jest.resetModules();
				process.env = { ...ORIGINAL_ENV, CACHE_DATA_AWS_X_RAY_ON: 'true' };
				delete process.env.CacheData_AWSXRayOn;

				// >! Mock a real-shaped captureAWSv3Client that wraps into a NEW object, so a
				// >! second, distinct wrapper application would be observable as a second call.
				const captureAWSv3Client = jest.fn((instance) => ({ ...instance, __xrayWrapped: true }));
				jest.doMock(XRAY_SDK_MODULE_NAME, () => ({ captureAWSv3Client }));

				const { captureClient } = require(HELPER_MODULE_PATH);

				let once;
				let twice;
				expect(() => { once = captureClient(client); }).not.toThrow();
				expect(() => { twice = captureClient(once); }).not.toThrow();

				// >! Idempotence: the second call detects the Symbol.for('atlantisMcp.xrayCaptured')
				// >! marker already present on `once` and returns it as-is, so captureAWSv3Client
				// >! is invoked at most once across the pair of calls - no duplicate subsegments.
				expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
				expect(twice).toBe(once);

				jest.dontMock(XRAY_SDK_MODULE_NAME);
			}),
			{ numRuns: 100, verbose: true }
		);
	});
});
