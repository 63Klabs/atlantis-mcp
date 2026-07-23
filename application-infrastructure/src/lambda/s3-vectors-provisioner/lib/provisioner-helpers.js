'use strict';

/**
 * Pure, dependency-free helpers for the S3 Vectors provisioner custom resource.
 *
 * This module intentionally has NO AWS SDK dependency so its logic (property
 * validation, error classification, physical-resource-id encoding, and material-change
 * detection) can be unit tested without constructing an S3 Vectors client. The SDK-backed
 * orchestration lives in {@link module:index}.
 *
 * Security:
 *   - All exported functions treat their inputs as UNTRUSTED CloudFormation event data
 *     and validate before use; nothing here performs I/O, spawns a shell, or logs. // >!
 *
 * @module lib/provisioner-helpers
 */

/**
 * Terminal CloudFormation custom-resource response statuses.
 * @constant {{SUCCESS: string, FAILED: string}}
 */
const RESPONSE_STATUS = Object.freeze({ SUCCESS: 'SUCCESS', FAILED: 'FAILED' });

/**
 * Distance metrics accepted by the S3 Vectors `CreateIndex` API (lowercase enum).
 * Verified against the AWS CLI/API reference: `--distance-metric "cosine"|"euclidean"`.
 * (These are the API values; "CosineSimilarity"/"L2"/etc. are conceptual query-time
 * terms, NOT the create-index enum.)
 * @constant {string[]}
 */
const ALLOWED_DISTANCE_METRICS = Object.freeze(['cosine', 'euclidean']);

/**
 * Default distance metric used when the resource properties omit one. Cosine matches the
 * design's cosine-similarity ranking and the S3VectorStore query mapping.
 * @constant {string}
 */
const DEFAULT_DISTANCE_METRIC = 'cosine';

/**
 * Fixed vector element data type for the index. Titan embeddings are float32.
 * @constant {string}
 */
const DATA_TYPE = 'float32';

/**
 * Inclusive bounds for the vector index dimension (S3 Vectors allows 1–4096).
 * @constant {number}
 */
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;

/**
 * Maximum number of non-filterable metadata keys allowed by S3 Vectors at index creation.
 * @constant {number}
 */
const MAX_NON_FILTERABLE_KEYS = 10;

/**
 * S3 Vectors vector-bucket naming rule: 3–63 chars, lowercase letters, numbers, and
 * hyphens; must start and end with a letter or number.
 * @constant {RegExp}
 */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * S3 Vectors index naming rule: 3–63 chars, lowercase letters, numbers, hyphens, and
 * dots; must start and end with a letter or number.
 * @constant {RegExp}
 */
const INDEX_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Separator between the bucket name and index name in the custom resource's
 * `PhysicalResourceId`.
 * @constant {string}
 */
const PHYSICAL_ID_SEPARATOR = '/';

/**
 * Error thrown when custom-resource properties fail validation. Carries a `code` so the
 * handler can distinguish caller/property errors from AWS failures.
 *
 * @augments Error
 */
class InvalidPropertiesError extends Error {
  /**
   * @param {string} message - Human-readable, non-sensitive validation message.
   */
  constructor(message) {
    super(message);
    this.name = 'InvalidPropertiesError';
    this.code = 'INVALID_PROPERTIES';
  }
}

/**
 * Coerce a CloudFormation property value to a trimmed string. CloudFormation delivers all
 * custom-resource property values as strings (or arrays of strings), so numbers arrive as
 * e.g. `"1024"`; this normalizes `undefined`/`null` to `''`.
 *
 * @param {*} value - The raw property value.
 * @returns {string} The trimmed string form (`''` when nullish).
 * @example
 * asTrimmedString('  v3 '); // 'v3'
 * asTrimmedString(undefined); // ''
 */
function asTrimmedString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

/**
 * Compare two arrays for equality ignoring element order (used for the immutable
 * non-filterable metadata key set).
 *
 * @param {Array<*>} a - First array.
 * @param {Array<*>} b - Second array.
 * @returns {boolean} `true` when both contain the same elements regardless of order.
 * @example
 * arraysEqualUnordered(['a', 'b'], ['b', 'a']); // true
 * arraysEqualUnordered(['a'], ['a', 'b']);      // false
 */
function arraysEqualUnordered(a, b) {
  const left = Array.isArray(a) ? [...a].sort() : [];
  const right = Array.isArray(b) ? [...b].sort() : [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

/**
 * Validate and normalize the non-filterable metadata keys property into a de-duplicated
 * array of non-empty strings.
 *
 * @private
 * @param {*} raw - The raw `NonFilterableMetadataKeys` property (array or absent).
 * @returns {string[]} The validated key list (possibly empty).
 * @throws {InvalidPropertiesError} When the value is not an array of strings, a key is
 *   empty/too long, or more than {@link MAX_NON_FILTERABLE_KEYS} keys are supplied.
 */
function normalizeNonFilterableKeys(raw) {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new InvalidPropertiesError('NonFilterableMetadataKeys must be an array of strings.');
  }
  const keys = [];
  for (const entry of raw) {
    const key = asTrimmedString(entry);
    // >! Validate each untrusted key: non-empty and within the S3 Vectors key length.
    if (key.length === 0 || key.length > 63) {
      throw new InvalidPropertiesError('Each NonFilterableMetadataKey must be 1–63 characters.');
    }
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  if (keys.length > MAX_NON_FILTERABLE_KEYS) {
    throw new InvalidPropertiesError(
      `At most ${MAX_NON_FILTERABLE_KEYS} non-filterable metadata keys are allowed.`
    );
  }
  return keys;
}

/**
 * Validate and normalize CloudFormation `ResourceProperties` into the immutable index
 * configuration the S3 Vectors API needs. CloudFormation passes every value as a string
 * (or list of strings), so `Dimension` is parsed from its string form.
 *
 * @param {Object} properties - The `ResourceProperties` (or `OldResourceProperties`) map.
 * @param {string} properties.VectorBucketName - Vector bucket name.
 * @param {string} properties.IndexName - Vector index name.
 * @param {(string|number)} properties.Dimension - Embedding dimension (1–4096).
 * @param {string} [properties.DistanceMetric='cosine'] - Distance metric (`cosine`|`euclidean`).
 * @param {string[]} [properties.NonFilterableMetadataKeys=[]] - Non-filterable metadata keys.
 * @returns {{vectorBucketName: string, indexName: string, dimension: number, distanceMetric: string, nonFilterableMetadataKeys: string[]}}
 *   The normalized, validated configuration.
 * @throws {InvalidPropertiesError} When any field is missing or invalid.
 * @example
 * normalizeProperties({ VectorBucketName: 'acme-mcp-test-docvec', IndexName: 'acme-mcp-test-docidx', Dimension: '1024' });
 * // { vectorBucketName: 'acme-mcp-test-docvec', indexName: 'acme-mcp-test-docidx', dimension: 1024, distanceMetric: 'cosine', nonFilterableMetadataKeys: [] }
 */
function normalizeProperties(properties) {
  const props = (properties && typeof properties === 'object') ? properties : {};

  const vectorBucketName = asTrimmedString(props.VectorBucketName);
  // >! Validate untrusted names against the S3 Vectors naming rules before any API call.
  if (!BUCKET_NAME_PATTERN.test(vectorBucketName)) {
    throw new InvalidPropertiesError(
      'VectorBucketName must be 3–63 chars: lowercase letters, numbers, and hyphens, starting and ending with a letter or number.'
    );
  }

  const indexName = asTrimmedString(props.IndexName);
  if (!INDEX_NAME_PATTERN.test(indexName)) {
    throw new InvalidPropertiesError(
      'IndexName must be 3–63 chars: lowercase letters, numbers, hyphens, and dots, starting and ending with a letter or number.'
    );
  }

  const dimensionString = asTrimmedString(props.Dimension);
  const dimension = Number(dimensionString);
  if (!Number.isInteger(dimension) || dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) {
    throw new InvalidPropertiesError(
      `Dimension must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`
    );
  }

  const distanceMetricRaw = asTrimmedString(props.DistanceMetric) || DEFAULT_DISTANCE_METRIC;
  const distanceMetric = distanceMetricRaw.toLowerCase();
  if (!ALLOWED_DISTANCE_METRICS.includes(distanceMetric)) {
    throw new InvalidPropertiesError(
      `DistanceMetric must be one of: ${ALLOWED_DISTANCE_METRICS.join(', ')}.`
    );
  }

  const nonFilterableMetadataKeys = normalizeNonFilterableKeys(props.NonFilterableMetadataKeys);

  return { vectorBucketName, indexName, dimension, distanceMetric, nonFilterableMetadataKeys };
}

/**
 * Determine whether any IMMUTABLE index attribute changed between the new and old resource
 * properties. Any change here requires (re)provisioning the index, since S3 Vectors index
 * name, dimension, distance metric, and non-filterable keys cannot be altered in place.
 *
 * @param {Object} newConfig - Normalized new configuration (from {@link normalizeProperties}).
 * @param {Object} oldConfig - Normalized old configuration (from {@link normalizeProperties}).
 * @returns {boolean} `true` when the bucket/index name, dimension, distance metric, or
 *   non-filterable key set differs.
 * @example
 * hasMaterialChange(
 *   { vectorBucketName: 'b', indexName: 'i', dimension: 1024, distanceMetric: 'cosine', nonFilterableMetadataKeys: [] },
 *   { vectorBucketName: 'b', indexName: 'i', dimension: 512,  distanceMetric: 'cosine', nonFilterableMetadataKeys: [] }
 * ); // true (dimension changed)
 */
function hasMaterialChange(newConfig, oldConfig) {
  if (!oldConfig || typeof oldConfig !== 'object') {
    return true;
  }
  return (
    newConfig.vectorBucketName !== oldConfig.vectorBucketName ||
    newConfig.indexName !== oldConfig.indexName ||
    newConfig.dimension !== oldConfig.dimension ||
    newConfig.distanceMetric !== oldConfig.distanceMetric ||
    !arraysEqualUnordered(newConfig.nonFilterableMetadataKeys, oldConfig.nonFilterableMetadataKeys)
  );
}

/**
 * Build the custom resource `PhysicalResourceId` from a bucket and index name.
 *
 * @param {string} vectorBucketName - The vector bucket name.
 * @param {string} indexName - The vector index name.
 * @returns {string} The physical resource id (`` `${bucket}/${index}` ``).
 * @example
 * makePhysicalResourceId('acme-mcp-test-docvec', 'acme-mcp-test-docidx');
 * // 'acme-mcp-test-docvec/acme-mcp-test-docidx'
 */
function makePhysicalResourceId(vectorBucketName, indexName) {
  return `${vectorBucketName}${PHYSICAL_ID_SEPARATOR}${indexName}`;
}

/**
 * Parse a `PhysicalResourceId` produced by {@link makePhysicalResourceId} back into its
 * bucket and index names. Splits on the FIRST separator so index names never contain the
 * separator issue (bucket names cannot contain `/`).
 *
 * @param {string} physicalResourceId - The physical resource id to parse.
 * @returns {{vectorBucketName: string, indexName: string}} The parsed names (empty strings
 *   when the id is missing or has no separator).
 * @example
 * parsePhysicalResourceId('b/i'); // { vectorBucketName: 'b', indexName: 'i' }
 */
function parsePhysicalResourceId(physicalResourceId) {
  const id = asTrimmedString(physicalResourceId);
  const separatorIndex = id.indexOf(PHYSICAL_ID_SEPARATOR);
  if (separatorIndex < 0) {
    return { vectorBucketName: id, indexName: '' };
  }
  return {
    vectorBucketName: id.slice(0, separatorIndex),
    indexName: id.slice(separatorIndex + 1)
  };
}

/**
 * Classify an AWS error as an "already exists / conflict" condition, used to make
 * create/provision operations idempotent. Matches by SDK error name, HTTP 409, and common
 * message fragments so it is resilient to minor SDK differences.
 *
 * @param {*} error - The caught error (any shape).
 * @returns {boolean} `true` when the error indicates the resource already exists.
 * @example
 * isConflictError({ name: 'ConflictException' }); // true
 * isConflictError({ $metadata: { httpStatusCode: 409 } }); // true
 */
function isConflictError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = asTrimmedString(error.name);
  const code = asTrimmedString(error.Code || error.code);
  const status = error.$metadata && error.$metadata.httpStatusCode;
  const message = asTrimmedString(error.message).toLowerCase();
  if (status === 409) {
    return true;
  }
  if (/conflict|alreadyexists|already exists/i.test(name) || /conflict|alreadyexists/i.test(code)) {
    return true;
  }
  return message.includes('already exists') || message.includes('conflict');
}

/**
 * Classify an AWS error as a "not found" condition, used to treat deletes of missing
 * resources as success and to detect index absence. Matches by SDK error name, HTTP 404,
 * and common message fragments.
 *
 * @param {*} error - The caught error (any shape).
 * @returns {boolean} `true` when the error indicates the resource does not exist.
 * @example
 * isNotFoundError({ name: 'NotFoundException' }); // true
 * isNotFoundError({ $metadata: { httpStatusCode: 404 } }); // true
 */
function isNotFoundError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = asTrimmedString(error.name);
  const code = asTrimmedString(error.Code || error.code);
  const status = error.$metadata && error.$metadata.httpStatusCode;
  const message = asTrimmedString(error.message).toLowerCase();
  if (status === 404) {
    return true;
  }
  if (/notfound|nosuch|does not exist/i.test(name) || /notfound|nosuch/i.test(code)) {
    return true;
  }
  return message.includes('not found') || message.includes('does not exist');
}

/**
 * Produce a short, non-sensitive failure reason for the CloudFormation response. Collapses
 * whitespace and truncates so the response never leaks large or sensitive payloads.
 *
 * @param {*} error - The error or message to sanitize.
 * @param {number} [maxLength=1024] - Maximum reason length.
 * @returns {string} A single-line, length-bounded reason string.
 * @example
 * sanitizeReason(new Error('boom')); // 'boom'
 */
function sanitizeReason(error, maxLength = 1024) {
  let message;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === 'object' && typeof error.message === 'string') {
    message = error.message;
  } else {
    message = asTrimmedString(error);
  }
  // >! Collapse whitespace and truncate so the response reason cannot carry large or
  // >! multi-line/sensitive content back to CloudFormation.
  const collapsed = asTrimmedString(message).replace(/\s+/g, ' ');
  if (collapsed.length === 0) {
    return 'Unspecified error.';
  }
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 3)}...` : collapsed;
}

module.exports = {
  RESPONSE_STATUS,
  ALLOWED_DISTANCE_METRICS,
  DEFAULT_DISTANCE_METRIC,
  DATA_TYPE,
  MIN_DIMENSION,
  MAX_DIMENSION,
  MAX_NON_FILTERABLE_KEYS,
  BUCKET_NAME_PATTERN,
  INDEX_NAME_PATTERN,
  PHYSICAL_ID_SEPARATOR,
  InvalidPropertiesError,
  asTrimmedString,
  arraysEqualUnordered,
  normalizeProperties,
  hasMaterialChange,
  makePhysicalResourceId,
  parsePhysicalResourceId,
  isConflictError,
  isNotFoundError,
  sanitizeReason
};
