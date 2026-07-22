/**
 * Content Sizer for MCP Response Payloads
 *
 * Measures the byte length of a serialized JSON string and compares it
 * against a configurable size threshold to determine whether the payload
 * is too large for a single response.
 *
 * @module utils/content-sizer
 */

const DEFAULT_SIZE_THRESHOLD = 50000;

/**
 * Measure the byte length of a JSON-serialized string and check against threshold.
 *
 * Calculates the UTF-8 byte length of the provided string and compares it
 * against the given threshold, the `MCP_CONTENT_SIZE_THRESHOLD` environment
 * variable, or the default of 50000 bytes (in that priority order).
 *
 * @param {string} serializedJson - The JSON string to measure
 * @param {number} [threshold] - Byte threshold override (defaults to env var or 50000)
 * @returns {{ byteLength: number, exceedsThreshold: boolean }} Measurement result
 *
 * @example
 * const { measure } = require('./content-sizer');
 *
 * const result = measure(JSON.stringify(largeObject));
 * if (result.exceedsThreshold) {
 *   console.log(`Payload is ${result.byteLength} bytes — exceeds threshold`);
 * }
 *
 * @example
 * // With explicit threshold
 * const result = measure(jsonString, 100000);
 */
function measure(serializedJson, threshold) {
  if (typeof serializedJson !== 'string') {
    return { byteLength: 0, exceedsThreshold: false };
  }

  const limit = threshold
    ?? (parseInt(process.env.MCP_CONTENT_SIZE_THRESHOLD, 10)
    || DEFAULT_SIZE_THRESHOLD);

  const byteLength = Buffer.byteLength(serializedJson, 'utf8');

  return {
    byteLength,
    exceedsThreshold: byteLength > limit
  };
}

module.exports = { measure, DEFAULT_SIZE_THRESHOLD };
