// Feature: 0-0-4-cognito-orphan-cleanup, Unit tests for Cleanup handler
'use strict';

// Mock @aws-sdk/client-ssm
const mockSsmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => {
	return {
		SSMClient: jest.fn().mockImplementation(() => ({ send: mockSsmSend })),
		GetParameterCommand: jest.fn().mockImplementation((params) => params)
	};
});

// Mock @aws-sdk/client-cognito-identity-provider
const mockCognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
	return {
		CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
		AdminDeleteUserCommand: jest.fn().mockImplementation((params) => params)
	};
});

const { handler, TestHarness } = require('../../index');
const { AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a DynamoDB Streams record for testing.
 *
 * @param {Object} overrides - Optional overrides for the stream record
 * @returns {Object} DynamoDB Streams record
 */
function createStreamRecord(overrides = {}) {
	return {
		eventName: 'REMOVE',
		userIdentity: { principalId: 'dynamodb.amazonaws.com', type: 'Service' },
		dynamodb: {
			Keys: { pk: { S: 'KEY#a1b2c3d4' } },
			OldImage: {
				pk: { S: 'KEY#a1b2c3d4' },
				email: { S: 'user@example.com' },
				cognitoSub: { S: 'abc-123-def-456' },
				tier: { S: 'registered' },
				ttl: { N: '1700000000' }
			},
			SequenceNumber: '111222333444555'
		},
		...overrides
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Cleanup Handler', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			PARAM_STORE_PATH: '/test/path/'
		};

		// >! Clear SSM cache between tests to avoid stale parameter values
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
	/*  TTL deletion filtering                                        */
	/* -------------------------------------------------------------- */

	it('should process TTL deletion and call AdminDeleteUser', async () => {
		mockCognitoSend.mockResolvedValue({});

		const event = { Records: [createStreamRecord()] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(AdminDeleteUserCommand).toHaveBeenCalledWith({
			UserPoolId: 'us-east-1_TestPool',
			Username: 'abc-123-def-456'
		});
		expect(mockCognitoSend).toHaveBeenCalledTimes(1);
	});

	it('should skip application deletion (non-TTL principalId)', async () => {
		const record = createStreamRecord({
			userIdentity: { principalId: 'arn:aws:iam::123456789012:role/MyRole', type: 'IAMUser' }
		});

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should skip INSERT events', async () => {
		const record = createStreamRecord({ eventName: 'INSERT' });

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should skip MODIFY events', async () => {
		const record = createStreamRecord({ eventName: 'MODIFY' });

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	/* -------------------------------------------------------------- */
	/*  Record type filtering                                         */
	/* -------------------------------------------------------------- */

	it('should skip VOUCHER# records', async () => {
		const record = createStreamRecord({
			dynamodb: {
				Keys: { pk: { S: 'VOUCHER#code123' } },
				OldImage: {
					pk: { S: 'VOUCHER#code123' },
					cognitoSub: { S: 'abc-123-def-456' }
				},
				SequenceNumber: '111222333444555'
			}
		});

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should skip records without KEY# prefix', async () => {
		const record = createStreamRecord({
			dynamodb: {
				Keys: { pk: { S: 'OTHER#something' } },
				OldImage: {
					pk: { S: 'OTHER#something' },
					cognitoSub: { S: 'abc-123-def-456' }
				},
				SequenceNumber: '111222333444555'
			}
		});

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should skip records missing cognitoSub', async () => {
		const record = createStreamRecord({
			dynamodb: {
				Keys: { pk: { S: 'KEY#a1b2c3d4' } },
				OldImage: {
					pk: { S: 'KEY#a1b2c3d4' },
					email: { S: 'user@example.com' },
					tier: { S: 'registered' }
				},
				SequenceNumber: '111222333444555'
			}
		});

		const event = { Records: [record] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	/* -------------------------------------------------------------- */
	/*  SSM caching                                                   */
	/* -------------------------------------------------------------- */

	it('should retrieve SSM parameter once for multiple records', async () => {
		mockCognitoSend.mockResolvedValue({});

		const record1 = createStreamRecord();
		const record2 = createStreamRecord({
			dynamodb: {
				Keys: { pk: { S: 'KEY#e5f6g7h8' } },
				OldImage: {
					pk: { S: 'KEY#e5f6g7h8' },
					email: { S: 'user2@example.com' },
					cognitoSub: { S: 'def-456-ghi-789' },
					tier: { S: 'registered' },
					ttl: { N: '1700000000' }
				},
				SequenceNumber: '222333444555666'
			}
		});

		const event = { Records: [record1, record2] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(mockSsmSend).toHaveBeenCalledTimes(1);
		expect(mockCognitoSend).toHaveBeenCalledTimes(2);
	});

	/* -------------------------------------------------------------- */
	/*  UserNotFoundException handling                                 */
	/* -------------------------------------------------------------- */

	it('should treat UserNotFoundException as success', async () => {
		mockCognitoSend.mockRejectedValue({ name: 'UserNotFoundException' });

		const event = { Records: [createStreamRecord()] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
	});

	/* -------------------------------------------------------------- */
	/*  Other Cognito errors                                          */
	/* -------------------------------------------------------------- */

	it('should add record to batchItemFailures on other Cognito errors', async () => {
		mockCognitoSend.mockRejectedValue({ name: 'InternalErrorException', message: 'Service error' });

		const event = { Records: [createStreamRecord()] };
		const result = await handler(event);

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: '111222333444555' }]
		});
	});

	/* -------------------------------------------------------------- */
	/*  SSM failure                                                   */
	/* -------------------------------------------------------------- */

	it('should report all records as failed when SSM fails', async () => {
		mockSsmSend.mockRejectedValue(new Error('SSM unavailable'));

		const record1 = createStreamRecord();
		const record2 = createStreamRecord({
			dynamodb: {
				Keys: { pk: { S: 'KEY#e5f6g7h8' } },
				OldImage: {
					pk: { S: 'KEY#e5f6g7h8' },
					email: { S: 'user2@example.com' },
					cognitoSub: { S: 'def-456-ghi-789' },
					tier: { S: 'registered' },
					ttl: { N: '1700000000' }
				},
				SequenceNumber: '222333444555666'
			}
		});

		const event = { Records: [record1, record2] };
		const result = await handler(event);

		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: '111222333444555' },
				{ itemIdentifier: '222333444555666' }
			]
		});
	});

	/* -------------------------------------------------------------- */
	/*  Empty and missing Records                                     */
	/* -------------------------------------------------------------- */

	it('should return empty batchItemFailures for empty batch', async () => {
		const event = { Records: [] };
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
	});

	it('should return empty batchItemFailures for missing Records', async () => {
		const event = {};
		const result = await handler(event);

		expect(result).toEqual({ batchItemFailures: [] });
	});

	/* -------------------------------------------------------------- */
	/*  Correct AdminDeleteUser parameters                            */
	/* -------------------------------------------------------------- */

	it('should call AdminDeleteUserCommand with correct UserPoolId and Username', async () => {
		mockCognitoSend.mockResolvedValue({});

		const event = { Records: [createStreamRecord()] };
		await handler(event);

		expect(AdminDeleteUserCommand).toHaveBeenCalledTimes(1);
		expect(AdminDeleteUserCommand).toHaveBeenCalledWith({
			UserPoolId: 'us-east-1_TestPool',
			Username: 'abc-123-def-456'
		});
	});
});
