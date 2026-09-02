/**
 * Unit tests for Auth Lambda handler event dispatcher (index.js)
 *
 * Tests the top-level handler's ability to detect event type and route
 * to the correct downstream handler:
 * - Cognito PostConfirmation_ConfirmSignUp → post-confirmation handler
 * - Other Cognito trigger sources → echoed back unmodified
 * - API Gateway events (httpMethod + path) → Routes.process
 * - Unrecognized events → 400 proxy response
 *
 * @module tests/unit/handler-event-dispatch
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

// Mock @63klabs/cache-data before any require of the module under test
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
		ClientRequest: jest.fn().mockImplementation((event) => ({ event })),
		Response: jest.fn().mockImplementation(() => ({
			setStatusCode: jest.fn(),
			setBody: jest.fn(),
			finalize: jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' })
		})),
		CachedParameterSecrets: { prime: jest.fn().mockResolvedValue(undefined) },
		AppConfig: class {
			static init() {}
			static promise() { return Promise.resolve(true); }
			static settings() { return {}; }
		}
	}
}));

// Mock Config to prevent real SSM/DynamoDB initialization
jest.mock('../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: jest.fn().mockResolvedValue(true),
		prime: jest.fn().mockResolvedValue(undefined)
	}
}));

// Mock post-confirmation handler
const mockPostConfirmationHandler = jest.fn();
jest.mock('../../handlers/post-confirmation', () => ({
	handler: mockPostConfirmationHandler
}));

// Mock Routes
const mockRoutesProcess = jest.fn();
jest.mock('../../routes/index', () => ({
	process: mockRoutesProcess
}));

// Require the module under test AFTER all mocks are in place
const { handler } = require('../../index');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a Cognito trigger event.
 *
 * @param {string} triggerSource - The triggerSource value
 * @param {Object} [extra] - Additional properties to merge onto the event
 * @returns {Object} Cognito trigger event
 */
function buildCognitoEvent(triggerSource, extra = {}) {
	return {
		triggerSource,
		userPoolId: 'us-east-1_TestPool',
		userName: 'user@example.com',
		request: { userAttributes: { email: 'user@example.com', sub: 'sub-123' } },
		response: {},
		...extra
	};
}

/**
 * Build a minimal API Gateway proxy event.
 *
 * @param {string} [method='GET'] - HTTP method
 * @param {string} [path='/mcp/auth/profile'] - Request path
 * @returns {Object} API Gateway proxy event
 */
function buildApiGatewayEvent(method = 'GET', path = '/mcp/auth/profile') {
	return {
		httpMethod: method,
		path,
		headers: { Authorization: 'Bearer test-token' },
		queryStringParameters: null,
		body: null,
		requestContext: { requestId: 'test-request-id' }
	};
}

/**
 * Build a Lambda context object.
 *
 * @returns {Object} Lambda context
 */
function buildContext() {
	return {
		awsRequestId: 'test-context-id',
		functionName: 'test-auth-function'
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Auth Lambda handler — event dispatch', () => {

	afterEach(() => {
		jest.clearAllMocks();
	});

	/* ---------------------------------------------------------------- */
	/*  Cognito PostConfirmation_ConfirmSignUp                          */
	/* ---------------------------------------------------------------- */

	describe('PostConfirmation_ConfirmSignUp trigger', () => {
		it('should delegate to postConfirmationHandler and return its result', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			const expectedResult = { ...event };
			mockPostConfirmationHandler.mockResolvedValue(expectedResult);

			const result = await handler(event, buildContext());

			expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(1);
			expect(mockPostConfirmationHandler).toHaveBeenCalledWith(event);
			expect(result).toBe(expectedResult);
		});

		it('should propagate a handler rejection rather than swallowing it', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			const confirmationError = new Error('User domain is blocked');
			mockPostConfirmationHandler.mockRejectedValue(confirmationError);

			await expect(handler(event, buildContext())).rejects.toThrow('User domain is blocked');

			expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(1);
		});

		it('should NOT call Routes.process for a ConfirmSignUp trigger', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			mockPostConfirmationHandler.mockResolvedValue(event);

			await handler(event, buildContext());

			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});
	});

	/* ---------------------------------------------------------------- */
	/*  PostConfirmation_ConfirmForgotPassword trigger                  */
	/* ---------------------------------------------------------------- */

	describe('PostConfirmation_ConfirmForgotPassword trigger', () => {
		it('should return the same object reference — not call postConfirmationHandler', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmForgotPassword');

			const result = await handler(event, buildContext());

			// >! Echo identity: must be the identical object reference, not a copy
			expect(result).toBe(event);
			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		it('should NOT call Routes.process for a ConfirmForgotPassword trigger', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmForgotPassword');

			await handler(event, buildContext());

			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});
	});

	/* ---------------------------------------------------------------- */
	/*  Unknown / arbitrary Cognito trigger sources                    */
	/* ---------------------------------------------------------------- */

	describe('Unknown Cognito trigger source', () => {
		it('should echo the event back unmodified by reference', async () => {
			const event = buildCognitoEvent('PreSignUp_PreSignUp');

			const result = await handler(event, buildContext());

			// >! Must be identical object reference, not a copy
			expect(result).toBe(event);
		});

		it('should NOT call postConfirmationHandler for an unknown trigger', async () => {
			const event = buildCognitoEvent('CustomMessage_SignUp');

			await handler(event, buildContext());

			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		it('should NOT call Routes.process for an unknown trigger', async () => {
			const event = buildCognitoEvent('TokenGeneration_HostedAuth');

			await handler(event, buildContext());

			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});

		it('should log the trigger source value via console.log', async () => {
			// jest.setup.js suppresses console output globally; spy to capture the call
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

			const triggerSource = 'PreSignUp_AdminCreateUser';
			const event = buildCognitoEvent(triggerSource);

			await handler(event, buildContext());

			// The handler logs the unhandled trigger source
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining(triggerSource)
			);

			consoleSpy.mockRestore();
		});
	});

	/* ---------------------------------------------------------------- */
	/*  API Gateway proxy events                                        */
	/* ---------------------------------------------------------------- */

	describe('API Gateway proxy event', () => {
		it('should call Routes.process for a valid API Gateway event', async () => {
			const event = buildApiGatewayEvent('GET', '/mcp/auth/profile');
			const context = buildContext();
			mockRoutesProcess.mockResolvedValue(undefined);

			await handler(event, context);

			expect(mockRoutesProcess).toHaveBeenCalledTimes(1);
		});

		it('should NOT call postConfirmationHandler for an API Gateway event', async () => {
			const event = buildApiGatewayEvent('POST', '/mcp/auth/key/regenerate');
			mockRoutesProcess.mockResolvedValue(undefined);

			await handler(event, context = buildContext());

			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		it('should finalize the response and return a proxy response', async () => {
			const event = buildApiGatewayEvent('GET', '/mcp/auth/profile');
			const expectedResponse = { statusCode: 200, headers: {}, body: '{"ok":true}' };
			const { Response } = require('@63klabs/cache-data').tools;
			// Make the mock response instance return expectedResponse on finalize
			Response.mockImplementationOnce(() => ({
				setStatusCode: jest.fn(),
				setBody: jest.fn(),
				finalize: jest.fn().mockResolvedValue(expectedResponse)
			}));
			mockRoutesProcess.mockResolvedValue(undefined);

			const result = await handler(event, buildContext());

			expect(result).toEqual(expectedResponse);
		});
	});

	/* ---------------------------------------------------------------- */
	/*  Unrecognized events (no triggerSource, no httpMethod/path)     */
	/* ---------------------------------------------------------------- */

	describe('Unrecognized event', () => {
		it('should return a 400 proxy response for an event with neither triggerSource nor httpMethod', async () => {
			const event = { someOtherProperty: 'value', requestContext: { requestId: 'unknown-req' } };
			const context = buildContext();

			// Capture the response mock to verify 400 was set
			const mockSetStatusCode = jest.fn();
			const mockSetBody = jest.fn();
			const mockFinalize = jest.fn().mockResolvedValue({
				statusCode: 400,
				headers: {},
				body: JSON.stringify({ error: 'Unrecognized event type' })
			});

			const { Response } = require('@63klabs/cache-data').tools;
			Response.mockImplementationOnce(() => ({
				setStatusCode: mockSetStatusCode,
				setBody: mockSetBody,
				finalize: mockFinalize
			}));

			const result = await handler(event, context);

			expect(mockSetStatusCode).toHaveBeenCalledWith(400);
			expect(mockRoutesProcess).not.toHaveBeenCalled();
			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
			// The response was finalized
			expect(mockFinalize).toHaveBeenCalledTimes(1);
		});

		it('should NOT call postConfirmationHandler for an unrecognized event', async () => {
			const event = { unknownKey: true };
			const context = buildContext();

			const { Response } = require('@63klabs/cache-data').tools;
			Response.mockImplementationOnce(() => ({
				setStatusCode: jest.fn(),
				setBody: jest.fn(),
				finalize: jest.fn().mockResolvedValue({ statusCode: 400 })
			}));

			await handler(event, context);

			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		it('should NOT call Routes.process for an unrecognized event', async () => {
			const event = { unknownKey: true };
			const context = buildContext();

			const { Response } = require('@63klabs/cache-data').tools;
			Response.mockImplementationOnce(() => ({
				setStatusCode: jest.fn(),
				setBody: jest.fn(),
				finalize: jest.fn().mockResolvedValue({ statusCode: 400 })
			}));

			await handler(event, context);

			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});
	});

	/* ---------------------------------------------------------------- */
	/*  Branch exclusivity: no event produces both paths               */
	/* ---------------------------------------------------------------- */

	describe('Branch exclusivity', () => {
		it('PostConfirmation_ConfirmSignUp: handler called, Routes not called', async () => {
			const event = buildCognitoEvent('PostConfirmation_ConfirmSignUp');
			mockPostConfirmationHandler.mockResolvedValue(event);

			await handler(event, buildContext());

			expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(1);
			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});

		it('API Gateway event: Routes called, postConfirmationHandler not called', async () => {
			const event = buildApiGatewayEvent();
			mockRoutesProcess.mockResolvedValue(undefined);

			await handler(event, buildContext());

			expect(mockRoutesProcess).toHaveBeenCalledTimes(1);
			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
		});

		it('Unknown trigger: neither handler nor Routes called', async () => {
			const event = buildCognitoEvent('VerifyAuthChallengeResponse_Authentication');

			await handler(event, buildContext());

			expect(mockPostConfirmationHandler).not.toHaveBeenCalled();
			expect(mockRoutesProcess).not.toHaveBeenCalled();
		});
	});
});
