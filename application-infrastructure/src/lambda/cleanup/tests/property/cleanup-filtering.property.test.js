// Feature: 0-0-4-cognito-orphan-cleanup, Properties 1-4: Cleanup filtering and robustness
'use strict';

// Mock AWS SDK modules (same pattern as unit tests)
const mockSsmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => ({
	SSMClient: jest.fn().mockImplementation(() => ({ send: mockSsmSend })),
	GetParameterCommand: jest.fn().mockImplementation((params) => params)
}));

const mockCognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
	CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
	AdminDeleteUserCommand: jest.fn().mockImplementation((params) => params)
}));

const fc = require('fast-check');
const { handler, TestHarness } = require('../../index');
const { AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const eventNameArb = fc.constantFrom('INSERT', 'MODIFY', 'REMOVE');
const principalIdArb = fc.constantFrom('dynamodb.amazonaws.com', 'arn:aws:iam::123:role/AppRole', 'arn:aws:sts::123:assumed-role/Role');
const pkPrefixArb = fc.constantFrom('KEY#', 'VOUCHER#', 'SESSION#', 'OTHER#');
const cognitoSubArb = fc.option(fc.stringMatching(/^[a-f0-9-]{8,36}$/), { nil: undefined });
const sequenceNumberArb = fc.stringMatching(/^[0-9]{10,20}$/);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a DynamoDB Streams record from generated values.
 *
 * @param {Object} params - Generated record parameters
 * @param {string} params.eventName - Stream event type
 * @param {string} params.principalId - Principal that triggered the event
 * @param {string} params.pkPrefix - Prefix for the partition key
 * @param {string|undefined} params.cognitoSub - Cognito sub value or undefined
 * @param {string} params.sequenceNumber - Stream sequence number
 * @returns {Object} DynamoDB Streams record
 */
function buildRecord({ eventName, principalId, pkPrefix, cognitoSub, sequenceNumber }) {
	const pk = pkPrefix + 'hash' + sequenceNumber.slice(0, 8);
	const oldImage = { pk: { S: pk } };
	if (cognitoSub !== undefined) {
		oldImage.cognitoSub = { S: cognitoSub };
	}
	return {
		eventName,
		userIdentity: { principalId, type: 'Service' },
		dynamodb: {
			OldImage: oldImage,
			SequenceNumber: sequenceNumber
		}
	};
}

/* ------------------------------------------------------------------ */
/*  Setup / Teardown                                                  */
/* ------------------------------------------------------------------ */

describe('Cleanup Lambda Property Tests', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			PARAM_STORE_PATH: '/test/path/'
		};

		const { resetCache } = TestHarness.getInternals();
		resetCache();

		jest.clearAllMocks();

		// Default SSM mock returns a valid User Pool ID
		mockSsmSend.mockResolvedValue({
			Parameter: { Value: 'us-east-1_TestPool' }
		});
	});

	afterEach(() => {
		process.env = originalEnv;
	});


	/* -------------------------------------------------------------- */
	/*  Property 1: Filtering correctness                             */
	/* -------------------------------------------------------------- */

	/**
	 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 5.4, 5.5, 8.1, 8.2, 8.4
	 */
	describe('Property 1: Filtering correctness', () => {

		it('Feature: 0-0-4-cognito-orphan-cleanup, Property 1: Filtering correctness', async () => {
			await fc.assert(
				fc.asyncProperty(
					eventNameArb,
					principalIdArb,
					pkPrefixArb,
					cognitoSubArb,
					sequenceNumberArb,
					async (eventName, principalId, pkPrefix, cognitoSub, sequenceNumber) => {
						// Reset mocks and cache for each iteration
						const { resetCache } = TestHarness.getInternals();
						resetCache();
						jest.clearAllMocks();
						mockSsmSend.mockResolvedValue({
							Parameter: { Value: 'us-east-1_TestPool' }
						});
						mockCognitoSend.mockResolvedValue({});

						const record = buildRecord({ eventName, principalId, pkPrefix, cognitoSub, sequenceNumber });
						const event = { Records: [record] };

						await handler(event);

						// Determine if all four conditions are met
						const isRemove = eventName === 'REMOVE';
						const isTtlPrincipal = principalId === 'dynamodb.amazonaws.com';
						const isKeyRecord = pkPrefix === 'KEY#';
						const hasCognitoSub = cognitoSub !== undefined && cognitoSub !== '';

						const shouldCallCognito = isRemove && isTtlPrincipal && isKeyRecord && hasCognitoSub;

						if (shouldCallCognito) {
							expect(mockCognitoSend).toHaveBeenCalledTimes(1);
						} else {
							expect(mockCognitoSend).not.toHaveBeenCalled();
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	/* -------------------------------------------------------------- */
	/*  Property 2: AdminDeleteUser invocation correctness            */
	/* -------------------------------------------------------------- */

	/**
	 * Validates: Requirements 5.3, 5.7
	 */
	describe('Property 2: AdminDeleteUser invocation correctness', () => {

		it('Feature: 0-0-4-cognito-orphan-cleanup, Property 2: AdminDeleteUser invocation correctness', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.stringMatching(/^[a-f0-9-]{8,36}$/),
					sequenceNumberArb,
					async (cognitoSub, sequenceNumber) => {
						// Reset mocks and cache for each iteration
						const { resetCache } = TestHarness.getInternals();
						resetCache();
						jest.clearAllMocks();
						mockSsmSend.mockResolvedValue({
							Parameter: { Value: 'us-east-1_TestPool' }
						});
						mockCognitoSend.mockResolvedValue({});

						// Build a qualifying record (all four conditions met)
						const record = buildRecord({
							eventName: 'REMOVE',
							principalId: 'dynamodb.amazonaws.com',
							pkPrefix: 'KEY#',
							cognitoSub,
							sequenceNumber
						});

						const event = { Records: [record] };
						await handler(event);

						// Verify AdminDeleteUser called exactly once with correct params
						expect(AdminDeleteUserCommand).toHaveBeenCalledTimes(1);
						expect(AdminDeleteUserCommand).toHaveBeenCalledWith({
							UserPoolId: 'us-east-1_TestPool',
							Username: cognitoSub
						});
						expect(mockCognitoSend).toHaveBeenCalledTimes(1);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	/* -------------------------------------------------------------- */
	/*  Property 3: Partial batch failure reporting accuracy           */
	/* -------------------------------------------------------------- */

	/**
	 * Validates: Requirements 6.1, 6.3
	 */
	describe('Property 3: Partial batch failure reporting accuracy', () => {

		it('Feature: 0-0-4-cognito-orphan-cleanup, Property 3: Partial batch failure reporting accuracy', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(fc.record({
						cognitoSub: fc.stringMatching(/^[a-f0-9-]{8,36}$/),
						sequenceNumber: sequenceNumberArb,
						shouldFail: fc.boolean()
					}), { minLength: 1, maxLength: 10 }),
					async (recordConfigs) => {
						// Reset mocks and cache for each iteration
						const { resetCache } = TestHarness.getInternals();
						resetCache();
						jest.clearAllMocks();
						mockSsmSend.mockResolvedValue({
							Parameter: { Value: 'us-east-1_TestPool' }
						});

						// Deduplicate sequence numbers to avoid ambiguity
						const seenSequenceNumbers = new Set();
						const uniqueConfigs = recordConfigs.filter(config => {
							if (seenSequenceNumbers.has(config.sequenceNumber)) {
								return false;
							}
							seenSequenceNumbers.add(config.sequenceNumber);
							return true;
						});

						if (uniqueConfigs.length === 0) {
							return; // Skip if all duplicates
						}

						// Track call index to determine which calls should fail
						let callIndex = 0;
						mockCognitoSend.mockImplementation(() => {
							const config = uniqueConfigs[callIndex];
							callIndex++;
							if (config && config.shouldFail) {
								return Promise.reject({ name: 'InternalErrorException', message: 'Service error' });
							}
							return Promise.resolve({});
						});

						// Build all qualifying records
						const records = uniqueConfigs.map(config => buildRecord({
							eventName: 'REMOVE',
							principalId: 'dynamodb.amazonaws.com',
							pkPrefix: 'KEY#',
							cognitoSub: config.cognitoSub,
							sequenceNumber: config.sequenceNumber
						}));

						const event = { Records: records };
						const result = await handler(event);

						// Expected failures are records where shouldFail is true
						const expectedFailures = uniqueConfigs
							.filter(config => config.shouldFail)
							.map(config => ({ itemIdentifier: config.sequenceNumber }));

						expect(result.batchItemFailures).toEqual(expect.arrayContaining(expectedFailures));
						expect(result.batchItemFailures.length).toBe(expectedFailures.length);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	/* -------------------------------------------------------------- */
	/*  Property 4: Handler robustness — never throws                 */
	/* -------------------------------------------------------------- */

	/**
	 * Validates: Requirements 6.4
	 */
	describe('Property 4: Handler robustness', () => {

		it('Feature: 0-0-4-cognito-orphan-cleanup, Property 4: Handler robustness', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.oneof(
						fc.anything(),
						fc.constant(null),
						fc.constant(undefined),
						fc.constant({}),
						fc.constant({ Records: null }),
						fc.constant({ Records: 'not-an-array' }),
						fc.constant({ Records: [] }),
						fc.constant({ Records: [null] }),
						fc.constant({ Records: [undefined] }),
						fc.constant({ Records: [{}] }),
						fc.constant({ Records: [{ eventName: 'REMOVE' }] }),
						fc.constant({ Records: [{ eventName: 'REMOVE', dynamodb: null }] }),
						fc.constant({ Records: [{ eventName: 'REMOVE', userIdentity: null }] })
					),
					async (event) => {
						// Reset mocks and cache for each iteration
						const { resetCache } = TestHarness.getInternals();
						resetCache();
						jest.clearAllMocks();
						mockSsmSend.mockResolvedValue({
							Parameter: { Value: 'us-east-1_TestPool' }
						});
						mockCognitoSend.mockResolvedValue({});

						// Handler should never throw
						const result = await handler(event);

						// Result should always have batchItemFailures array
						expect(result).toBeDefined();
						expect(result).toHaveProperty('batchItemFailures');
						expect(Array.isArray(result.batchItemFailures)).toBe(true);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});
