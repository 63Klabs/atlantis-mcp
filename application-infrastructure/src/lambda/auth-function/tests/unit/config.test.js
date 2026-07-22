/**
 * Unit tests for Config module
 *
 * Verifies:
 * - Config.init() calls AppConfig.init() with correct arguments
 * - Config.prime() calls CachedParameterSecrets.prime()
 * - Cache.init() is NOT called
 *
 * @module tests/unit/config
 */

'use strict';

// Mock @63klabs/cache-data before requiring Config
const mockAppConfigInit = jest.fn();
const mockAppConfigPromise = jest.fn().mockResolvedValue(true);
const mockCacheInit = jest.fn();
const mockCachedParameterSecretsPrime = jest.fn().mockResolvedValue(true);
const mockTimerStop = jest.fn();
const mockDebugAndLogError = jest.fn();

jest.mock('@63klabs/cache-data', () => {
	// >! AppConfig must be a real class so Config can extend it
	class MockAppConfig {
		static init = mockAppConfigInit;
		static promise = mockAppConfigPromise;
		static settings = jest.fn();
		static getConnCacheProfile = jest.fn();
	}

	return {
		cache: {
			Cache: {
				init: mockCacheInit,
			},
		},
		tools: {
			AppConfig: MockAppConfig,
			DebugAndLog: {
				error: mockDebugAndLogError,
				debug: jest.fn(),
				log: jest.fn(),
				info: jest.fn(),
				warn: jest.fn(),
			},
			Timer: jest.fn().mockImplementation(() => ({
				stop: mockTimerStop,
				isRunning: jest.fn().mockReturnValue(false),
			})),
			CachedParameterSecrets: {
				prime: mockCachedParameterSecretsPrime,
			},
			CachedSsmParameter: jest.fn().mockImplementation((path, options) => ({
				path,
				options,
				getValue: jest.fn().mockResolvedValue('mock-value'),
			})),
		},
	};
});

const { Config } = require('../../config');

describe('Config module', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('Config.init()', () => {

		it('should call AppConfig.init() with settings, validations, connections, responses, and debug flag', () => {
			Config.init();

			expect(mockAppConfigInit).toHaveBeenCalledTimes(1);

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs).toHaveProperty('settings');
			expect(callArgs).toHaveProperty('validations');
			expect(callArgs).toHaveProperty('connections');
			expect(callArgs).toHaveProperty('responses');
			expect(callArgs.debug).toBe(true);
		});

		it('should NOT call Cache.init()', () => {
			Config.init();

			expect(mockCacheInit).not.toHaveBeenCalled();
		});

		it('should use Timer to measure init duration', () => {
			const { tools: { Timer } } = require('@63klabs/cache-data');

			Config.init();

			expect(Timer).toHaveBeenCalledWith('timerConfigInit', true);
			expect(mockTimerStop).toHaveBeenCalled();
		});

		it('should return AppConfig.promise()', () => {
			const result = Config.init();

			expect(mockAppConfigPromise).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('should log error and still stop timer if AppConfig.init() throws', () => {
			mockAppConfigInit.mockImplementationOnce(() => {
				throw new Error('Init failed');
			});

			Config.init();

			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('Could not initialize Config Init failed'),
				expect.any(String)
			);
			expect(mockTimerStop).toHaveBeenCalled();
		});
	});

	describe('Config.prime()', () => {

		it('should call CachedParameterSecrets.prime()', async () => {
			await Config.prime();

			expect(mockCachedParameterSecretsPrime).toHaveBeenCalledTimes(1);
		});

		it('should return the result of CachedParameterSecrets.prime()', async () => {
			const result = await Config.prime();

			expect(result).toBe(true);
		});
	});

	describe('Config settings structure', () => {

		it('should pass settings with rateLimits to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs.settings).toHaveProperty('rateLimits');
			expect(callArgs.settings.rateLimits).toHaveProperty('public');
			expect(callArgs.settings.rateLimits).toHaveProperty('registered');
			expect(callArgs.settings.rateLimits).toHaveProperty('paid');
			expect(callArgs.settings.rateLimits).toHaveProperty('private');
		});

		it('should pass settings with DynamoDB table names to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs.settings).toHaveProperty('usersTable');
			expect(callArgs.settings).toHaveProperty('sessionsTable');
		});

		it('should pass settings with cognito and ssm CachedSsmParameter instances to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs.settings).toHaveProperty('cognito');
			expect(callArgs.settings.cognito).toHaveProperty('userPoolId');
			expect(callArgs.settings).toHaveProperty('ssm');
			expect(callArgs.settings.ssm).toHaveProperty('apiKeyHashSalt');
			expect(callArgs.settings.ssm).toHaveProperty('sessionHashSalt');
		});

		it('should pass validations with referrers and parameters to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs.validations).toHaveProperty('referrers');
			expect(callArgs.validations.referrers).toEqual(['*']);
			expect(callArgs.validations).toHaveProperty('parameters');
		});

		it('should pass connections array with dynamodb-users and dynamodb-sessions to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(Array.isArray(callArgs.connections)).toBe(true);
			const connectionNames = callArgs.connections.map(c => c.name);
			expect(connectionNames).toContain('dynamodb-users');
			expect(connectionNames).toContain('dynamodb-sessions');
		});

		it('should pass responses with zero-cache settings to AppConfig.init()', () => {
			Config.init();

			const callArgs = mockAppConfigInit.mock.calls[0][0];
			expect(callArgs.responses.settings.errorExpirationInSeconds).toBe(0);
			expect(callArgs.responses.settings.routeExpirationInSeconds).toBe(0);
			expect(callArgs.responses.settings.externalRequestHeadroomInMs).toBe(8000);
		});
	});
});
