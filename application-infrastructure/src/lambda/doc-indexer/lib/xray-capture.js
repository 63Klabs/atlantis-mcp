'use strict';

/**
 * Conditional AWS X-Ray instrumentation for AWS SDK v3 clients.
 *
 * Applies `captureAWSv3Client()` when X-Ray tracing is enabled and the X-Ray SDK is
 * resolvable, and otherwise returns the supplied client untouched. The unwrapped
 * fallback is what keeps behavior identical when tracing is off and lets test doubles
 * continue to intercept calls.
 *
 * @module xray-capture
 */

/**
 * Can a value be considered true? Accepts `true`, `1`, `"1"`, and `"true"` (any case).
 *
 * @param {boolean|number|string|null|undefined} value - Value to interpret.
 * @returns {boolean} Whether the value should be treated as true.
 * @example
 * isTrue('TRUE'); // true
 * isTrue('0');    // false
 */
const isTrue = (value) => (
	value !== null && typeof value !== 'undefined' &&
	(value === true || value === 1 || value === '1' ||
		(typeof value === 'string' && value.toLowerCase() === 'true'))
);

// >! Mirrors the gate used by @63klabs/cache-data (AWS.classes.js) so a single env var
// >! controls X-Ray wrapping for both cache-data's clients and this project's clients.
// >! Read once at module load: the value is static configuration, not per-invocation state.
const USE_XRAY = isTrue(process.env?.CacheData_AWSXRayOn)
	|| isTrue(process.env?.CACHE_DATA_AWS_X_RAY_ON);

// >! Declared before captureClient() so the marker is initialized when the function runs.
// >! Symbol.for keeps the marker shared even if two copies of this helper are loaded.
/** @type {symbol} Marks an already-instrumented client instance. */
const CAPTURED = Symbol.for('atlantisMcp.xrayCaptured');

/** @type {?object} Resolved X-Ray SDK, or null when disabled/unavailable. */
let AWSXRay = null;
/** @type {boolean} Whether resolution has been attempted (success or failure). */
let xrayInitialized = false;

/**
 * Resolve the X-Ray SDK once, tolerating absence.
 *
 * @private
 * @returns {?object} The X-Ray SDK module, or null when disabled or unresolvable.
 */
const initializeXRay = () => {
	if (!xrayInitialized && USE_XRAY) {
		try {
			// >! The Lambda managed Node.js runtime does NOT provide aws-xray-sdk-core; it
			// >! ships as a production dependency. require() is wrapped so that a missing or
			// >! broken module degrades to no instrumentation instead of failing the request
			// >! (Requirement 7.2).
			AWSXRay = require('aws-xray-sdk-core');
		} catch (error) {
			AWSXRay = null;
		}
		xrayInitialized = true;
	}
	return AWSXRay;
};

/**
 * Wrap an AWS SDK v3 client with X-Ray capture when tracing is enabled and available.
 *
 * Returns the input client unchanged when tracing is disabled, when the X-Ray SDK cannot
 * be loaded, when `client` is not an instrumentable object, or when `client` has already
 * been instrumented.
 *
 * @param {object} client - An AWS SDK v3 client exposing `send()`.
 * @returns {object} The instrumented client, or the original client unchanged.
 * @example
 * const { captureClient } = require('./xray-capture');
 * const ddb = DynamoDBDocumentClient.from(captureClient(new DynamoDBClient({})));
 */
function captureClient(client) {
	// >! Never let instrumentation break the caller. Any failure path returns the original
	// >! client so downstream calls proceed exactly as they did before this feature.
	try {
		if (!client || typeof client !== 'object') { return client; }
		if (client[CAPTURED] === true) { return client; }   // >! idempotence guard

		const xray = initializeXRay();
		if (!xray || typeof xray.captureAWSv3Client !== 'function') { return client; }

		const captured = xray.captureAWSv3Client(client);
		if (!captured || typeof captured !== 'object') { return client; }

		// >! Mark the instance so a second call cannot add a second middleware and emit
		// >! duplicate subsegments. Non-enumerable so it cannot leak into serialization or
		// >! alter object shape for callers and assertions.
		Object.defineProperty(captured, CAPTURED, {
			value: true, enumerable: false, writable: false, configurable: true
		});
		return captured;
	} catch (error) {
		return client;
	}
}

module.exports = { captureClient };
