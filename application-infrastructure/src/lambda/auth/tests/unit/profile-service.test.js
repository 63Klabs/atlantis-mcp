/**
 * Unit tests for Profile Service
 *
 * Tests the business logic in services/profile.js including:
 * - Effective tier computation (expired vs active tiers)
 * - Session record present vs absent (remaining calculation)
 * - Rate limit config lookup from Config.settings()
 * - User not found error handling
 *
 * @module tests/unit/profile-service
 */

'use strict';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		}
	}
}));

// Mock ../config
const mockSettings = {
	rateLimits: {
		public: { limitPerWindow: 50, windowInMinutes: 60 },
		registered: { limitPerWindow: 100, windowInMinutes: 60 },
		paid: { limitPerWindow: 3000, windowInMinutes: 1440 },
		private: { limitPerWindow: 6000, windowInMinutes: 1440 }
	},
	ssm: {
		sessionHashSalt: {
			getValue: jest.fn().mockResolvedValue('test-session-salt')
		}
	}
};

jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn(() => mockSettings)
	}
}));

// Mock ../../models/user
const mockQueryByEmail = jest.fn();
const mockGetSessionRecord = jest.fn();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	getSessionRecord: mockGetSessionRecord
}));

// Mock ../../utils/window-calculator
const mockComputeWindowBoundaries = jest.fn();
const mockComputeSessionKey = jest.fn();
jest.mock('../../utils/window-calculator', () => ({
	computeWindowBoundaries: mockComputeWindowBoundaries,
	computeSessionKey: mockComputeSessionKey
}));

const { getProfile, computeEffectiveTier, TestHarness } = require('../../services/profile');

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Profile Service', () => {

	beforeEach(() => {
		jest.clearAllMocks();

		// Default window calculator mocks
		mockComputeWindowBoundaries.mockReturnValue({
			windowStartMinutes: 29340,
			resetTimeMinutes: 29400
		});
		mockComputeSessionKey.mockReturnValue('session-pk-hash');
	});

	/* -------------------------------------------------------------- */
	/*  computeEffectiveTier                                          */
	/* -------------------------------------------------------------- */

	describe('computeEffectiveTier', () => {
		it('should return stored tier when tierExpiresAt is null', () => {
			expect(computeEffectiveTier('paid', null)).toBe('paid');
		});

		it('should return stored tier when tierExpiresAt is in the future', () => {
			const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
			expect(computeEffectiveTier('paid', futureDate)).toBe('paid');
		});

		it('should fall back to registered when tierExpiresAt is in the past', () => {
			const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
			expect(computeEffectiveTier('paid', pastDate)).toBe('registered');
		});

		it('should fall back to registered for private tier when expired', () => {
			const pastDate = new Date(Date.now() - 1000).toISOString();
			expect(computeEffectiveTier('private', pastDate)).toBe('registered');
		});

		it('should return registered tier as-is regardless of expiration', () => {
			expect(computeEffectiveTier('registered', null)).toBe('registered');
		});
	});

	/* -------------------------------------------------------------- */
	/*  getProfile                                                    */
	/* -------------------------------------------------------------- */

	describe('getProfile', () => {
		it('should return complete profile with session record present', async () => {
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123',
				tierExpiresAt: null,
				createdAt: '2025-01-15T10:30:00.000Z'
			}]);
			mockGetSessionRecord.mockResolvedValue({
				pk: 'session-pk-hash',
				remaining: 42,
				limit: 100
			});

			const result = await getProfile('test@example.com', 'test-sub-123');

			expect(result.email).toBe('test@example.com');
			expect(result.tier).toBe('registered');
			expect(result.tierExpiresAt).toBeNull();
			expect(result.createdAt).toBe('2025-01-15T10:30:00.000Z');
			expect(result.rateLimits.limit).toBe(100);
			expect(result.rateLimits.remaining).toBe(42);
			expect(result.rateLimits.windowResetAt).toBe(29400 * 60);
			expect(result.rateLimits.windowMinutes).toBe(60);
		});

		it('should return full tier limit as remaining when no session record exists', async () => {
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123',
				tierExpiresAt: null,
				createdAt: '2025-01-15T10:30:00.000Z'
			}]);
			mockGetSessionRecord.mockResolvedValue(null);

			const result = await getProfile('test@example.com', 'test-sub-123');

			expect(result.rateLimits.remaining).toBe(100);
			expect(result.rateLimits.limit).toBe(100);
		});

		it('should compute effective tier as registered when tierExpiresAt is in the past', async () => {
			const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'expired@example.com',
				tier: 'paid',
				cognitoSub: 'expired-sub-789',
				tierExpiresAt: pastDate,
				createdAt: '2025-01-15T10:30:00.000Z'
			}]);
			mockGetSessionRecord.mockResolvedValue(null);

			const result = await getProfile('expired@example.com', 'expired-sub-789');

			// Effective tier should be 'registered' because tierExpiresAt is in the past
			expect(result.tier).toBe('registered');
			// Rate limits should match registered tier config
			expect(result.rateLimits.limit).toBe(100);
			expect(result.rateLimits.windowMinutes).toBe(60);
			// tierExpiresAt should still be returned as-is from the user record
			expect(result.tierExpiresAt).toBe(pastDate);
		});

		it('should use paid tier rate limits for active paid user', async () => {
			const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'paid@example.com',
				tier: 'paid',
				cognitoSub: 'paid-sub-456',
				tierExpiresAt: futureDate,
				createdAt: '2025-01-15T10:30:00.000Z'
			}]);
			mockGetSessionRecord.mockResolvedValue(null);

			const result = await getProfile('paid@example.com', 'paid-sub-456');

			expect(result.tier).toBe('paid');
			expect(result.rateLimits.limit).toBe(3000);
			expect(result.rateLimits.windowMinutes).toBe(1440);
			expect(result.rateLimits.remaining).toBe(3000);
		});

		it('should throw 404 when user not found', async () => {
			mockQueryByEmail.mockResolvedValue([]);

			await expect(getProfile('unknown@example.com', 'test-sub-456'))
				.rejects.toMatchObject({
					statusCode: 404,
					message: 'User not found'
				});

			// Verify no session or SSM calls made
			expect(mockGetSessionRecord).not.toHaveBeenCalled();
			expect(mockSettings.ssm.sessionHashSalt.getValue).not.toHaveBeenCalled();
		});

		it('should throw 404 when queryByEmail returns null', async () => {
			mockQueryByEmail.mockResolvedValue(null);

			await expect(getProfile('unknown@example.com', 'test-sub-456'))
				.rejects.toMatchObject({
					statusCode: 404,
					message: 'User not found'
				});
		});

		it('should call window calculator with correct tier window', async () => {
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123',
				tierExpiresAt: null,
				createdAt: '2025-01-15T10:30:00.000Z'
			}]);
			mockGetSessionRecord.mockResolvedValue(null);

			await getProfile('test@example.com', 'test-sub-123');

			expect(mockComputeWindowBoundaries).toHaveBeenCalledWith(60);
			expect(mockComputeSessionKey).toHaveBeenCalledWith(
				'test-sub-123',
				29340,
				'test-session-salt'
			);
		});

		it('should propagate DynamoDB errors', async () => {
			mockQueryByEmail.mockRejectedValue(new Error('DynamoDB connection error'));

			await expect(getProfile('test@example.com', 'test-sub-123'))
				.rejects.toThrow('DynamoDB connection error');
		});
	});
});
