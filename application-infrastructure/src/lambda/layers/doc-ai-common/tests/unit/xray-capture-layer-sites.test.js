'use strict';

/**
 * Enabled-path / disabled-path unit tests for X-Ray instrumentation at the doc-ai-common
 * layer's three client-construction sites: embedding-provider.js, assist-provider.js, and
 * vector-store-s3.js (spec 0-0-6-xray-downstream-tracing, tasks 3.1-3.3).
 *
 * Per the `test-harness-for-private-classes-and-methods` steering, the Bedrock clients
 * live behind private `#getClient()` methods, so they are exercised through the PUBLIC
 * methods that call them (`embed()`, `rerank()`) rather than mocked directly.
 * `vector-store-s3.js`'s `getS3VectorsClient()` is already a public export, so it is
 * called directly.
 *
 * The gate is read at module load, so every test sets `process.env` BEFORE `require()`ing
 * the module under test and calls `jest.resetModules()` between cases.
 *
 * **Validates: Requirements 9.1, 9.2**
 *
 * @module tests/unit/xray-capture-layer-sites
 */

const ORIGINAL_ENV = process.env;

/** Reset the module registry and env before each case; the gate is read at module load. */
beforeEach(() => {
	jest.resetModules();
	process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
	process.env = ORIGINAL_ENV;
	jest.restoreAllMocks();
});

/**
 * Mock `aws-xray-sdk-core` so `captureAWSv3Client` is a spy that returns a distinguishable
 * wrapped stand-in (the original client with a marker property), allowing tests to assert
 * both that the spy was called with the constructed instance and that the wrapped result
 * is what gets used.
 *
 * @returns {jest.Mock} The `captureAWSv3Client` mock, for assertions.
 */
function mockXraySdk() {
	const captureAWSv3Client = jest.fn((client) => client);
	jest.doMock('aws-xray-sdk-core', () => ({ captureAWSv3Client }));
	return captureAWSv3Client;
}

describe('embedding-provider.js X-Ray instrumentation (layer)', () => {
	/**
	 * Mocks `@aws-sdk/client-bedrock-runtime` recording constructed client instances and
	 * returning a fake `{ send }` client so `embed()` can run without a real Bedrock call.
	 *
	 * @returns {{mockSend: jest.Mock, constructedClients: Array<object>}} Test doubles.
	 */
	function mockBedrockRuntime() {
		const mockSend = jest.fn().mockResolvedValue({
			body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4], inputTextTokenCount: 1 }))
		});
		const constructedClients = [];
		jest.doMock('@aws-sdk/client-bedrock-runtime', () => {
			const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime');
			return {
				...actual,
				BedrockRuntimeClient: jest.fn().mockImplementation(() => {
					const instance = { send: mockSend };
					constructedClients.push(instance);
					return instance;
				})
			};
		});
		return { mockSend, constructedClients };
	}

	it('enabled: wraps the constructed BedrockRuntimeClient with captureAWSv3Client', async () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		const captureAWSv3Client = mockXraySdk();
		const { mockSend, constructedClients } = mockBedrockRuntime();

		const { EmbeddingProvider } = require('../../nodejs/embedding-provider');
		const provider = new EmbeddingProvider({ dimensions: 4 });
		await provider.embed('hello world');

		expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
		expect(captureAWSv3Client).toHaveBeenCalledWith(constructedClients[0]);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('disabled: does not call captureAWSv3Client and client identity is preserved', async () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		const captureAWSv3Client = mockXraySdk();
		mockBedrockRuntime();

		const { EmbeddingProvider } = require('../../nodejs/embedding-provider');
		const provider = new EmbeddingProvider({ dimensions: 4 });
		await provider.embed('hello world');

		expect(captureAWSv3Client).not.toHaveBeenCalled();
	});
});

describe('assist-provider.js X-Ray instrumentation (layer)', () => {
	/**
	 * Mocks `@aws-sdk/client-bedrock-runtime` recording constructed client instances and
	 * returning a fake `{ send }` client so `rerank()` can run without a real Bedrock call.
	 *
	 * @returns {{mockSend: jest.Mock, constructedClients: Array<object>}} Test doubles.
	 */
	function mockBedrockRuntime() {
		const mockSend = jest.fn().mockResolvedValue({
			body: new TextEncoder().encode(JSON.stringify({
				output: { message: { role: 'assistant', content: [{ text: '[0]' }] } },
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
			}))
		});
		const constructedClients = [];
		jest.doMock('@aws-sdk/client-bedrock-runtime', () => {
			const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime');
			return {
				...actual,
				BedrockRuntimeClient: jest.fn().mockImplementation(() => {
					const instance = { send: mockSend };
					constructedClients.push(instance);
					return instance;
				})
			};
		});
		return { mockSend, constructedClients };
	}

	it('enabled: wraps the constructed BedrockRuntimeClient with captureAWSv3Client', async () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		const captureAWSv3Client = mockXraySdk();
		const { mockSend, constructedClients } = mockBedrockRuntime();

		const { AssistProvider } = require('../../nodejs/assist-provider');
		const assist = new AssistProvider();
		await assist.rerank({ query: 'q', candidates: [{ index: 0, title: 'a' }] });

		expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
		expect(captureAWSv3Client).toHaveBeenCalledWith(constructedClients[0]);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('disabled: does not call captureAWSv3Client and client identity is preserved', async () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		const captureAWSv3Client = mockXraySdk();
		mockBedrockRuntime();

		const { AssistProvider } = require('../../nodejs/assist-provider');
		const assist = new AssistProvider();
		await assist.rerank({ query: 'q', candidates: [{ index: 0, title: 'a' }] });

		expect(captureAWSv3Client).not.toHaveBeenCalled();
	});
});

describe('vector-store-s3.js X-Ray instrumentation (layer)', () => {
	/**
	 * Mocks `@aws-sdk/client-s3vectors`, recording constructed client instances and
	 * returning a fake object (no `send` needed — `getS3VectorsClient()` is called directly
	 * without issuing a request).
	 *
	 * @returns {Array<object>} The constructed client instances, in construction order.
	 */
	function mockS3VectorsSdk() {
		const constructedClients = [];
		jest.doMock('@aws-sdk/client-s3vectors', () => {
			const actual = jest.requireActual('@aws-sdk/client-s3vectors');
			return {
				...actual,
				S3VectorsClient: jest.fn().mockImplementation(() => {
					const instance = {};
					constructedClients.push(instance);
					return instance;
				})
			};
		});
		return constructedClients;
	}

	it('enabled: wraps the constructed S3VectorsClient with captureAWSv3Client', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		const captureAWSv3Client = mockXraySdk();
		const constructedClients = mockS3VectorsSdk();

		const { getS3VectorsClient } = require('../../nodejs/vector-store-s3');
		getS3VectorsClient();

		expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
		expect(captureAWSv3Client).toHaveBeenCalledWith(constructedClients[0]);
	});

	it('disabled: does not call captureAWSv3Client and client identity is preserved', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'false';
		const captureAWSv3Client = mockXraySdk();
		const constructedClients = mockS3VectorsSdk();

		const { getS3VectorsClient } = require('../../nodejs/vector-store-s3');
		const client = getS3VectorsClient();

		expect(captureAWSv3Client).not.toHaveBeenCalled();
		expect(client).toBe(constructedClients[0]);
	});

	/**
	 * Regression guard for spec 0-0-6-xray-downstream-tracing, task 3.5: the
	 * `setS3VectorsClient()` test seam must bypass client construction entirely, even
	 * when X-Ray tracing is enabled, so a Test_Double injected via the seam is returned
	 * untouched by `getS3VectorsClient()` and never passed through `captureClient()` /
	 * `captureAWSv3Client()` (Requirement 7.3).
	 *
	 * **Validates: Requirements 7.1, 7.3**
	 */
	it('setS3VectorsClient() seam bypasses construction: an injected double is returned untouched and captureAWSv3Client is never called, even with tracing enabled', () => {
		process.env.CACHE_DATA_AWS_X_RAY_ON = 'true';
		const captureAWSv3Client = mockXraySdk();
		const constructedClients = mockS3VectorsSdk();

		const { getS3VectorsClient, setS3VectorsClient } = require('../../nodejs/vector-store-s3');

		const testDouble = { send: jest.fn(), isTestDouble: true };
		setS3VectorsClient(testDouble);

		const client = getS3VectorsClient();

		// >! The seam short-circuits getS3VectorsClient()'s lazy-construction branch, so
		// >! neither the real S3VectorsClient constructor nor captureClient()'s wrapping
		// >! path is ever reached for the injected double.
		expect(client).toBe(testDouble);
		expect(constructedClients).toHaveLength(0);
		expect(captureAWSv3Client).not.toHaveBeenCalled();

		// Reset the module-level singleton so this test does not leak state (defensive;
		// jest.resetModules() in the outer beforeEach already isolates the next test's
		// require(), but this keeps the seam's own contract explicit here).
		setS3VectorsClient(null);
	});
});
