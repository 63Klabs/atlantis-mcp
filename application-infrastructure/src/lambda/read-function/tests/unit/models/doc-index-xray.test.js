'use strict';

/**
 * Enabled-path / disabled-path unit tests for X-Ray instrumentation of
 * `models/doc-index.js`'s `getDocClient()` (spec 0-0-6-xray-downstream-tracing, task 5.1).
 *
 * Verifies the wrap ordering from design Finding 3: `captureClient()` wraps the RAW
 * `DynamoDBClient`, and `DynamoDBDocumentClient.from()` is called with the WRAPPED client
 * (not the raw one) — mirroring `@63klabs/cache-data`'s `AWS.classes.js`. Also confirms
 * `marshallOptions` is passed unchanged and that the existing `setDocClient()` test seam
 * still bypasses construction entirely (Requirement 7.3).
 *
 * The gate is read at module load, so every test sets `process.env` BEFORE `require()`ing
 * the module under test and calls `jest.resetModules()` between cases.
 *
 * **Validates: Requirements 9.1, 9.2, 7.3**
 *
 * @module tests/unit/models/doc-index-xray
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
 * Mocks `@63klabs/cache-data` (DebugAndLog only — sufficient for doc-index.js's needs)
 * and `../../config` so `require('../../models/doc-index')` succeeds without pulling in
 * the rest of the application config surface.
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
	jest.doMock('../../../config', () => ({
		Config: { settings: jest.fn(() => ({ docIndexTable: 'test-doc-index-table' })) }
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
 * @returns {{constructedRawClients: Array<object>, fromCalls: Array<Array<*>>}} Test doubles.
 */
function mockDynamoSdk() {
	const constructedRawClients = [];
	jest.doMock('@aws-sdk/client-dynamodb', () => {
		// >! Spread the actual module so command classes (e.g. GetItemCommand) that
		// >! @aws-sdk/lib-dynamodb's GetCommand constructs against remain available;
		// >! only DynamoDBClient itself needs to be a spy here.
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

describe('doc-index.js X-Ray instrumentation', () => {
	it('enabled: wraps the RAW DynamoDBClient, and from() receives the wrapped client', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		const { constructedRawClients, fromCalls } = mockDynamoSdk();

		const DocIndex = require('../../../models/doc-index');
		// getDocClient() is not exported directly; drive construction via a public function.
		DocIndex.TestHarness.resetClient();
		// getActiveVersion() calls getDocClient() internally; use the internal function via
		// the module's exported query surface is unnecessary — call the private getter by
		// exercising a public function that constructs the client on first use.
		return DocIndex.getActiveVersion('test-doc-index-table').then(() => {
			expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
			expect(captureAWSv3Client).toHaveBeenCalledWith(constructedRawClients[0]);

			expect(fromCalls).toHaveLength(1);
			const [clientArg, optionsArg] = fromCalls[0];
			// >! from() must receive the WRAPPED client, not the raw one.
			expect(clientArg).toEqual({ ...constructedRawClients[0], __wrapped: true });
			expect(clientArg).not.toBe(constructedRawClients[0]);
			// marshallOptions preserved unchanged.
			expect(optionsArg).toEqual({ marshallOptions: { removeUndefinedValues: true } });
		});
	});

	it('disabled: does not call captureAWSv3Client, and from() receives the raw client', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		const { constructedRawClients, fromCalls } = mockDynamoSdk();

		const DocIndex = require('../../../models/doc-index');
		DocIndex.TestHarness.resetClient();
		return DocIndex.getActiveVersion('test-doc-index-table').then(() => {
			expect(captureAWSv3Client).not.toHaveBeenCalled();

			expect(fromCalls).toHaveLength(1);
			const [clientArg, optionsArg] = fromCalls[0];
			expect(clientArg).toBe(constructedRawClients[0]);
			expect(optionsArg).toEqual({ marshallOptions: { removeUndefinedValues: true } });
		});
	});

	it('setDocClient() seam still bypasses construction entirely (Requirement 7.3)', async () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		mockCommonDependencies();
		const captureAWSv3Client = mockXraySdk();
		mockDynamoSdk();

		const DocIndex = require('../../../models/doc-index');
		const injectedClient = { send: jest.fn().mockResolvedValue({ Item: { version: 'v9' } }) };
		DocIndex.setDocClient(injectedClient);

		const version = await DocIndex.getActiveVersion('test-doc-index-table');

		expect(version).toBe('v9');
		expect(injectedClient.send).toHaveBeenCalledTimes(1);
		// >! Construction (and therefore captureClient()) never runs when a double is injected.
		expect(captureAWSv3Client).not.toHaveBeenCalled();

		DocIndex.TestHarness.resetClient();
	});
});
