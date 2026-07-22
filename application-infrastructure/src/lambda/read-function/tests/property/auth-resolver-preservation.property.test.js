/**
 * Preservation Property Tests for Auth Resolver
 *
 * Feature: 0-0-4-key-hashing-for-auth, Property 2: Preservation
 *
 * These tests verify that non-hashing code paths work correctly
 * BEFORE the fix is applied. They must PASS on unfixed code.
 *
 * Preservation Test A: No-key requests return public tier
 * Preservation Test B: Tier computation unchanged
 * Preservation Test C: Key generation format unchanged
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.8, 3.9
 */

'use strict';

const fc = require('fast-check');

// Mock the @63klabs/cache-data module BEFORE requiring auth-resolver
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
		AWS: {
			dynamo: {
				get: jest.fn(),
				update: jest.fn()
			}
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn()
		}))
	}
}));

const { resolveAuth, TestHarness } = require('../../utils/auth-resolver');
const { computeEffectiveTier } = TestHarness.getInternals();
const { generateApiKey } = require('../../../auth-function/utils/api-key');

/* ------------------------------------------------------------------ */
/*  Preservation Test A: No-key requests return public tier           */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.1
 *
 * Preservation Test A: No-key requests return public tier
 *
 * For any request with no API key header, the auth resolver SHALL
 * return a public-tier result with isAuthenticated: false, the
 * client's source IP as identity, and degraded: false.
 */
describe('Preservation Test A: No-key requests return public tier', () => {

	it('for all events with no API key header, result has public tier properties', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.ipV4(),
				async (sourceIp) => {
					const event = {
						headers: {},
						requestContext: { identity: { sourceIp } }
					};

					const result = await resolveAuth(event);

					expect(result.tier).toBe('public');
					expect(result.isAuthenticated).toBe(false);
					expect(result.identity).toBe(sourceIp);
					expect(result.degraded).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Preservation Test B: Tier computation unchanged                   */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.9
 *
 * Preservation Test B: Tier computation unchanged
 *
 * For any stored tier and tierExpiresAt value:
 * - tierExpiresAt null/undefined → effective tier equals stored tier
 * - tierExpiresAt in the future → effective tier equals stored tier
 * - tierExpiresAt in the past → effective tier is 'registered'
 */
describe('Preservation Test B: Tier computation unchanged', () => {

	const nowSec = Math.floor(Date.now() / 1000);

	it('tierExpiresAt null or undefined returns stored tier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				(storedTier) => {
					const resultNull = computeEffectiveTier(storedTier, null);
					const resultUndefined = computeEffectiveTier(storedTier, undefined);

					expect(resultNull).toBe(storedTier);
					expect(resultUndefined).toBe(storedTier);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt in the future returns stored tier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				fc.integer({ min: nowSec + 60, max: nowSec + 365 * 24 * 60 * 60 }),
				(storedTier, expiresAt) => {
					const result = computeEffectiveTier(storedTier, expiresAt);
					expect(result).toBe(storedTier);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt in the past returns registered', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				fc.integer({ min: nowSec - 365 * 24 * 60 * 60, max: nowSec - 60 }),
				(storedTier, expiresAt) => {
					const result = computeEffectiveTier(storedTier, expiresAt);
					expect(result).toBe('registered');
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Preservation Test C: Key generation format unchanged              */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.8
 *
 * Preservation Test C: Key generation format unchanged
 *
 * generateApiKey() SHALL continue to return a key in the format
 * `atl_` followed by 32 random hex characters (total length 36).
 * Each generated key must be unique.
 */
describe('Preservation Test C: Key generation format unchanged', () => {

	it('every generated key matches format, has length 36, and keys are unique', () => {
		const generatedKeys = new Set();

		fc.assert(
			fc.property(
				fc.constant(null),
				() => {
					const key = generateApiKey();

					expect(key).toMatch(/^atl_[0-9a-f]{32}$/);
					expect(key).toHaveLength(36);
					expect(generatedKeys.has(key)).toBe(false);

					generatedKeys.add(key);
				}
			),
			{ numRuns: 100 }
		);
	});
});
