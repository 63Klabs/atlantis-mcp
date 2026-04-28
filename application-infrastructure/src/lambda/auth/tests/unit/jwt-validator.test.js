// Feature: 0-0-3-add-authentication, Unit tests for JWT validator
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
const { clearJwksCache } = TestHarness.getInternals();

describe('JWT Validator', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, COGNITO_USER_POOL_ID: TEST_USER_POOL_ID };
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
	});

	afterEach(() => {
		process.env = originalEnv;
		jest.restoreAllMocks();
	});

	it('should validate a correctly signed JWT', async () => {
		const token = createTestJwt();
		const event = { headers: { Authorization: `Bearer ${token}` } };

		const payload = await validateJwt(event);

		expect(payload.sub).toBe('test-user-sub-123');
		expect(payload.email).toBe('test@example.com');
		expect(payload.token_use).toBe('id');
	});

	it('should accept access tokens', async () => {
		const token = createTestJwt({}, { token_use: 'access' });
		const event = { headers: { Authorization: `Bearer ${token}` } };

		const payload = await validateJwt(event);

		expect(payload.token_use).toBe('access');
	});

	it('should accept lowercase authorization header', async () => {
		const token = createTestJwt();
		const event = { headers: { authorization: `Bearer ${token}` } };

		const payload = await validateJwt(event);

		expect(payload.sub).toBe('test-user-sub-123');
	});

	it('should reject expired tokens', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createTestJwt({}, { exp: now - 3600 });
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Token expired' })
		);
	});

	it('should reject tokens with wrong issuer', async () => {
		const token = createTestJwt({}, { iss: 'https://evil.example.com' });
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Invalid token issuer' })
		);
	});

	it('should reject tokens with invalid token_use', async () => {
		const token = createTestJwt({}, { token_use: 'refresh' });
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Invalid token use' })
		);
	});

	it('should reject missing Authorization header', async () => {
		const event = { headers: {} };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Missing or invalid Authorization header' })
		);
	});

	it('should reject non-Bearer Authorization header', async () => {
		const event = { headers: { Authorization: 'Basic abc123' } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Missing or invalid Authorization header' })
		);
	});

	it('should reject malformed tokens (not 3 parts)', async () => {
		const event = { headers: { Authorization: 'Bearer not.a.valid.jwt.token' } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Malformed token' })
		);
	});

	it('should reject malformed tokens (invalid base64)', async () => {
		const event = { headers: { Authorization: 'Bearer !!!.!!!.!!!' } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Malformed token' })
		);
	});

	it('should reject tokens signed with unknown kid', async () => {
		const token = createTestJwt({ kid: 'unknown-kid' });
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Token signed with unknown key' })
		);
	});

	it('should reject when COGNITO_USER_POOL_ID is not set', async () => {
		delete process.env.COGNITO_USER_POOL_ID;
		const token = createTestJwt();
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Authentication not configured' })
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
		const event = { headers: { Authorization: `Bearer ${token}` } };

		await expect(validateJwt(event)).rejects.toEqual(
			expect.objectContaining({ statusCode: 401, message: 'Token missing key ID' })
		);
	});

	it('should cache JWKS and not refetch within TTL', async () => {
		// Clear call count from previous tests
		https.get.mockClear();

		const token1 = createTestJwt();
		const token2 = createTestJwt({}, { sub: 'second-user' });

		await validateJwt({ headers: { Authorization: `Bearer ${token1}` } });
		await validateJwt({ headers: { Authorization: `Bearer ${token2}` } });

		// https.get should only be called once (JWKS cached after first call)
		expect(https.get).toHaveBeenCalledTimes(1);
	});
});
