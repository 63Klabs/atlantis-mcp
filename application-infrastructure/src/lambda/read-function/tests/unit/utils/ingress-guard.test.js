/**
 * Unit tests for utils/ingress-guard (Read Function).
 *
 * Spec: 0-0-7-rate-limit-client-ip-spoofing, Part B (Requirements 6.1 to 6.10, 10.5).
 *
 * The helper decides only whether the guard applies and what the refusal looks like. The
 * verification itself is cache-data's (`ClientRequest.isIngressVerified()`), so the first
 * half of this file uses a stand-in with that one method, and the second half uses the real
 * cache-data `ClientRequest` and `Response` (nothing mocked) to show the refusal that a
 * client would receive.
 *
 * @module tests/unit/utils/ingress-guard
 */
'use strict';

const fc = require('fast-check');
const IngressGuard = require('../../../utils/ingress-guard');

const ENV_NAME = 'CACHE_DATA_INGRESS_SECRET_NAME';

/**
 * Build a stand-in for ClientRequest with only the verified-origin method.
 *
 * @param {boolean} verified - What isIngressVerified() answers
 * @returns {{isIngressVerified: jest.Mock}} Stand-in client request
 */
function standIn(verified) {
	return { isIngressVerified: jest.fn().mockReturnValue(verified) };
}

/**
 * Build a stand-in for Response that records what the refusal sets.
 *
 * @returns {Object} Stand-in response with recording mocks
 */
function recordingResponse() {
	return {
		setStatusCode: jest.fn().mockReturnThis(),
		addHeader: jest.fn().mockReturnThis(),
		setBody: jest.fn().mockReturnThis(),
		finalize: jest.fn().mockReturnValue({ statusCode: 401 })
	};
}

describe('ingress-guard: isIngressGuardOn', () => {
	test.each([
		['a secret name', { [ENV_NAME]: 'acme-mcp-test-OriginSecret' }, true],
		['a secret ARN', { [ENV_NAME]: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x-AbCdEf' }, true],
		['a name with surrounding spaces', { [ENV_NAME]: '  acme-secret  ' }, true],
		['unset', {}, false],
		['empty', { [ENV_NAME]: '' }, false],
		['blank', { [ENV_NAME]: '   \t ' }, false],
		['not a string', { [ENV_NAME]: 42 }, false]
	])('is %s => %s', (_label, env, expected) => {
		expect(IngressGuard.isIngressGuardOn(env)).toBe(expected);
	});

	test('does not throw for a missing environment object', () => {
		expect(IngressGuard.isIngressGuardOn(undefined)).toBe(false);
		expect(IngressGuard.isIngressGuardOn(null)).toBe(false);
	});

	test('reads process.env when no argument is given', () => {
		const saved = process.env[ENV_NAME];
		try {
			delete process.env[ENV_NAME];
			expect(IngressGuard.isIngressGuardOn()).toBe(false);
			process.env[ENV_NAME] = 'some-secret';
			expect(IngressGuard.isIngressGuardOn()).toBe(true);
		} finally {
			if (saved === undefined) {
 delete process.env[ENV_NAME];
} else {
 process.env[ENV_NAME] = saved;
}
		}
	});
});

describe('ingress-guard: shouldRefuse', () => {
	const on = { [ENV_NAME]: 'acme-secret' };

	test('protection off: never refuses and never asks cache-data', () => {
		const verifiedFalse = standIn(false);
		expect(IngressGuard.shouldRefuse(verifiedFalse, {})).toBe(false);
		expect(IngressGuard.shouldRefuse(verifiedFalse, { [ENV_NAME]: '  ' })).toBe(false);
		expect(verifiedFalse.isIngressVerified).not.toHaveBeenCalled();
	});

	test('protection on and verified: does not refuse', () => {
		expect(IngressGuard.shouldRefuse(standIn(true), on)).toBe(false);
	});

	test('protection on and unverified: refuses', () => {
		expect(IngressGuard.shouldRefuse(standIn(false), on)).toBe(true);
	});

	test('protection on and a client request that cannot answer: fails closed', () => {
		expect(IngressGuard.shouldRefuse({}, on)).toBe(true);
		expect(IngressGuard.shouldRefuse(null, on)).toBe(true);
		expect(IngressGuard.shouldRefuse(undefined, on)).toBe(true);
	});

	test('protection on and isIngressVerified throws: fails closed', () => {
		const throwing = { isIngressVerified: () => {
 throw new Error('boom');
} };
		expect(IngressGuard.shouldRefuse(throwing, on)).toBe(true);
	});

	test('anything other than boolean true is not verified', () => {
		expect(IngressGuard.shouldRefuse({ isIngressVerified: () => 'yes' }, on)).toBe(true);
		expect(IngressGuard.shouldRefuse({ isIngressVerified: () => 1 }, on)).toBe(true);
		expect(IngressGuard.shouldRefuse({ isIngressVerified: () => undefined }, on)).toBe(true);
	});

	/**
	 * Property: refusal iff protection is on and the request is not verified.
	 * **Validates: Requirements 6.2, 6.3, 6.7, 6.8, 10.5**
	 */
	test('property: refuses if and only if the flag is on and the request is unverified', () => {
		fc.assert(
			fc.property(fc.boolean(), fc.boolean(), (flagOn, verified) => {
				const env = flagOn ? { [ENV_NAME]: 'acme-secret' } : {};
				const client = standIn(verified);
				const refused = IngressGuard.shouldRefuse(client, env);
				expect(refused).toBe(flagOn && !verified);
				// With the flag off cache-data is not consulted at all.
				if (!flagOn) {
 expect(client.isIngressVerified).not.toHaveBeenCalled();
}
			}),
			{ numRuns: 50 }
		);
	});
});

describe('ingress-guard: buildRefusal', () => {
	test('sets 401, no-store, and a plain JSON message, then finalizes once', () => {
		const response = recordingResponse();
		const result = IngressGuard.buildRefusal(response);

		expect(response.setStatusCode).toHaveBeenCalledWith(401);
		expect(response.addHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
		expect(response.setBody).toHaveBeenCalledWith({ message: 'Requests must use the service endpoint.' });
		expect(response.finalize).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ statusCode: 401 });
	});

	test('the status is 401 and never 403 or 404 (the Edge rewrites those to the landing page)', () => {
		expect(IngressGuard.REFUSAL_STATUS_CODE).toBe(401);
		expect([403, 404]).not.toContain(IngressGuard.REFUSAL_STATUS_CODE);
	});

	test('the message is a non-empty string and carries no secret, identifier, ARN, stage, or address', () => {
		const message = IngressGuard.REFUSAL_MESSAGE;
		expect(typeof message).toBe('string');
		expect(message.length).toBeGreaterThan(0);
		expect(message).not.toMatch(/secret|arn:|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|test|beta|prod|origin/i);
	});

	test('sets no max-age and no other header', () => {
		const response = recordingResponse();
		IngressGuard.buildRefusal(response);
		expect(response.addHeader).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(response.addHeader.mock.calls)).not.toMatch(/max-age/i);
	});
});

describe('ingress-guard with the real cache-data ClientRequest and Response', () => {
	const { tools: { ClientRequest, Response } } = require('@63klabs/cache-data');
	const HEADER_VALUE = 'header-value-that-must-never-be-echoed';
	let savedEnv;

	/**
	 * Build a REST API proxy event that carries a (wrong) origin-secret header.
	 *
	 * @returns {Object} API Gateway event
	 */
	function buildEvent() {
		return {
			httpMethod: 'POST',
			path: '/mcp/v1',
			headers: { 'X-Atlantis-Origin-Secret': HEADER_VALUE },
			queryStringParameters: null,
			body: '{}',
			requestContext: { requestId: 'req-1', identity: { sourceIp: '203.0.113.77' } }
		};
	}

	const context = { awsRequestId: 'aws-1', getRemainingTimeInMillis: () => 30000 };

	beforeEach(() => {
 savedEnv = process.env[ENV_NAME];
});
	afterEach(() => {
		if (savedEnv === undefined) {
 delete process.env[ENV_NAME];
} else {
 process.env[ENV_NAME] = savedEnv;
}
	});

	test('protection on, secret not primed (unverified): the refusal is a JSON 401 with no-store and CORS', () => {
		process.env[ENV_NAME] = 'acme-mcp-test-OriginSecret';
		const clientRequest = new ClientRequest(buildEvent(), context);
		const response = new Response(clientRequest);

		expect(IngressGuard.shouldRefuse(clientRequest, process.env)).toBe(true);
		const result = IngressGuard.buildRefusal(response);

		expect(result.statusCode).toBe(401);
		expect(result.headers['Content-Type']).toBe('application/json');
		expect(result.headers['Cache-Control']).toBe('no-store');
		expect(result.headers['Cache-Control']).not.toMatch(/max-age/);
		expect(result.headers['Access-Control-Allow-Origin']).toBeDefined();
		const body = JSON.parse(result.body);
		expect(body).toEqual({ message: 'Requests must use the service endpoint.' });

		// >! Nothing the client sent, and nothing about the secret, comes back.
		const everything = JSON.stringify(result);
		expect(everything).not.toContain(HEADER_VALUE);
		expect(everything).not.toContain('203.0.113.77');
		expect(everything).not.toContain('OriginSecret');
	});

	test('protection off (variable unset): the request reports direct and is not refused', () => {
		delete process.env[ENV_NAME];
		const clientRequest = new ClientRequest(buildEvent(), context);
		expect(clientRequest.isIngressVerified()).toBe(false);
		expect(IngressGuard.shouldRefuse(clientRequest, process.env)).toBe(false);
	});
});
