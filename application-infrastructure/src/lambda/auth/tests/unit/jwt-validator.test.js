// Feature: 0-0-3-update-auth-function-to-use-cache-data, Unit tests for JWT validator
// Tests the parameter-based User Pool ID approach and env var fallback
'use strict';

const crypto = require('crypto');
const https = require('https');

// Generate a test RSA key pair for signing JWTs
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Extract JWK components from the public key
const publicKeyObj = crypto.createPublicKey(publicKey);
const jwkExport = publicKeyObj.export({ format: 'jwk' });

const TEST_KID = 'test-kid-001';
const TEST_USER_POOL_ID = 'us-east-1_TestPool123';
const TEST_ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${TEST_USER_POOL_ID}`;

const mockJwks = {
	keys: [
		{
			kty: 'RSA',
			kid: TEST_KID,
			use: 'sig',
			alg: 'RS256',
			n: jwkExport.n,
			e: jwkExport.e
		}
	]
};

/**
 * Create a base64url-encoded string from a buffer or string.
 *
 * @param {Buffer|string} input - Data to encode
 * @returns {string} Base64url-encoded string
 */
function base64urlEncode(input) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
	return buf.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * Create a signed JWT for testing.
 *
 * @param {Object} headerOverrides - Header field overrides
 * @param {Object} payloadOverrides - Payload field overrides
 * @returns {string} Signed JWT string
 */
function createTestJwt(headerOverrides = {}, payloadOverrides = {}) {
	const header = {
		alg: 'RS256',
		typ: 'JWT',
		kid: TEST_KID,
		...headerOverrides
	};

	const now = Math.floor(Date.now() / 1000);
	const payload = {
		sub: 'test-user-sub-123',
		email: 'test@example.com',
		iss: TEST_ISSUER,
		token_use: 'id',
		iat: now - 60,
		exp: now + 3600,
		...payloadOverrides
	};

	const headerB64 = base64urlEncode(JSON.stringify(header));
	const payloadB64 = base64urlEncode(JSON.stringify(payload));
	const signatureInput = `${headerB64}.${payloadB64}`;

	const signature = crypto.createSign('RSA-SHA256')
		.update(signatureInput)
		.sign(privateKey);

	const signatureB64 = base64urlEncode(signature);
	return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// Mock https.get to return our test JWKS
jest.mock('https', () => {
	const original = jest.requireActual('https');
	return {
		...original,
		get: jest.fn()
	};
});

const { validateJwt, TestHarness } = require('../../utils/jwt-validator');
const { clearJwksCache, resolveUserPoolId } = TestHarness.getInternals();

describe('JWT Validator', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		clearJwksCache();

		// Mock https.get to return test JWKS
		https.get.mockImplementation((url, callback) => {
			const res = {
				on: jest.fn((event, handler) => {
					if (event === 'data') {
						handler(JSON.stringify(mockJwks));
					}
					if (event === 'end') {
						handler();
					}
					return res;
				})
			};
			callback(res);
			return { on: jest.fn() };
		});

		jest.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
		jest.restoreAllMocks();
	});

	describe('with User Pool ID passed as parameter', () => {
		it('should validate a correctly signed JWT', async () => {
			const token = createTestJwt();
			const props = { headers: { Authorization: `Bearer ${token}` } };

			const payload = await validateJwt(props, TEST_USER_POOL_ID);

			expect(payload.sub).toBe('test-user-sub-123');
			expect(payload.email).toBe('test@example.com');
			expect(payload.token_use).toBe('id');
		});

		it('should accept access tokens', async () => {
			const token = createTestJwt({}, { token_use: 'access' });
			const props = { headers: { Authorization: `Bearer ${token}` } };

			const payload = await validateJwt(props, TEST_USER_POOL_ID);

			expect(payload.token_use).toBe('access');
		});

		it('should accept lowercase authorization header', async () => {
			const token = createTestJwt();
			const props = { headers: { authorization: `Bearer ${token}` } };

			const payload = await validateJwt(props, TEST_USER_POOL_ID);

			expect(payload.sub).toBe('test-user-sub-123');
		});

		it('should reject expired tokens', async () => {
			const now = Math.floor(Date.now() / 1000);
			const token = createTestJwt({}, { exp: now - 3600 });
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Token expired' })
			);
		});

		it('should reject tokens with wrong issuer', async () => {
			const token = createTestJwt({}, { iss: 'https://evil.example.com' });
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Invalid token issuer' })
			);
		});

		it('should reject tokens with invalid token_use', async () => {
			const token = createTestJwt({}, { token_use: 'refresh' });
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Invalid token use' })
			);
		});

		it('should reject missing Authorization header', async () => {
			const props = { headers: {} };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Missing or invalid Authorization header' })
			);
		});

		it('should reject non-Bearer Authorization header', async () => {
			const props = { headers: { Authorization: 'Basic abc123' } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Missing or invalid Authorization header' })
			);
		});

		it('should reject malformed tokens (not 3 parts)', async () => {
			const props = { headers: { Authorization: 'Bearer not.a.valid.jwt.token' } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Malformed token' })
			);
		});

		it('should reject malformed tokens (invalid base64)', async () => {
			const props = { headers: { Authorization: 'Bearer !!!.!!!.!!!' } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Malformed token' })
			);
		});

		it('should reject tokens signed with unknown kid', async () => {
			const token = createTestJwt({ kid: 'unknown-kid' });
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Token signed with unknown key' })
			);
		});

		it('should reject tokens with missing kid in header', async () => {
			// Build a token manually without kid
			const header = { alg: 'RS256', typ: 'JWT' };
			const now = Math.floor(Date.now() / 1000);
			const payload = {
				sub: 'test', iss: TEST_ISSUER, token_use: 'id',
				iat: now - 60, exp: now + 3600
			};
			const headerB64 = base64urlEncode(JSON.stringify(header));
			const payloadB64 = base64urlEncode(JSON.stringify(payload));
			const sig = crypto.createSign('RSA-SHA256')
				.update(`${headerB64}.${payloadB64}`)
				.sign(privateKey);
			const token = `${headerB64}.${payloadB64}.${base64urlEncode(sig)}`;
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Token missing key ID' })
			);
		});

		it('should cache JWKS and not refetch within TTL', async () => {
			// Clear call count from previous tests
			https.get.mockClear();

			const token1 = createTestJwt();
			const token2 = createTestJwt({}, { sub: 'second-user' });

			await validateJwt({ headers: { Authorization: `Bearer ${token1}` } }, TEST_USER_POOL_ID);
			await validateJwt({ headers: { Authorization: `Bearer ${token2}` } }, TEST_USER_POOL_ID);

			// https.get should only be called once (JWKS cached after first call)
			expect(https.get).toHaveBeenCalledTimes(1);
		});
	});

	describe('User Pool ID fallback behavior', () => {
		it('should use env var when no userPoolId parameter is provided', async () => {
			process.env.COGNITO_USER_POOL_ID = TEST_USER_POOL_ID;
			const token = createTestJwt();
			const props = { headers: { Authorization: `Bearer ${token}` } };

			const payload = await validateJwt(props);

			expect(payload.sub).toBe('test-user-sub-123');
			expect(payload.email).toBe('test@example.com');
		});

		it('should prefer explicit parameter over env var', async () => {
			process.env.COGNITO_USER_POOL_ID = 'us-east-1_WrongPool';
			const token = createTestJwt();
			const props = { headers: { Authorization: `Bearer ${token}` } };

			// Pass the correct pool ID as parameter — should succeed
			const payload = await validateJwt(props, TEST_USER_POOL_ID);

			expect(payload.sub).toBe('test-user-sub-123');
		});

		it('should throw 401 when no userPoolId param and no env var', async () => {
			delete process.env.COGNITO_USER_POOL_ID;
			const token = createTestJwt();
			const props = { headers: { Authorization: `Bearer ${token}` } };

			await expect(validateJwt(props)).rejects.toEqual(
				expect.objectContaining({ statusCode: 401, message: 'Authentication not configured' })
			);
		});
	});

	describe('resolveUserPoolId', () => {
		it('should return the parameter when provided', () => {
			const result = resolveUserPoolId('us-east-1_MyPool');
			expect(result).toBe('us-east-1_MyPool');
		});

		it('should return env var when parameter is undefined', () => {
			process.env.COGNITO_USER_POOL_ID = 'us-east-1_EnvPool';
			const result = resolveUserPoolId(undefined);
			expect(result).toBe('us-east-1_EnvPool');
		});

		it('should return env var when parameter is null', () => {
			process.env.COGNITO_USER_POOL_ID = 'us-east-1_EnvPool';
			const result = resolveUserPoolId(null);
			expect(result).toBe('us-east-1_EnvPool');
		});

		it('should throw when no parameter and no env var', () => {
			delete process.env.COGNITO_USER_POOL_ID;
			expect(() => resolveUserPoolId(undefined)).toThrow(
				expect.objectContaining({ statusCode: 401, message: 'Authentication not configured' })
			);
		});
	});
});
