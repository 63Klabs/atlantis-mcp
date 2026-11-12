'use strict';

/**
 * Origin-protection guard helper: decides whether the guard applies to this deployment and
 * builds the refusal for a request that did not come through the Atlantis distribution.
 *
 * The verification itself belongs to cache-data (`ClientRequest.isIngressVerified()`, which
 * compares the `X-Atlantis-Origin-Secret` header with the secret held in Secrets Manager and
 * writes the `INGRESS_UNVERIFIED` log line). This module never reads a header, never touches
 * the secret, and never logs. It only says "apply the guard" and "refuse".
 *
 * Spec: 0-0-7-rate-limit-client-ip-spoofing (Part B, Design B2, Requirements 6.1 to 6.10).
 *
 * @module utils/ingress-guard
 */

/**
 * Environment variable that turns cache-data's ingress check on. The template sets it only
 * when the `ApiIsBehindCloudFront` flag is `true`.
 *
 * @constant {string}
 */
const INGRESS_SECRET_ENV_NAME = 'CACHE_DATA_INGRESS_SECRET_NAME';

/**
 * Status of the refusal. Never 403 or 404 (see the comment in `buildRefusal`).
 *
 * @constant {number}
 */
const REFUSAL_STATUS_CODE = 401;

/**
 * Body message of the refusal. Carries no secret, stage name, identifier, ARN, or address.
 *
 * @constant {string}
 */
const REFUSAL_MESSAGE = 'Requests must use the service endpoint.';

/**
 * Whether origin protection is on for this deployment.
 *
 * True when `CACHE_DATA_INGRESS_SECRET_NAME` is a non-empty string after trimming. With the
 * variable unset cache-data reports every request as ingress `direct`, and
 * `isIngressVerified()` is `false` for `direct`, so the guard must not run: an unconditional
 * guard would refuse all traffic.
 *
 * @param {Object.<string, *>} [env=process.env] - Environment to read (injectable for tests)
 * @returns {boolean} True when the guard applies
 * @example
 * isIngressGuardOn({ CACHE_DATA_INGRESS_SECRET_NAME: 'acme-mcp-prod-OriginSecret' }); // true
 * isIngressGuardOn({}); // false
 * isIngressGuardOn({ CACHE_DATA_INGRESS_SECRET_NAME: '  ' }); // false
 */
function isIngressGuardOn(env = process.env) {
  const value = env ? env[INGRESS_SECRET_ENV_NAME] : undefined;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Whether this request must be refused: protection is on and cache-data did not verify it.
 *
 * Fails closed. When protection is on, anything other than a `true` answer from
 * `isIngressVerified()` (a missing method, a thrown error, a non-boolean) counts as
 * unverified. When protection is off, cache-data is not consulted at all.
 *
 * @param {{isIngressVerified: function(): boolean}} clientRequest - cache-data ClientRequest
 * @param {Object.<string, *>} [env=process.env] - Environment to read (injectable for tests)
 * @returns {boolean} True when the request must be refused with the 401
 * @example
 * if (shouldRefuse(clientRequest)) {
 *   return buildRefusal(response);
 * }
 */
function shouldRefuse(clientRequest, env = process.env) {
  if (!isIngressGuardOn(env)) {
    return false;
  }
  try {
    // >! The decision is cache-data's alone. The application does not read the
    // >! X-Atlantis-Origin-Secret header or compare the secret itself.
    return !(clientRequest && typeof clientRequest.isIngressVerified === 'function'
      && clientRequest.isIngressVerified() === true);
  } catch {
    // >! An error while checking is never "verified". cache-data records its own failures.
    return true;
  }
}

/**
 * Fill the Response with the refusal and finalize it.
 *
 * @param {Object} response - cache-data Response created for this request
 * @returns {Object} The finalized API Gateway response (401, `Cache-Control: no-store`, JSON `{ message }`)
 * @example
 * const result = buildRefusal(response);
 * // { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ... }, body: '{"message":"..."}' }
 */
function buildRefusal(response) {
  // >! 401, never 403 or 404: the Atlantis distribution rewrites those two to the landing
  // >! page with HTTP 200, so a misconfigured origin would look like a working site.
  response.setStatusCode(REFUSAL_STATUS_CODE);
  // >! no-store: cache-data applies max-age to any status of 400 or more, and a cached 401
  // >! after a rotation mistake would outlast the fix.
  response.addHeader('Cache-Control', 'no-store');
  // >! The body names no secret, header, stage, identifier, or address.
  response.setBody({ message: REFUSAL_MESSAGE });
  return response.finalize();
}

module.exports = {
  INGRESS_SECRET_ENV_NAME,
  REFUSAL_STATUS_CODE,
  REFUSAL_MESSAGE,
  isIngressGuardOn,
  shouldRefuse,
  buildRefusal
};
