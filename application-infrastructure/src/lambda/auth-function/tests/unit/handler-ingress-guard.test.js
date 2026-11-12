/**
 * Unit tests for the origin-protection guard in the Auth Lambda handler.
 *
 * Spec: 0-0-7-rate-limit-client-ip-spoofing, Part B (Requirements 6.1 to 6.10, 10.5).
 *
 * The guard sits inside the `event.httpMethod && event.path` branch, after
 * `new Response(clientRequest)` and before `Routes.process`. A Cognito trigger event
 * (`event.triggerSource`) returns earlier, carries no CloudFront header, and must never be
 * refused or altered by the guard, even with `CACHE_DATA_INGRESS_SECRET_NAME` set.
 *
 * @module tests/unit/handler-ingress-guard
 */
'use strict';

const fc = require('fast-check');

const ENV_NAME = 'CACHE_DATA_INGRESS_SECRET_NAME';
const SECRET_NAME = 'acme-mcp-test-OriginSecret';
const HEADER_VALUE = 'header-value-that-must-never-be-echoed';
const CLIENT_ADDRESS = '203.0.113.77';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

const mockClientRequestInstance = {
	isIngressVerified: jest.fn().mockReturnValue(true),
	getProps: jest.fn().mockReturnValue({}),
	getClientIp: jest.fn().mockReturnValue('203.0.113.77')
};

const mockResponseInstance = {
	setStatusCode: jest.fn().mockReturnThis(),
	addHeader: jest.fn().mockReturnThis(),
	setBody: jest.fn().mockReturnThis(),
	finalize: jest.fn()
};

const mockClientRequestConstructor = jest.fn(() => mockClientRequestInstance);
const mockResponseConstructor = jest.fn(() => mockResponseInstance);

jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		Timer: jest.fn().mockImplementation(() => ({
			stop: jest.fn().mockReturnValue('0ms'),
			isRunning: jest.fn().mockReturnValue(false)
		})),
		ClientRequest: mockClientRequestConstructor,
		Response: mockResponseConstructor,
		CachedParameterSecrets: { prime: jest.fn().mockResolvedValue(undefined) },
		AppConfig: class {
			static init() {}
			static promise() {
 return Promise.resolve(true);
}
			static settings() {
 return {};
}
		}
	}
}));

const mockConfigPromise = jest.fn();
const mockConfigPrime = jest.fn();
jest.mock('../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: mockConfigPromise,
		prime: mockConfigPrime
	}
}));

const mockPostConfirmationHandler = jest.fn();
jest.mock('../../handlers/post-confirmation', () => ({
	handler: mockPostConfirmationHandler
}));

const mockRoutesProcess = jest.fn();
jest.mock('../../routes/index', () => ({
	process: mockRoutesProcess
}));

const { handler } = require('../../index');

const FINALIZED_OK = { statusCode: 200, headers: {}, body: '{"ok":true}' };
const FINALIZED_REFUSAL = { statusCode: 401, headers: { 'Cache-Control': 'no-store' }, body: '{"message":"x"}' };

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a Cognito trigger event.
 *
 * @param {string} triggerSource - The triggerSource value
 * @returns {Object} Cognito trigger event
 */
function buildCognitoEvent(triggerSource) {
	return {
		triggerSource,
		userPoolId: 'us-east-1_TestPool',
		userName: 'user@example.com',
		request: { userAttributes: { email: 'user@example.com', sub: 'sub-123' } },
		response: {}
	};
}

/**
 * Build an API Gateway proxy event that carries an origin-secret header.
 *
 * @param {string} [method='GET'] - HTTP method
 * @param {string} [path='/mcp/auth/profile'] - Request path
 * @returns {Object} API Gateway proxy event
 */
function buildApiGatewayEvent(method = 'GET', path = '/mcp/auth/profile') {
	return {
		httpMethod: method,
		path,
		headers: { Authorization: 'Bearer test-token', 'X-Atlantis-Origin-Secret': HEADER_VALUE },
		queryStringParameters: null,
		body: null,
		requestContext: { requestId: 'test-request-id', identity: { sourceIp: CLIENT_ADDRESS } }
	};
}

/**
 * Build a Lambda context object.
 *
 * @returns {Object} Lambda context
 */
function buildContext() {
	return { awsRequestId: 'test-context-id', functionName: 'test-auth-function' };
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

/**
 * Make Response.finalize answer a refusal when a 401 was set and a success otherwise.
 */
function wireFinalize() {
	mockResponseInstance.finalize.mockImplementation(() => {
		const statusCalls = mockResponseInstance.setStatusCode.mock.calls;
		const last = statusCalls.length ? statusCalls[statusCalls.length - 1][0] : 200;
		return last === 401 ? FINALIZED_REFUSAL : FINALIZED_OK;
	});
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Auth Lambda handler: origin-protection guard', () => {
	let savedEnv;

	beforeEach(() => {
		jest.clearAllMocks();
		savedEnv = process.env[ENV_NAME];
		delete process.env[ENV_NAME];
		mockConfigPromise.mockResolvedValue(true);
		mockConfigPrime.mockResolvedValue(undefined);
		mockClientRequestInstance.isIngressVerified.mockReturnValue(true);
		mockRoutesProcess.mockResolvedValue(undefined);
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
		])('variable %s: the request is routed as today, even if cache-data reports it unverified', async (_label, value) => {
			if (value !== undefined) {
 process.env[ENV_NAME] = value;
}
			mockClientRequestInstance.isIngressVerified.mockReturnValue(false);

			const result = await handler(buildApiGatewayEvent(), buildContext());

			expect(mockClientRequestInstance.isIngressVerified).not.toHaveBeenCalled();
			expect(mockRoutesProcess).toHaveBeenCalledTimes(1);
			expect(result).toBe(FINALIZED_OK);
		});
	});

	describe('protection on and verified', () => {
		test('the request is routed as today', async () => {
			process.env[ENV_NAME] = SECRET_NAME;
			mockClientRequestInstance.isIngressVerified.mockReturnValue(true);

			const result = await handler(buildApiGatewayEvent(), buildContext());

			expect(mockClientRequestInstance.isIngressVerified).toHaveBeenCalled();
			expect(mockRoutesProcess).toHaveBeenCalledTimes(1);
			expect(mockResponseInstance.setStatusCode).not.toHaveBeenCalledWith(401);
			expect(result).toBe(FINALIZED_OK);
		});
	});

	describe('protection on and unverified (Requirements 6.1, 6.2, 6.4, 6.5, 6.8)', () => {
		beforeEach(() => {
			process.env[ENV_NAME] = SECRET_NAME;
			// Header mismatch, missing header, secret-not-primed, and secret-unavailable all answer false.
			mockClientRequestInstance.isIngressVerified.mockReturnValue(false);
		});

		test.each([
			['GET', '/mcp/auth/profile'],
			['POST', '/mcp/auth/key/regenerate'],
			['POST', '/mcp/auth/voucher/redeem'],
			['OPTIONS', '/mcp/auth/profile'],
			['GET', '/no/such/route']
		])('%s %s: answers 401 with no-store and the JSON message', async (method, path) => {
			const result = await handler(buildApiGatewayEvent(method, path), buildContext());

			expect(mockResponseInstance.setStatusCode).toHaveBeenCalledWith(401);
			expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
			expect(mockResponseInstance.setBody).toHaveBeenCalledWith({ message: 'Requests must use the service endpoint.' });
			expect(mockResponseInstance.finalize).toHaveBeenCalledTimes(1);
			expect(result).toBe(FINALIZED_REFUSAL);
		});

		test('reaches no controller (Routes.process is not called)', async () => {
			await handler(buildApiGatewayEvent(), buildContext());

			expect(mockRoutesProcess).not.toHaveBeenCalled();
			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		test('sets only Cache-Control: no-store, with no max-age', async () => {
			await handler(buildApiGatewayEvent(), buildContext());

			expect(mockResponseInstance.addHeader.mock.calls).toEqual([['Cache-Control', 'no-store']]);
			expect(recordedResponseCalls()).not.toMatch(/max-age/i);
		});

		test('the status is 401 and never 403 or 404', async () => {
			await handler(buildApiGatewayEvent(), buildContext());

			const statuses = mockResponseInstance.setStatusCode.mock.calls.map(call => call[0]);
			expect(statuses).toEqual([401]);
			expect(statuses).not.toContain(403);
			expect(statuses).not.toContain(404);
		});

		test('nothing the client sent and no secret name or address is written to the response', async () => {
			await handler(buildApiGatewayEvent(), buildContext());

			const written = recordedResponseCalls();
			expect(written).not.toContain(HEADER_VALUE);
			expect(written).not.toContain(SECRET_NAME);
			expect(written).not.toContain(CLIENT_ADDRESS);
			expect(written).not.toContain('test-token');
			expect(written).not.toMatch(/arn:aws/);
		});

		test('waits for Config.prime() before the check, so the secret is loaded first', async () => {
			const order = [];
			mockConfigPrime.mockImplementation(async () => {
 order.push('prime');
});
			mockClientRequestInstance.isIngressVerified.mockImplementation(() => {
 order.push('check'); return false;
});

			await handler(buildApiGatewayEvent(), buildContext());

			expect(order).toEqual(['prime', 'check']);
		});

		test('the guard decides from isIngressVerified only; the application never reads the header', async () => {
			await handler(buildApiGatewayEvent(), buildContext());

			expect(mockClientRequestInstance.isIngressVerified).toHaveBeenCalledTimes(1);
			expect(mockClientRequestInstance.getProps).not.toHaveBeenCalled();
		});
	});

	describe('Cognito trigger events are never refused (Requirement 6.6)', () => {
		beforeEach(() => {
			process.env[ENV_NAME] = SECRET_NAME;
			// Worst case: if the guard were reached, this would refuse.
			mockClientRequestInstance.isIngressVerified.mockReturnValue(false);
		});

		test('PostConfirmation_ConfirmSignUp is delegated to the post-confirmation handler as today', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			mockPostConfirmationHandler.mockResolvedValue(event);

			const result = await handler(event, buildContext());

			expect(mockPostConfirmationHandler).toHaveBeenCalledWith(event);
			expect(result).toBe(event);
			expect(result.statusCode).toBeUndefined();
		});

		test('PostConfirmation_ConfirmSignUp rejections still propagate (not turned into a 401)', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			mockPostConfirmationHandler.mockRejectedValue(new Error('blocked domain'));

			await expect(handler(event, buildContext())).rejects.toThrow('blocked domain');
		});

		test.each([
			'PostConfirmation_ConfirmForgotPassword',
			'PreSignUp_SignUp',
			'PreSignUp_AdminCreateUser',
			'CustomMessage_ForgotPassword',
			'TokenGeneration_Authentication',
			'SomeFutureTrigger_Unlisted'
		])('%s is echoed back unmodified, never a 401', async (triggerSource) => {
			const event = buildCognitoEvent(triggerSource);
			const snapshot = JSON.parse(JSON.stringify(event));

			const result = await handler(event, buildContext());

			expect(result).toBe(event);
			expect(event).toEqual(snapshot);
			expect(result.statusCode).toBeUndefined();
		});

		test('a trigger event reaches neither the cache-data request, the response, the guard, nor the router', async () => {
			await handler(buildCognitoEvent('PostConfirmation_ConfirmForgotPassword'), buildContext());
			await handler(buildCognitoEvent('PreSignUp_SignUp'), buildContext());

			expect(mockClientRequestConstructor).not.toHaveBeenCalled();
			expect(mockResponseConstructor).not.toHaveBeenCalled();
			expect(mockClientRequestInstance.isIngressVerified).not.toHaveBeenCalled();
			expect(mockResponseInstance.setStatusCode).not.toHaveBeenCalled();
			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});

		/**
		 * Property: a trigger event is never refused for any combination of flag and verification.
		 * **Validates: Requirement 6.6**
		 */
		test('property: any trigger source is echoed unchanged for any flag and verification state', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.boolean(),
					fc.boolean(),
					fc.stringMatching(/^[A-Za-z]{3,12}_[A-Za-z]{3,16}$/).filter(s => s !== 'PostConfirmation_ConfirmSignUp'),
					async (flagOn, verified, triggerSource) => {
						if (flagOn) {
 process.env[ENV_NAME] = SECRET_NAME;
} else {
 delete process.env[ENV_NAME];
}
						mockClientRequestInstance.isIngressVerified.mockReturnValue(verified);
						const event = buildCognitoEvent(triggerSource);

						const result = await handler(event, buildContext());

						expect(result).toBe(event);
					}
				),
				{ numRuns: 50 }
			);
		});
	});

	/**
	 * Property: refusal iff the variable is set and the request is unverified.
	 * **Validates: Requirements 6.2, 6.3, 6.7, 6.8, 10.5**
	 */
	test('property: an API Gateway request is refused if and only if protection is on and it is unverified', async () => {
		await fc.assert(
			fc.asyncProperty(fc.boolean(), fc.boolean(), async (flagOn, verified) => {
				jest.clearAllMocks();
				mockConfigPromise.mockResolvedValue(true);
				mockConfigPrime.mockResolvedValue(undefined);
				mockRoutesProcess.mockResolvedValue(undefined);
				wireFinalize();

				if (flagOn) {
 process.env[ENV_NAME] = SECRET_NAME;
} else {
 delete process.env[ENV_NAME];
}
				mockClientRequestInstance.isIngressVerified.mockReturnValue(verified);

				const result = await handler(buildApiGatewayEvent(), buildContext());
				const refused = result.statusCode === 401;

				expect(refused).toBe(flagOn && !verified);
				expect(mockRoutesProcess).toHaveBeenCalledTimes(refused ? 0 : 1);
			}),
			{ numRuns: 20 }
		);
	});
});
