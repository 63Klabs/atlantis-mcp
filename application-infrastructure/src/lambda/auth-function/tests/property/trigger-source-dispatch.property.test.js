/**
 * Property tests for the Lambda handler's trigger-source dispatch logic.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.6, 1.7**
 *
 * Property 2: Trigger echo identity
 * For any `triggerSource` string other than `PostConfirmation_ConfirmSignUp`, and
 * any event body, the dispatcher returns the identical object reference (same
 * object, not just equal) and invokes the post-confirmation handler zero times.
 *
 * Property 3: Branch exclusivity
 * No single event produces both a post-confirmation handler call and a proxy
 * response via Routes.process. The Cognito trigger branch and the API Gateway
 * branch are mutually exclusive for every possible input.
 *
 * @module tests/property/trigger-source-dispatch
 */

'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mocks — set up before requiring the module under test            */
/* ------------------------------------------------------------------ */

/**
 * Mock for handlers/post-confirmation.
 * Tracks call count; default implementation returns the event unchanged.
 */
const mockPostConfirmationHandler = jest.fn().mockResolvedValue({});

jest.mock('../../handlers/post-confirmation', () => ({
	handler: mockPostConfirmationHandler
}));

/**
 * Mock for routes/index.
 * Tracks call count; represents the API Gateway code path.
 */
const mockRoutesProcess = jest.fn().mockResolvedValue(undefined);

jest.mock('../../routes/index', () => ({
	process: mockRoutesProcess
}));

/**
 * Mock for config so Config.init() / Config.promise() / Config.prime() are no-ops.
 */
jest.mock('../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: jest.fn().mockResolvedValue(undefined),
		prime: jest.fn().mockResolvedValue(undefined),
	}
}));

/**
 * Mock @63klabs/cache-data to prevent any real AWS SDK initialization.
 * >! Prevents real cache-data initialization during unit/property tests.
 */
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			isProduction: jest.fn().mockReturnValue(false),
		},
		ClientRequest: jest.fn().mockImplementation(() => ({})),
		Response: jest.fn().mockImplementation(() => ({
			setStatusCode: jest.fn(),
			setBody: jest.fn(),
			finalize: jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' }),
		})),
		Timer: jest.fn().mockImplementation(() => ({
			isRunning: jest.fn().mockReturnValue(false),
			stop: jest.fn().mockReturnValue(0),
		})),
	}
}));

/* ------------------------------------------------------------------ */
/*  Module under test — required AFTER all mocks are defined         */
/* ------------------------------------------------------------------ */

const { handler } = require('../../index');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/**
 * Arbitrary: any triggerSource string that is NOT 'PostConfirmation_ConfirmSignUp'.
 * Covers empty strings, arbitrary unicode, and lookalike strings.
 */
const arbNonSignUpTriggerSource = fc.string({ minLength: 0, maxLength: 100 }).filter(
	s => s !== 'PostConfirmation_ConfirmSignUp'
);

/**
 * Arbitrary: a Cognito-shaped event with an arbitrary (non-sign-up) triggerSource
 * and an arbitrary event body. Using fc.object() for the body generates diverse
 * deeply-nested shapes to prove the handler returns the exact same reference.
 */
const arbCognitoTriggerEvent = fc.record({
	triggerSource: arbNonSignUpTriggerSource,
	userPoolId: fc.string({ minLength: 0, maxLength: 40 }),
	userName: fc.string({ minLength: 0, maxLength: 40 }),
	request: fc.object(),
	response: fc.object(),
});

/**
 * Arbitrary: a minimal API Gateway proxy event — has httpMethod and path, no
 * triggerSource — which takes the MVC code path.
 */
const arbApiGatewayEvent = fc.record({
	httpMethod: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
	path: fc.stringMatching(/^\/[a-z0-9/_-]{1,40}$/),
	headers: fc.constant({}),
	queryStringParameters: fc.constant(null),
	body: fc.constant(null),
	requestContext: fc.record({
		requestId: fc.string({ minLength: 1, maxLength: 20 }),
	}),
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Feature: 0-0-6-password-reset — trigger-source dispatch', () => {

	afterEach(() => {
		jest.clearAllMocks();
	});

	/**
	 * Property 2: Trigger echo identity.
	 *
	 * For any triggerSource other than 'PostConfirmation_ConfirmSignUp', the
	 * handler must:
	 *   1. Return the identical object reference (toBe, not toEqual).
	 *   2. Never invoke the post-confirmation handler.
	 *
	 * **Validates: Requirements 1.2, 1.3, 1.4**
	 */
	it('Property 2: Trigger echo identity — any non-sign-up triggerSource returns the same object reference', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbCognitoTriggerEvent,
				async (event) => {
					jest.clearAllMocks();

					const result = await handler(event, {});

					// >! The handler must return the exact same object (by reference),
					// >! not a copy. Cognito requires the original event structure.
					expect(result).toBe(event);

					// The post-confirmation handler must not be called for non-sign-up triggers
					expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * Property 3: Branch exclusivity.
	 *
	 * For any Cognito trigger event (has triggerSource), Routes.process is never
	 * called. The Cognito path and the API Gateway path are mutually exclusive.
	 *
	 * **Validates: Requirements 1.6, 1.7**
	 */
	it('Property 3: Branch exclusivity — Cognito trigger events never reach Routes.process', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbCognitoTriggerEvent,
				async (event) => {
					jest.clearAllMocks();

					await handler(event, {});

					// >! Routes.process belongs to the API Gateway branch.
					// >! A Cognito trigger must never reach it.
					expect(mockRoutesProcess).toHaveBeenCalledTimes(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * Property 3 (complement): Branch exclusivity for API Gateway events.
	 *
	 * For any API Gateway proxy event (has httpMethod + path, no triggerSource),
	 * the post-confirmation handler is never called.
	 *
	 * **Validates: Requirements 1.6, 1.7**
	 */
	it('Property 3: Branch exclusivity — API Gateway events never invoke the post-confirmation handler', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbApiGatewayEvent,
				async (event) => {
					jest.clearAllMocks();

					await handler(event, { awsRequestId: 'test-request-id' });

					// >! API Gateway path must never call the Cognito trigger handler.
					expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * Concrete case: PostConfirmation_ConfirmForgotPassword echoes event by reference.
	 *
	 * This is the specific trigger introduced by the password-reset feature. Verifying
	 * it explicitly supplements the property test's coverage of the critical path.
	 *
	 * **Validates: Requirements 1.3, 1.4**
	 */
	it('Concrete case: PostConfirmation_ConfirmForgotPassword returns the same event reference', async () => {
		const event = {
			triggerSource: 'PostConfirmation_ConfirmForgotPassword',
			userPoolId: 'us-east-1_TestPool',
			userName: 'test@example.com',
			request: { userAttributes: { email: 'test@example.com' } },
			response: {},
		};

		const result = await handler(event, {});

		expect(result).toBe(event);
		expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(0);
		expect(mockRoutesProcess).toHaveBeenCalledTimes(0);
	});

	/**
	 * Concrete case: empty-string triggerSource echoes event by reference.
	 *
	 * Exercises the lower boundary of the string space.
	 *
	 * **Validates: Requirements 1.2, 1.3**
	 */
	it('Concrete case: empty triggerSource string returns the same event reference', async () => {
		const event = {
			triggerSource: '',
			userPoolId: 'us-east-1_EmptyTrigger',
			request: {},
			response: {},
		};

		const result = await handler(event, {});

		expect(result).toBe(event);
		expect(mockPostConfirmationHandler).toHaveBeenCalledTimes(0);
	});

});
