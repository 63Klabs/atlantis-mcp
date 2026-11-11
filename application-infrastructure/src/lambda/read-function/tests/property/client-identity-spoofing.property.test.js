/**
 * Property-Based Tests for client identity spoofing resistance
 *
 * Feature: 0-0-7-rate-limit-client-ip-spoofing, Requirements 1.5, 10.1, 10.6
 *
 * The rate limit identity of a public (no API key) request must come from
 * `requestContext.identity.sourceIp` only. Nothing in the request headers may
 * change it: not `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`,
 * `CloudFront-Viewer-Address`, or `Via`.
 *
 * Property 1: Whatever the forwarding headers contain, the identity the application
 *             uses equals the bucket key of `sourceIp`.
 * Property 2: Two events with different `sourceIp` values (different IPv4 address,
 *             or different IPv6 /64 prefix) give different identities.
 * Property 3: Two events with the same `sourceIp` and different headers give one identity.
 *
 * The identity is computed the way the application computes it:
 *
 *   const clientRequest = new ClientRequest(event, context);          // real cache-data
 *   const auth = await resolveAuth(event, clientRequest.getClientIp());
 *   auth.identity                                                      // compared with toBucketKey(sourceIp)
 *
 * `CACHE_DATA_TRUSTED_PROXY_HOPS` is set to '0' so that cache-data trusts no
 * forwarding header at all and returns `identity.sourceIp`.
 *
 * Phase 1 (red): `utils/client-address.js` does not exist yet, so this suite fails on
 * import. Once it exists, it fails on the unchanged code because `resolveAuth` ignores
 * its second argument and returns the first `X-Forwarded-For` entry.
 *
 * Only @63klabs/cache-data's CachedSsmParameter is replaced (so that loading
 * auth-resolver reads no SSM parameter). ClientRequest is the real class. The public
 * path never reads DynamoDB. No child processes are spawned. Each property runs 100 times.
 *
 * Validates: Requirements 1.5, 10.1, 10.6
 */

'use strict';

// >! Keep cache-data real (ClientRequest, ClientIpResolver) and replace only the SSM parameter
// >! constructor, which auth-resolver calls at load time. The no-key path never reads it.
jest.mock('@63klabs/cache-data', () => {
	const actual = jest.requireActual('@63klabs/cache-data');
	return {
		...actual,
		tools: {
			...actual.tools,
			CachedSsmParameter: jest.fn().mockImplementation(() => ({ getValue: jest.fn() }))
		}
	};
});

const net = require('net');
const fc = require('fast-check');
const { tools: { ClientRequest } } = require('@63klabs/cache-data');
const validations = require('../../config/validations');
const AuthResolver = require('../../utils/auth-resolver');
const { toBucketKey } = require('../../utils/client-address');

const NUM_RUNS = 100;
const TEST_TIMEOUT_MS = 60000;
const HOPS_ENV_VAR = 'CACHE_DATA_TRUSTED_PROXY_HOPS';

/* ------------------------------------------------------------------ */
/*  Generators                                                        */
/* ------------------------------------------------------------------ */

/** A 16-bit group, 0 to 0xffff. */
const groupArb = fc.integer({ min: 0, max: 0xffff });

/** A byte, 0 to 255. */
const octetArb = fc.integer({ min: 0, max: 255 });

/**
 * Four-group /64 prefix. The first group is non-zero so that no generated address
 * falls in ::/80 and is read as IPv4-mapped.
 */
const prefixArb = fc.tuple(fc.integer({ min: 1, max: 0xffff }), groupArb, groupArb, groupArb);

/** Four-group interface identifier (the host half of an IPv6 address). */
const suffixArb = fc.tuple(groupArb, groupArb, groupArb, groupArb);

/** A canonical dotted-quad IPv4 string. */
const ipv4Arb = fc.tuple(octetArb, octetArb, octetArb, octetArb).map(o => o.join('.'));

/**
 * Spell eight 16-bit groups as full IPv6 text.
 *
 * @param {Array.<number>} groups - Eight 16-bit numbers
 * @returns {string} Expanded IPv6 text, lower case
 * @example
 * spell([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]); // '2001:db8:0:0:0:0:0:1'
 */
function spell(groups) {
	return groups.map(g => g.toString(16)).join(':');
}

/** A valid IPv6 address string. */
const ipv6Arb = fc.tuple(prefixArb, suffixArb).map(([p, s]) => spell([...p, ...s]));

/** A valid IPv4 or IPv6 address string: the generated `sourceIp`. */
const sourceIpArb = fc.oneof(ipv4Arb, ipv6Arb);

/**
 * Two distinct `sourceIp` values that must give two identities: two different IPv4
 * addresses, or two IPv6 addresses whose /64 prefixes differ, or one of each.
 */
const differentSourceIpsArb = fc.oneof(
	fc.tuple(ipv4Arb, ipv4Arb).filter(([a, b]) => a !== b),
	fc.tuple(prefixArb, prefixArb, suffixArb, suffixArb)
		.filter(([pa, pb]) => pa.some((g, i) => g !== pb[i]))
		.map(([pa, pb, sa, sb]) => [spell([...pa, ...sa]), spell([...pb, ...sb])]),
	fc.tuple(ipv4Arb, ipv6Arb)
);

/** Any address-like or arbitrary text a client could put in a forwarding header entry. */
const forwardedEntryArb = fc.oneof(
	ipv4Arb,
	ipv6Arb,
	fc.string({ maxLength: 30 })
);

/** `X-Forwarded-For` with 0 to 6 arbitrary entries (0 entries: the header is absent). */
const xForwardedForArb = fc.array(forwardedEntryArb, { minLength: 0, maxLength: 6 })
	.map(entries => (entries.length === 0 ? undefined : entries.join(', ')));

/** `Forwarded` (RFC 7239) naming an arbitrary client. */
const forwardedArb = fc.option(
	fc.oneof(ipv4Arb, ipv6Arb).map(ip => `for=${ip};proto=https`),
	{ nil: undefined }
);

/** `X-Real-Ip` naming an arbitrary client. */
const xRealIpArb = fc.option(fc.oneof(ipv4Arb, ipv6Arb, fc.string({ maxLength: 20 })), { nil: undefined });

/** `CloudFront-Viewer-Address`: `ip:port` or `[ipv6]:port`, as CloudFront writes it. */
const viewerAddressArb = fc.option(
	fc.oneof(
		fc.tuple(ipv4Arb, fc.integer({ min: 1, max: 65535 })).map(([ip, port]) => `${ip}:${port}`),
		fc.tuple(ipv6Arb, fc.integer({ min: 1, max: 65535 })).map(([ip, port]) => `[${ip}]:${port}`)
	),
	{ nil: undefined }
);

/** `Via` text. */
const viaArb = fc.option(fc.string({ maxLength: 30 }), { nil: undefined });

/**
 * Forwarding headers a client could send. A header whose generated value is
 * undefined is left out of the event.
 */
const forwardingHeadersArb = fc.record({
	'X-Forwarded-For': xForwardedForArb,
	'Forwarded': forwardedArb,
	'X-Real-Ip': xRealIpArb,
	'CloudFront-Viewer-Address': viewerAddressArb,
	'Via': viaArb
}).map(headers => Object.fromEntries(
	Object.entries(headers).filter(([, value]) => value !== undefined)
));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway REST event for POST /mcp/v1 with no API key.
 *
 * @param {string} sourceIp - Address API Gateway recorded for the caller
 * @param {Object.<string, string>} forwardingHeaders - Headers the client sent
 * @returns {Object} API Gateway proxy event
 * @example
 * const event = buildEvent('192.0.2.1', { 'X-Forwarded-For': '198.51.100.7' });
 */
function buildEvent(sourceIp, forwardingHeaders) {
	return {
		httpMethod: 'POST',
		resource: '/mcp/v1',
		path: '/mcp/v1',
		headers: { 'Content-Type': 'application/json', ...forwardingHeaders },
		multiValueHeaders: {},
		queryStringParameters: null,
		multiValueQueryStringParameters: null,
		pathParameters: null,
		body: null,
		isBase64Encoded: false,
		requestContext: {
			resourcePath: '/mcp/v1',
			httpMethod: 'POST',
			path: '/mcp/v1',
			stage: 'test',
			requestId: 'test-request-id',
			identity: { sourceIp, userAgent: 'jest' }
		}
	};
}

/**
 * Build a minimal Lambda context.
 *
 * @returns {{awsRequestId: string, getRemainingTimeInMillis: function(): number}} Lambda context
 * @example
 * const context = buildContext();
 */
function buildContext() {
	return {
		awsRequestId: 'test-aws-request-id',
		getRemainingTimeInMillis: () => 30000
	};
}

/**
 * Resolve the identity of a public request the way the application does: the real
 * ClientRequest finds the client address, and resolveAuth turns it into the identity.
 *
 * @async
 * @param {string} sourceIp - Address API Gateway recorded for the caller
 * @param {Object.<string, string>} forwardingHeaders - Headers the client sent
 * @returns {Promise<{clientIp: (string|null), identity: (string|null|undefined)}>} Address from ClientRequest and identity from resolveAuth
 * @example
 * const { clientIp, identity } = await resolveIdentity('192.0.2.1', {});
 */
async function resolveIdentity(sourceIp, forwardingHeaders) {
	const event = buildEvent(sourceIp, forwardingHeaders);
	const clientRequest = new ClientRequest(event, buildContext());
	const clientIp = clientRequest.getClientIp();
	const auth = await AuthResolver.resolveAuth(event, clientIp);
	return { clientIp, identity: auth.identity };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Client identity spoofing resistance (real ClientRequest)', () => {
	let originalHops;

	beforeAll(() => {
		// >! Trust no proxy header: cache-data must return identity.sourceIp for every request
		originalHops = process.env[HOPS_ENV_VAR];
		process.env[HOPS_ENV_VAR] = '0';
		ClientRequest.init({ validations });
	});

	afterAll(() => {
		if (originalHops === undefined) {
			delete process.env[HOPS_ENV_VAR];
		} else {
			process.env[HOPS_ENV_VAR] = originalHops;
		}
	});

	it('Property 1: forwarding headers have no effect on the identity', async () => {
		await fc.assert(
			fc.asyncProperty(sourceIpArb, forwardingHeadersArb, async (sourceIp, headers) => {
				// >! Precondition: the generated source address is one the platform parser accepts
				expect(net.isIP(sourceIp)).not.toBe(0);

				const { clientIp, identity } = await resolveIdentity(sourceIp, headers);

				// >! Forged headers must not move the address API Gateway recorded
				expect(toBucketKey(clientIp)).toBe(toBucketKey(sourceIp));
				expect(identity).toBe(toBucketKey(sourceIp));
			}),
			{ numRuns: NUM_RUNS }
		);
	}, TEST_TIMEOUT_MS);

	it('Property 2: different source addresses give different identities', async () => {
		await fc.assert(
			fc.asyncProperty(differentSourceIpsArb, forwardingHeadersArb, forwardingHeadersArb,
				async ([sourceIpA, sourceIpB], headersA, headersB) => {
					const a = await resolveIdentity(sourceIpA, headersA);
					const b = await resolveIdentity(sourceIpB, headersB);

					expect(a.identity).toBe(toBucketKey(sourceIpA));
					expect(b.identity).toBe(toBucketKey(sourceIpB));
					expect(a.identity).not.toBe(b.identity);
				}),
			{ numRuns: NUM_RUNS }
		);
	}, TEST_TIMEOUT_MS);

	it('Property 3: the same source address gives one identity whatever the headers', async () => {
		await fc.assert(
			fc.asyncProperty(sourceIpArb, forwardingHeadersArb, forwardingHeadersArb,
				async (sourceIp, headersA, headersB) => {
					const a = await resolveIdentity(sourceIp, headersA);
					const b = await resolveIdentity(sourceIp, headersB);

					expect(a.identity).toBe(b.identity);
					expect(a.identity).toBe(toBucketKey(sourceIp));
				}),
			{ numRuns: NUM_RUNS }
		);
	}, TEST_TIMEOUT_MS);
});
