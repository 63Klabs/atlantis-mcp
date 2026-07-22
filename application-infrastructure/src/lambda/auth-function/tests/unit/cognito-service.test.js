/**
 * Unit tests for Cognito Service (services/cognito.js)
 *
 * Verifies updateUserAttributes with mocked Cognito client
 * and confirms User Pool ID is retrieved from CachedSsmParameter.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * @module tests/unit/cognito-service
 */

'use strict';

const mockSend = jest.fn();
const mockDebugAndLogError = jest.fn();
const mockGetValue = jest.fn();

// Mock @aws-sdk/client-cognito-identity-provider
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
	class MockCommand {
		constructor(input) { this.input = input; }
	}
	return {
		CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
			send: mockSend,
		})),
		AdminUpdateUserAttributesCommand: MockCommand,
	};
});

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: mockDebugAndLogError,
			debug: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
		},
		AppConfig: class MockAppConfig {
			static init = jest.fn();
			static promise = jest.fn().mockResolvedValue(true);
			static settings = jest.fn().mockReturnValue({
				usersTable: 'test-users-table',
				sessionsTable: 'test-sessions-table',
				cognito: {
					userPoolId: {
						getValue: mockGetValue,
					},
				},
			});
			static getConnCacheProfile = jest.fn();
		},
		Timer: jest.fn().mockImplementation(() => ({
			stop: jest.fn(),
			isRunning: jest.fn().mockReturnValue(false),
		})),
		CachedParameterSecrets: {
			prime: jest.fn().mockResolvedValue(true),
		},
		CachedSsmParameter: jest.fn().mockImplementation((path, options) => ({
			path,
			options,
			getValue: jest.fn().mockResolvedValue('mock-value'),
		})),
	},
}));

const { updateUserAttributes } = require('../../services/cognito');

describe('Cognito Service (services/cognito.js)', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetValue.mockResolvedValue('us-east-1_TestPool');
	});

	describe('updateUserAttributes()', () => {

		it('should send AdminUpdateUserAttributesCommand with correct parameters', async () => {
			mockSend.mockResolvedValueOnce({});

			const attributes = [{ Name: 'custom:api_key', Value: 'new-hash-value' }];
			await updateUserAttributes('cognito-sub-123', attributes);

			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.UserPoolId).toBe('us-east-1_TestPool');
			expect(command.input.Username).toBe('cognito-sub-123');
			expect(command.input.UserAttributes).toEqual(attributes);
		});

		it('should retrieve User Pool ID from CachedSsmParameter via Config.settings()', async () => {
			mockSend.mockResolvedValueOnce({});

			await updateUserAttributes('cognito-sub-456', [
				{ Name: 'custom:tier', Value: 'paid' },
			]);

			expect(mockGetValue).toHaveBeenCalledTimes(1);
		});

		it('should handle multiple attributes in a single call', async () => {
			mockSend.mockResolvedValueOnce({});

			const attributes = [
				{ Name: 'custom:api_key', Value: 'key-hash' },
				{ Name: 'custom:tier', Value: 'paid' },
			];
			await updateUserAttributes('cognito-sub-789', attributes);

			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.UserAttributes).toEqual(attributes);
			expect(command.input.UserAttributes).toHaveLength(2);
		});

		it('should log error and re-throw on Cognito SDK failure', async () => {
			const error = new Error('Cognito update failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(
				updateUserAttributes('cognito-sub-123', [{ Name: 'custom:tier', Value: 'paid' }])
			).rejects.toThrow('Cognito update failed');

			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('updateUserAttributes error'),
				expect.any(String)
			);
		});

		it('should log error and re-throw when User Pool ID retrieval fails', async () => {
			const error = new Error('SSM parameter not found');
			mockGetValue.mockRejectedValueOnce(error);

			await expect(
				updateUserAttributes('cognito-sub-123', [{ Name: 'custom:tier', Value: 'paid' }])
			).rejects.toThrow('SSM parameter not found');

			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('updateUserAttributes error'),
				expect.any(String)
			);
			// Cognito send should NOT have been called since User Pool ID retrieval failed
			expect(mockSend).not.toHaveBeenCalled();
		});

		it('should use the User Pool ID returned by CachedSsmParameter for each call', async () => {
			mockGetValue.mockResolvedValueOnce('us-east-1_PoolA');
			mockSend.mockResolvedValueOnce({});

			await updateUserAttributes('sub-1', [{ Name: 'custom:tier', Value: 'registered' }]);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.UserPoolId).toBe('us-east-1_PoolA');
		});
	});
});
