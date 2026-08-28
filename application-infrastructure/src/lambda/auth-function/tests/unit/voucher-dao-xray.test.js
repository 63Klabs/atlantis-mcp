'use strict';

/**
 * Enabled-path / disabled-path unit tests for X-Ray instrumentation of
 * `models/voucher.js`'s `getDocClient()` (spec 0-0-6-xray-downstream-tracing, task 7.4).
 *
 * Verifies the wrap ordering from design Finding 3: `captureClient()` wraps the RAW
 * `DynamoDBClient`, and `DynamoDBDocumentClient.from()` is called with the WRAPPED client
 * (not the raw one) — mirroring `@63klabs/cache-data`'s `AWS.classes.js`. Also confirms
 * `from()` is called with a SINGLE argument (no `marshallOptions`), preserving voucher.js's
 * original behavior across the lazy-getter conversion (tasks 7.2/7.3), and that the
 * existing `setDocClient()` test seam still bypasses construction entirely
 * (Requirement 7.3).
 *
 * The gate is read at module load (in `utils/xray-capture.js`), so every test sets
 * `process.env` BEFORE `require()`ing the module under test and calls `jest.resetModules()`
 * between cases.
 *
 * **Validates: Requirements 9.1, 9.2, 7.3**
 *
 * @module tests/unit/voucher-dao-xray
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
	jest.resetModules();
	process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
	process.env = ORIGINAL_ENV;
	jest.restoreAllMocks();
});

/**
 * Mocks `@63klabs/cache-data` (DebugAndLog only — sufficient for voucher.js's needs) and
 * `../../config` so `require('../../models/voucher')` succeeds without pulling in the rest
 * of the application config surface (AppConfig, settings, validations, connections).
 *
 * @returns {void}
 */
function mockCommonDependencies() {
	jest.doMock('@63klabs/cache-data', () => ({
		tools: {
			DebugAndLog: {
				debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
			}
		}
	}));
	jest.doMock('../../config', () => ({
		Config: {
			settings: jest.fn(() => ({
				usersTable: 'test-users-table',
				sessionsTable: 'test-sessions-table'
			}))
		}
	}));
}

/**
 * Mocks `aws-xray-sdk-core` so `captureAWSv3Client` is a spy that returns a distinguishable
 * wrapped stand-in object, letting tests assert both the input (raw client) and that the
 * wrapped output — not the raw client — is what flows into `DynamoDBDocumentClient.from()`.
 *
 * @returns {jest.Mock} The `captureAWSv3Client` mock, for assertions.
 */
function mockXraySdk() {
	const captureAWSv3Client = jest.fn((client) => ({ ...client, __wrapped: true }));
	jest.doMock('aws-xray-sdk-core', () => ({ captureAWSv3Client }));
	return captureAWSv3Client;
}

/**
 * Mocks `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`, recording the raw client
 * instances constructed and the arguments `DynamoDBDocumentClient.from()` was called with.
 *
 * >! Spreads the actual modules so command classes (e.g. GetItemCommand) that
 * >! @aws-sdk/lib-dynamodb's GetCommand/UpdateCommand construct against remain
 * >! available; only the constructor/factory under test is replaced with a spy.
 *
 * @returns {{constructedRawClients: Array<object>, fromCalls: Array<Array<*>>}} Test doubles.
 */
function mockDynamoSdk() {
	const constructedRawClients = [];
	jest.doMock('@aws-sdk/client-dynamodb', () => {
		const actual = jest.requireActual('@aws-sdk/client-dynamodb');
		return {
			...actual,
			DynamoDBClient: jest.fn().mockImplementation(() => {
				const instance = { __raw: true, id: constructedRawClients.length };
				constructedRawClients.push(instance);
				return instance;
			})
		};
	});

	const fromCalls = [];
	jest.doMock('@aws-sdk/lib-dynamodb', () => {
		const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
		return {
			...actual,
			DynamoDBDocumentClient: {
				from: jest.fn((...args) => {
					fromCalls.push(args);
					return { send: jest.fn(), ...args[0] };
				})
			}
		};
	});

	return { constructedRawClients, fromCalls };
}

describe('voucher.js X-Ray instrumentation', () => {
	it('enabled: wraps the RAW DynamoDBClient, and from() receives the wrapped client', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		const { constructedRawClients, fromCalls } = mockDynamoSdk();

		const VoucherDao = require('../../models/voucher');
		// getDocClient() is not exported directly; TestHarness.getInternals() drives
		// construction on first access.
		VoucherDao.TestHarness.getInternals();

		expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
		expect(captureAWSv3Client).toHaveBeenCalledWith(constructedRawClients[0]);

		expect(fromCalls).toHaveLength(1);
		// >! from() must receive the WRAPPED client, not the raw one.
		expect(fromCalls[0][0]).toEqual({ ...constructedRawClients[0], __wrapped: true });
		expect(fromCalls[0][0]).not.toBe(constructedRawClients[0]);
		// >! Single argument only — voucher.js's original DynamoDBDocumentClient.from(client)
		// >! call took no marshallOptions, and the lazy-getter conversion must not add any.
		expect(fromCalls[0]).toHaveLength(1);
	});

	it('disabled: does not call captureAWSv3Client, and from() receives the raw client', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		const { constructedRawClients, fromCalls } = mockDynamoSdk();

		const VoucherDao = require('../../models/voucher');
		VoucherDao.TestHarness.getInternals();

		expect(captureAWSv3Client).not.toHaveBeenCalled();

		expect(fromCalls).toHaveLength(1);
		expect(fromCalls[0][0]).toBe(constructedRawClients[0]);
		expect(fromCalls[0]).toHaveLength(1);
	});

	it('setDocClient() seam still bypasses construction entirely (Requirement 7.3)', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		mockDynamoSdk();

		const VoucherDao = require('../../models/voucher');
		const injectedClient = { send: jest.fn() };
		VoucherDao.setDocClient(injectedClient);

		const { docClient } = VoucherDao.TestHarness.getInternals();

		expect(docClient).toBe(injectedClient);
		// >! Construction (and therefore captureClient()) never runs when a double is injected.
		expect(captureAWSv3Client).not.toHaveBeenCalled();

		VoucherDao.setDocClient(null);
	});
});
