/**
 * Unit tests for the origin-protection guard in the Read Lambda handler.
 *
 * Spec: 0-0-7-rate-limit-client-ip-spoofing, Part B (Requirements 6.1 to 6.10, 10.5).
 *
 * The guard runs right after `new ClientRequest` / `new Response` and before
 * `AuthResolver.resolveAuth`, so a request that is not from the distribution reads no Users
 * record and writes no rate-limit counter. It applies only when
 * `CACHE_DATA_INGRESS_SECRET_NAME` is set; with the variable unset every request reports
 * ingress `direct` and `isIngressVerified()` is false, so an unconditional guard would
 * refuse all traffic.
 *
 * @module tests/unit/lambda/read-handler-ingress-guard
 */
'use strict';

const fc = require('fast-check');

const ENV_NAME = 'CACHE_DATA_INGRESS_SECRET_NAME';
const SECRET_NAME = 'acme-mcp-test-OriginSecret';
const HEADER_VALUE = 'header-value-that-must-never-be-echoed';
const CLIENT_ADDRESS = '203.0.113.77';

// Mock ClientRequest instance. isIngressVerified is set per test.
const mockClientRequestInstance = {
	getProps: jest.fn().mockReturnValue({ path: 'mcp/v1', method: 'POST' }),
	getClientIp: jest.fn().mockReturnValue('203.0.113.77'),
	isIngressVerified: jest.fn().mockReturnValue(true)
};

// Mock Response instance: records the refusal; finalize echoes what was set.
const mockResponseInstance = {
	addHeader: jest.fn().mockReturnThis(),
	setBody: jest.fn().mockReturnThis(),
	setStatusCode: jest.fn().mockReturnThis(),
	finalize: jest.fn()
};

const mockClientRequestConstructor = jest.fn().mockReturnValue(mockClientRequestInstance);
const mockResponseConstructor = jest.fn().mockReturnValue(mockResponseInstance);

jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		ClientRequest: mockClientRequestConstructor,
		Response: mockResponseConstructor,
		Timer: jest.fn().mockImplementation(() => ({
			isRunning: jest.fn().mockReturnValue(false),
			stop: jest.fn().mockReturnValue('timer stopped')
		})),
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('mock-salt-value')
		})),
		AWS: {
			dynamo: {
				get: jest.fn().mockResolvedValue({}),
				put: jest.fn().mockResolvedValue({}),
				update: jest.fn().mockResolvedValue({})
			}
		}
	}
}));

jest.mock('../../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: jest.fn().mockResolvedValue(undefined),
		prime: jest.fn().mockResolvedValue(undefined),
		settings: jest.fn(),
		getConnCacheProfile: jest.fn()
	}
}));
jest.mock('../../../routes');
jest.mock('../../../utils/rate-limiter', () => ({
	checkRateLimit: jest.fn(),
	createRateLimitResponse: jest.fn()
}));
jest.mock('../../../utils/auth-resolver', () => ({
	resolveAuth: jest.fn()
}));
jest.mock('../../../utils/error-handler');

const { Config } = require('../../../config');
const Routes = require('../../../routes');
const RateLimiter = require('../../../utils/rate-limiter');
const AuthResolver = require('../../../utils/auth-resolver');
const { handler } = require('../../../index');

const FINALIZED_OK = { statusCode: 200, headers: {}, body: '{"result":"success"}' };
const FINALIZED_REFUSAL = { statusCode: 401, headers: { 'Cache-Control': 'no-store' }, body: '{"message":"x"}' };

describe('Read Lambda handler: origin-protection guard', () => {
	let mockEvent;
	let mockContext;
	let savedEnv;

	/**
	 * Make Response.finalize answer a refusal when a 401 was set and a success otherwise,
	 * so the test sees which one the handler returned.
	 */
	function wireFinalize() {
		mockResponseInstance.finalize.mockImplementation(() => {
			const statusCalls = mockResponseInstance.setStatusCode.mock.calls;
			const last = statusCalls.length ? statusCalls[statusCalls.length - 1][0] : 200;
			return last === 401 ? FINALIZED_REFUSAL : FINALIZED_OK;
		});
	}

	/**
	 * Everything the handler wrote to the Response, serialized, for leak checks.
	 *
	 * @returns {string} JSON text of all recorded setStatusCode/addHeader/setBody calls
	 */
	function recordedResponseCalls() {
		return JSON.stringify([
			mockResponseInstance.setStatusCode.mock.calls,
			mockResponseInstance.addHeader.mock.calls,
			mockResponseInstance.setBody.mock.calls
		]);
	}

	beforeEach(() => {
		jest.clearAllMocks();
		savedEnv = process.env[ENV_NAME];
		delete process.env[ENV_NAME];

		mockEvent = {
			httpMethod: 'POST',
			path: '/mcp/v1',
			headers: { 'Content-Type': 'application/json', 'X-Atlantis-Origin-Secret': HEADER_VALUE },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			queryStringParameters: null,
			requestContext: { requestId: 'test-request-id', identity: { sourceIp: CLIENT_ADDRESS } }
		};
		mockContext = {
			requestId: 'test-request-id',
			awsRequestId: 'test-aws-request-id',
			functionName: 'test-function',
			getRemainingTimeInMillis: () => 30000
		};

		Config.promise.mockResolvedValue(undefined);
		Config.prime.mockResolvedValue(undefined);
		Config.settings.mockReturnValue({ rateLimits: { public: { limit: 100, window: 3600 } } });
		mockClientRequestInstance.isIngressVerified.mockReturnValue(true);
		AuthResolver.resolveAuth.mockResolvedValue({
			tier: 'public', identity: CLIENT_ADDRESS, isAuthenticated: false, userId: null, degraded: false
		});
		RateLimiter.checkRateLimit.mockResolvedValue({
			allowed: true,
			headers: { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '99', 'X-RateLimit-Reset': '3600' }
		});
		Routes.process.mockResolvedValue(undefined);
		wireFinalize();
	});

	afterEach(() => {
		if (savedEnv === undefined) {
 delete process.env[ENV_NAME];
} else {
 process.env[ENV_NAME] = savedEnv;
}
	});

	describe('protection off (Requirement 6.7)', () => {
		test.each([
			['unset', undefined],
			['empty', ''],
			['blank', '   ']
		])('variable %s: the request is processed as today, even if cache-data reports it unverified', async (_label, value) => {
			if (value !== undefined) {
 process.env[ENV_NAME] = value;
}
			// cache-data reports false for ingress "direct"; the guard must not read that as a refusal
			mockClientRequestInstance.isIngressVerified.mockReturnValue(false);

			const result = await handler(mockEvent, mockContext);

			expect(mockClientRequestInstance.isIngressVerified).not.toHaveBeenCalled();
			expect(AuthResolver.resolveAuth).toHaveBeenCalledTimes(1);
			expect(RateLimiter.checkRateLimit).toHaveBeenCalledTimes(1);
			expect(Routes.process).toHaveBeenCalledTimes(1);
			expect(result).toBe(FINALIZED_OK);
		});
	});

	describe('protection on and verified', () => {
		test('the request is processed as today', async () => {
			process.env[ENV_NAME] = SECRET_NAME;
			mockClientRequestInstance.isIngressVerified.mockReturnValue(true);

			const result = await handler(mockEvent, mockContext);

			expect(mockClientRequestInstance.isIngressVerified).toHaveBeenCalled();
			expect(AuthResolver.resolveAuth).toHaveBeenCalledTimes(1);
			expect(Routes.process).toHaveBeenCalledTimes(1);
			expect(mockResponseInstance.setStatusCode).not.toHaveBeenCalledWith(401);
			expect(result).toBe(FINALIZED_OK);
		});
	});

	describe('protection on and unverified (Requirements 6.1, 6.2, 6.4, 6.5, 6.8)', () => {
		beforeEach(() => {
			process.env[ENV_NAME] = SECRET_NAME;
			// Covers a header mismatch, a missing header, secret-not-primed, and secret-unavailable:
			// in every case cache-data answers false.
			mockClientRequestInstance.isIngressVerified.mockReturnValue(false);
		});

		test('answers 401 with no-store and the JSON message, and returns the finalized response', async () => {
			const result = await handler(mockEvent, mockContext);

			expect(mockResponseInstance.setStatusCode).toHaveBeenCalledWith(401);
			expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
			expect(mockResponseInstance.setBody).toHaveBeenCalledWith({ message: 'Requests must use the service endpoint.' });
			expect(mockResponseInstance.finalize).toHaveBeenCalledTimes(1);
			expect(result).toBe(FINALIZED_REFUSAL);
		});

		test('reads no Users record, writes no counter, and reaches no router', async () => {
			await handler(mockEvent, mockContext);

			expect(AuthResolver.resolveAuth).not.toHaveBeenCalled();
			expect(RateLimiter.checkRateLimit).not.toHaveBeenCalled();
			expect(RateLimiter.createRateLimitResponse).not.toHaveBeenCalled();
			expect(Routes.process).not.toHaveBeenCalled();
		});

		test('sets no max-age and no rate-limit or MCP header on the refusal', async () => {
			await handler(mockEvent, mockContext);

			const headers = mockResponseInstance.addHeader.mock.calls;
			expect(headers).toEqual([['Cache-Control', 'no-store']]);
			expect(recordedResponseCalls()).not.toMatch(/max-age/i);
		});

		test('the status is 401 and never 403 or 404', async () => {
			await handler(mockEvent, mockContext);

			const statuses = mockResponseInstance.setStatusCode.mock.calls.map(call => call[0]);
			expect(statuses).toEqual([401]);
			expect(statuses).not.toContain(403);
			expect(statuses).not.toContain(404);
		});

		test('nothing the client sent and no secret name or address is written to the response', async () => {
			await handler(mockEvent, mockContext);

			const written = recordedResponseCalls();
			expect(written).not.toContain(HEADER_VALUE);
			expect(written).not.toContain(SECRET_NAME);
			expect(written).not.toContain(CLIENT_ADDRESS);
			expect(written).not.toMatch(/arn:aws/);
		});

		test('creates the ClientRequest and Response first, and the guard decides from isIngressVerified only', async () => {
			await handler(mockEvent, mockContext);

			expect(mockClientRequestConstructor).toHaveBeenCalledWith(mockEvent, mockContext);
			expect(mockResponseConstructor).toHaveBeenCalledWith(mockClientRequestInstance);
			expect(mockClientRequestInstance.isIngressVerified).toHaveBeenCalledTimes(1);
			// >! The application never reads the header itself (one implementation, in cache-data).
			expect(mockClientRequestInstance.getProps).not.toHaveBeenCalled();
		});

		test('waits for Config.prime() before the check, so the secret is loaded first', async () => {
			const order = [];
			Config.prime.mockImplementation(async () => {
 order.push('prime');
});
			mockClientRequestInstance.isIngressVerified.mockImplementation(() => {
 order.push('check'); return false;
});

			await handler(mockEvent, mockContext);

			expect(order).toEqual(['prime', 'check']);
		});
	});

	/**
	 * Property: refusal iff the variable is set and the request is unverified.
	 * **Validates: Requirements 6.2, 6.3, 6.7, 6.8, 10.5**
	 */
	test('property: the handler refuses if and only if protection is on and the request is unverified', async () => {
		await fc.assert(
			fc.asyncProperty(fc.boolean(), fc.boolean(), async (flagOn, verified) => {
				jest.clearAllMocks();
				Config.promise.mockResolvedValue(undefined);
				Config.prime.mockResolvedValue(undefined);
				Config.settings.mockReturnValue({ rateLimits: { public: { limit: 100, window: 3600 } } });
				AuthResolver.resolveAuth.mockResolvedValue({
					tier: 'public', identity: CLIENT_ADDRESS, isAuthenticated: false, userId: null, degraded: false
				});
				RateLimiter.checkRateLimit.mockResolvedValue({ allowed: true, headers: {} });
				Routes.process.mockResolvedValue(undefined);
				wireFinalize();

				if (flagOn) {
 process.env[ENV_NAME] = SECRET_NAME;
} else {
 delete process.env[ENV_NAME];
}
				mockClientRequestInstance.isIngressVerified.mockReturnValue(verified);

				const result = await handler(mockEvent, mockContext);
				const refused = result.statusCode === 401;

				expect(refused).toBe(flagOn && !verified);
				expect(Routes.process).toHaveBeenCalledTimes(refused ? 0 : 1);
				expect(AuthResolver.resolveAuth).toHaveBeenCalledTimes(refused ? 0 : 1);
				expect(RateLimiter.checkRateLimit).toHaveBeenCalledTimes(refused ? 0 : 1);
			}),
			{ numRuns: 20 }
		);
	});
});
