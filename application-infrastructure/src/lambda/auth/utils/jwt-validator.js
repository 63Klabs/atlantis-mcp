/**
 * JWT Validator Utility for Cognito Tokens
 *
 * Validates Cognito JWTs from the Authorization header by verifying
 * the signature against the Cognito JWKS endpoint, checking expiration,
 * issuer, and token_use claims.
 *
 * Uses Node.js built-in `crypto` and `https` modules — no external
 * JWT libraries required.
 *
 * @module utils/jwt-validator
 */

'use strict';

const crypto = require('crypto');
const https = require('https');

/** @type {Object|null} Cached JWKS keys, keyed by kid */
let jwksCache = null;

/** @type {number} Timestamp when JWKS cache was last refreshed */
let jwksCacheTime = 0;

/** JWKS cache TTL in milliseconds (1 hour) */
const JWKS_CACHE_TTL = 60 * 60 * 1000;

/**
 * Fetch JWKS from the Cognito endpoint.
 *
 * @private
 * @param {string} userPoolId - Cognito User Pool ID (e.g. us-east-1_abc123)
 * @returns {Promise<Object>} JWKS keys keyed by kid
 */
function fetchJwks(userPoolId) {
	const region = userPoolId.split('_')[0];
	const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				try {
					const jwks = JSON.parse(data);
					const keyMap = {};
					for (const key of jwks.keys) {
						keyMap[key.kid] = key;
					}
					resolve(keyMap);
				} catch (err) {
					reject(new Error('Failed to parse JWKS response'));
				}
			});
			res.on('error', reject);
		}).on('error', reject);
	});
}

/**
 * Get cached JWKS keys, refreshing if expired.
 *
 * @private
 * @param {string} userPoolId - Cognito User Pool ID
 * @returns {Promise<Object>} JWKS keys keyed by kid
 */
async function getJwks(userPoolId) {
	const now = Date.now();
	if (jwksCache && (now - jwksCacheTime) < JWKS_CACHE_TTL) {
		return jwksCache;
	}
	jwksCache = await fetchJwks(userPoolId);
	jwksCacheTime = now;
	return jwksCache;
}

/**
 * Base64url decode a string to a Buffer.
 *
 * @private
 * @param {string} str - Base64url-encoded string
 * @returns {Buffer} Decoded buffer
 */
function base64urlDecode(str) {
	// >! Replace URL-safe chars and add padding for standard base64
	const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const padding = (4 - (base64.length % 4)) % 4;
	return Buffer.from(base64 + '='.repeat(padding), 'base64');
}

/**
 * Convert a JWK RSA key to a PEM public key.
 *
 * @private
 * @param {Object} jwk - JWK object with n and e fields
 * @returns {string} PEM-encoded public key
 */
function jwkToPem(jwk) {
	const n = base64urlDecode(jwk.n);
	const e = base64urlDecode(jwk.e);

	// Build DER-encoded RSA public key
	const nBytes = encodeUnsignedInteger(n);
	const eBytes = encodeUnsignedInteger(e);

	const rsaSequence = derSequence(Buffer.concat([nBytes, eBytes]));
	const bitString = derBitString(rsaSequence);
	const algorithmId = Buffer.from(
		'300d06092a864886f70d0101010500', 'hex'
	);
	const publicKeyInfo = derSequence(Buffer.concat([algorithmId, bitString]));

	const base64Key = publicKeyInfo.toString('base64');
	const lines = base64Key.match(/.{1,64}/g) || [];
	return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Encode a buffer as a DER unsigned integer.
 *
 * @private
 * @param {Buffer} buf - Raw integer bytes
 * @returns {Buffer} DER-encoded integer
 */
function encodeUnsignedInteger(buf) {
	// Add leading zero if high bit is set (to keep it positive)
	if (buf[0] & 0x80) {
		buf = Buffer.concat([Buffer.from([0x00]), buf]);
	}
	return Buffer.concat([Buffer.from([0x02]), derLength(buf.length), buf]);
}

/**
 * Encode a DER length field.
 *
 * @private
 * @param {number} length - Length value
 * @returns {Buffer} DER-encoded length
 */
function derLength(length) {
	if (length < 0x80) {
		return Buffer.from([length]);
	}
	const bytes = [];
	let temp = length;
	while (temp > 0) {
		bytes.unshift(temp & 0xff);
		temp >>= 8;
	}
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Wrap content in a DER SEQUENCE.
 *
 * @private
 * @param {Buffer} content - Content to wrap
 * @returns {Buffer} DER SEQUENCE
 */
function derSequence(content) {
	return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

/**
 * Wrap content in a DER BIT STRING.
 *
 * @private
 * @param {Buffer} content - Content to wrap
 * @returns {Buffer} DER BIT STRING
 */
function derBitString(content) {
	const withPadding = Buffer.concat([Buffer.from([0x00]), content]);
	return Buffer.concat([Buffer.from([0x03]), derLength(withPadding.length), withPadding]);
}

/**
 * Extract the Bearer token from an Authorization header value.
 *
 * @private
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token string or null if not a Bearer token
 */
function extractBearerToken(authHeader) {
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return null;
	}
	return authHeader.slice(7).trim();
}

/**
 * Validate a Cognito JWT from the Authorization header.
 *
 * Verifies the token signature against the Cognito JWKS endpoint,
 * checks expiration, issuer, and token_use claims.
 *
 * @param {Object} event - API Gateway event
 * @param {Object} event.headers - Request headers
 * @param {string} event.headers.Authorization - Bearer JWT token
 * @returns {Promise<Object>} Decoded token payload
 * @throws {Object} Error with statusCode 401 and message
 * @example
 * try {
 *   const payload = await validateJwt(event);
 *   // payload: { sub: 'abc-123', email: 'user@example.com', ... }
 * } catch (err) {
 *   // err: { statusCode: 401, message: 'Unauthorized' }
 * }
 */
async function validateJwt(event) {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	if (!userPoolId) {
		throw { statusCode: 401, message: 'Authentication not configured' };
	}

	const authHeader = event.headers?.Authorization || event.headers?.authorization;
	const token = extractBearerToken(authHeader);
	if (!token) {
		throw { statusCode: 401, message: 'Missing or invalid Authorization header' };
	}

	// Decode header and payload without verification first
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw { statusCode: 401, message: 'Malformed token' };
	}

	let header;
	let payload;
	try {
		header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
		payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
	} catch (err) {
		throw { statusCode: 401, message: 'Malformed token' };
	}

	// Verify kid exists in header
	if (!header.kid) {
		throw { statusCode: 401, message: 'Token missing key ID' };
	}

	// Fetch JWKS and find matching key
	const jwks = await getJwks(userPoolId);
	const jwk = jwks[header.kid];
	if (!jwk) {
		throw { statusCode: 401, message: 'Token signed with unknown key' };
	}

	// Verify signature
	const pem = jwkToPem(jwk);
	const signatureInput = `${parts[0]}.${parts[1]}`;
	const signature = base64urlDecode(parts[2]);

	const isValid = crypto.createVerify('RSA-SHA256')
		.update(signatureInput)
		.verify(pem, signature);

	if (!isValid) {
		throw { statusCode: 401, message: 'Invalid token signature' };
	}

	// Verify expiration
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp && payload.exp < now) {
		throw { statusCode: 401, message: 'Token expired' };
	}

	// Verify issuer
	const region = userPoolId.split('_')[0];
	const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
	if (payload.iss !== expectedIssuer) {
		throw { statusCode: 401, message: 'Invalid token issuer' };
	}

	// Verify token_use (accept both 'id' and 'access' tokens)
	if (payload.token_use !== 'id' && payload.token_use !== 'access') {
		throw { statusCode: 401, message: 'Invalid token use' };
	}

	return payload;
}

/**
 * Clear the cached JWKS keys. Useful for testing.
 *
 * @private
 */
function clearJwksCache() {
	jwksCache = null;
	jwksCacheTime = 0;
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal functions for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{fetchJwks: Function, getJwks: Function, base64urlDecode: Function, jwkToPem: Function, extractBearerToken: Function, clearJwksCache: Function}} Object containing internal functions
	 * @private
	 */
	static getInternals() {
		return {
			fetchJwks,
			getJwks,
			base64urlDecode,
			jwkToPem,
			extractBearerToken,
			clearJwksCache
		};
	}
}

module.exports = {
	validateJwt,
	TestHarness
};
