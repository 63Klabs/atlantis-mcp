// Bugfix: 0-0-3-auth-profile-401-after-login
// Property 1: Bug Condition — headerParameters Authorization Header Not Extracted
// This test encodes the EXPECTED behavior: validateJwt() should extract the
// Authorization header from props.headerParameters (the clientRequest.getProps()
// output structure). On UNFIXED code this test FAILS, confirming the bug exists.
'use strict';

const crypto = require('crypto');
const https = require('https');
const fc = require('fast-check');

// Generate a test RSA key pair for signing JWTs (same pattern as jwt-validator.test.js)
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Extract JWK components from the public key
const publicKeyObj = crypto.createPublicKey(publicKey);
const jwkExport = publicKeyObj.export({ format: 'jwk' });

const TEST_KID = 'test-kid-header-source';
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
 * Create a signed JWT for testing with the given email and sub claims.
 *
 * @param {string} email - Email claim for the JWT payload
 * @param {string} sub - Subject claim for the JWT payload
 * @returns {string} Signed JWT string
 */
function createTestJwt(email, sub) {
	const header = {
		alg: 'RS256',
		typ: 'JWT',
		kid: TEST_KID
	};

	const now = Math.floor(Date.now() / 1000);
	const payload = {
		sub,
		email,
		iss: TEST_ISSUER,
		token_use: 'id',
		iat: now - 60,
		exp: now + 3600
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

describe('Property 1: Bug Condition — headerParameters Authorization Header Not Extracted', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		clearJwksCache();

		// Mock https.get to return test JWKS (same pattern as unit tests)
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

	/**
	 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
	 *
	 * For any generated email and sub, a valid JWT placed in
	 * props.headerParameters.authorization (camelCase, matching getProps() output)
	 * should be extracted and validated, returning the correct claims.
	 *
	 * On UNFIXED code this FAILS with:
	 *   { statusCode: 401, message: 'Missing or invalid Authorization header' }
	 * because validateJwt() only checks props.headers, not props.headerParameters.
	 */
	it('should extract Authorization from headerParameters.authorization (camelCase)', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.emailAddress(),
				fc.string({ minLength: 1, maxLength: 64 }),
				async (email, sub) => {
					clearJwksCache();

					const token = createTestJwt(email, sub);
					const props = {
						headerParameters: {
							authorization: `Bearer ${token}`
						}
					};

					const payload = await validateJwt(props, TEST_USER_POOL_ID);

					expect(payload.email).toBe(email);
					expect(payload.sub).toBe(sub);
					expect(payload.token_use).toBe('id');
				}
			),
			{ numRuns: 20 }
		);
	});

	/**
	 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
	 *
	 * PascalCase variant: props.headerParameters.Authorization should also work.
	 *
	 * On UNFIXED code this FAILS with the same 401 error.
	 */
	it('should extract Authorization from headerParameters.Authorization (PascalCase)', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.emailAddress(),
				fc.string({ minLength: 1, maxLength: 64 }),
				async (email, sub) => {
					clearJwksCache();

					const token = createTestJwt(email, sub);
					const props = {
						headerParameters: {
							Authorization: `Bearer ${token}`
						}
					};

					const payload = await validateJwt(props, TEST_USER_POOL_ID);

					expect(payload.email).toBe(email);
					expect(payload.sub).toBe(sub);
					expect(payload.token_use).toBe('id');
				}
			),
			{ numRuns: 20 }
		);
	});
});


// ============================================================================
// Property 2: Preservation — Existing headers Path and Rejection Behavior
// These tests MUST PASS on UNFIXED code, confirming baseline behavior to preserve.
// ============================================================================

/**
 * Create a signed JWT with a custom expiration timestamp.
 * Used by Property 2c to generate expired JWTs.
 *
 * @param {string} email - Email claim for the JWT payload
 * @param {string} sub - Subject claim for the JWT payload
 * @param {number} exp - Expiration timestamp (seconds since epoch)
 * @returns {string} Signed JWT string
 */
function createTestJwtWithExp(email, sub, exp) {
	const header = {
		alg: 'RS256',
		typ: 'JWT',
		kid: TEST_KID
	};

	const now = Math.floor(Date.now() / 1000);
	const payload = {
		sub,
		email,
		iss: TEST_ISSUER,
		token_use: 'id',
		iat: now - 60,
		exp
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

describe('Property 2: Preservation — Existing headers Path and Rejection Behavior Unchanged', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		clearJwksCache();

		// Mock https.get to return test JWKS (same pattern as unit tests)
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

	describe('Property 2a — headers.Authorization path preserved', () => {
		/**
		 * **Validates: Requirements 3.1, 3.2**
		 *
		 * For any generated email and sub, a valid JWT placed in
		 * props.headers.Authorization (PascalCase) should be extracted
		 * and validated, returning the correct email and sub claims.
		 *
		 * This tests the existing read Lambda path that already works
		 * on unfixed code and must remain unchanged after the fix.
		 */
		it('should extract and validate JWT from headers.Authorization (PascalCase)', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.emailAddress(),
					fc.string({ minLength: 1, maxLength: 64 }),
					async (email, sub) => {
						clearJwksCache();

						const token = createTestJwt(email, sub);
						const props = {
							headers: {
								Authorization: `Bearer ${token}`
							}
						};

						const payload = await validateJwt(props, TEST_USER_POOL_ID);

						expect(payload.email).toBe(email);
						expect(payload.sub).toBe(sub);
						expect(payload.token_use).toBe('id');
					}
				),
				{ numRuns: 20 }
			);
		});

		/**
		 * **Validates: Requirements 3.1, 3.2**
		 *
		 * For any generated email and sub, a valid JWT placed in
		 * props.headers.authorization (camelCase/lowercase) should be
		 * extracted and validated, returning the correct email and sub claims.
		 */
		it('should extract and validate JWT from headers.authorization (camelCase)', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.emailAddress(),
					fc.string({ minLength: 1, maxLength: 64 }),
					async (email, sub) => {
						clearJwksCache();

						const token = createTestJwt(email, sub);
						const props = {
							headers: {
								authorization: `Bearer ${token}`
							}
						};

						const payload = await validateJwt(props, TEST_USER_POOL_ID);

						expect(payload.email).toBe(email);
						expect(payload.sub).toBe(sub);
						expect(payload.token_use).toBe('id');
					}
				),
				{ numRuns: 20 }
			);
		});
	});

	describe('Property 2b — Missing header detection preserved', () => {
		/**
		 * **Validates: Requirements 3.1, 3.3**
		 *
		 * For any props object where headers has no Authorization key
		 * (empty object, undefined headers, or missing key), validateJwt()
		 * should throw { statusCode: 401, message: 'Missing or invalid Authorization header' }.
		 *
		 * Uses fast-check to generate various props shapes that lack an
		 * Authorization header in the headers property.
		 */
		it('should throw 401 for props with no Authorization in headers', async () => {
			// Generate props objects that have no Authorization header
			const propsWithoutAuth = fc.oneof(
				// Empty headers object
				fc.constant({ headers: {} }),
				// Props with no headers property at all
				fc.constant({}),
				// Headers with unrelated keys but no Authorization
				fc.dictionary(
					fc.string({ minLength: 1, maxLength: 20 }).filter(
						(k) => k.toLowerCase() !== 'authorization'
					),
					fc.string({ minLength: 1, maxLength: 50 })
				).map((dict) => ({ headers: dict }))
			);

			await fc.assert(
				fc.asyncProperty(
					propsWithoutAuth,
					async (props) => {
						clearJwksCache();

						await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
							expect.objectContaining({
								statusCode: 401,
								message: 'Missing or invalid Authorization header'
							})
						);
					}
				),
				{ numRuns: 20 }
			);
		});
	});

	describe('Property 2c — JWT validation pipeline preserved', () => {
		/**
		 * **Validates: Requirements 3.2, 3.5, 3.6**
		 *
		 * For any generated expired timestamp (in the past), an expired JWT
		 * passed via props.headers should throw { statusCode: 401, message: 'Token expired' }.
		 *
		 * This confirms the JWT validation pipeline (signature verification,
		 * expiration check) is preserved on the existing headers path.
		 */
		it('should throw Token expired for expired JWTs via headers', async () => {
			const now = Math.floor(Date.now() / 1000);

			await fc.assert(
				fc.asyncProperty(
					fc.emailAddress(),
					fc.string({ minLength: 1, maxLength: 64 }),
					// Generate expiration timestamps 1 to 86400 seconds in the past
					fc.integer({ min: 1, max: 86400 }),
					async (email, sub, secondsAgo) => {
						clearJwksCache();

						const expiredExp = now - secondsAgo;
						const token = createTestJwtWithExp(email, sub, expiredExp);
						const props = {
							headers: {
								Authorization: `Bearer ${token}`
							}
						};

						await expect(validateJwt(props, TEST_USER_POOL_ID)).rejects.toEqual(
							expect.objectContaining({
								statusCode: 401,
								message: 'Token expired'
							})
						);
					}
				),
				{ numRuns: 20 }
			);
		});
	});
});
