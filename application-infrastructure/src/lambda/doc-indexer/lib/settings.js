'use strict';

/**
 * AI configuration for the Documentation Indexer Lambda.
 *
 * This module mirrors the `documentation.ai` settings block defined in the
 * read-function (`read-function/config/settings.js`) so that the index-time
 * embedding path and the query-time retrieval path share an identical
 * configuration shape and defaults. The indexer only consumes a subset of
 * these values (feature flag, vector store, embedding model/dimensions/token
 * budget, and S3 Vectors location), but the full block is mirrored for parity
 * and to keep both functions in lockstep as new `DOC_AI_*` variables are added.
 *
 * Unlike the read-function — which is an API Gateway MVC Lambda that loads a
 * static settings object at module load via `@63klabs/cache-data` — the
 * indexer is a scheduled utility Lambda with no `config/` directory and no
 * dependency on `@63klabs/cache-data`. It reads its configuration from
 * environment variables at call time (see `index-builder.build()`), so this
 * module exposes a `loadDocAiSettings()` factory rather than a load-time
 * object. All values are parsed defensively: unrecognized or out-of-range
 * values are logged with a structured warning (matching the indexer's existing
 * `console.warn(JSON.stringify({ level, event, ... }))` style) and fall back to
 * the documented default rather than throwing during settings load.
 *
 * @module lib/settings
 */

/**
 * Access tiers in ascending order of privilege, used to validate
 * `DOC_AI_MIN_TIER`. Ordering: public < registered < paid < private.
 * @constant {Array<string>}
 */
const DOC_AI_TIERS = ['public', 'registered', 'paid', 'private'];

/**
 * Valid retrieval modes for `DOC_AI_RETRIEVAL_MODE`.
 * @constant {Array<string>}
 */
const DOC_AI_RETRIEVAL_MODES = ['keyword', 'semantic', 'semantic-assisted'];

/**
 * Valid vector stores for `DOC_AI_VECTOR_STORE`.
 * @constant {Array<string>}
 */
const DOC_AI_VECTOR_STORES = ['dynamodb', 's3-vectors'];

/**
 * Emit a structured warning when a `DOC_AI_*` value is invalid and a documented
 * default is being used instead. Uses the indexer's existing structured logging
 * convention (`console.warn(JSON.stringify({ level, event, ... }))`) rather than
 * `@63klabs/cache-data`'s DebugAndLog, which the indexer does not depend on.
 * A single `event` name keeps these easy to filter in CloudWatch Logs.
 *
 * @private
 * @param {string} envVar - Environment variable name that was invalid
 * @param {string} value - The raw (invalid) value that was supplied
 * @param {string} expected - Human-readable description of the expected value
 * @param {*} using - The default/fallback value being used instead
 * @returns {void}
 */
function warnInvalidSetting(envVar, value, expected, using) {
  console.warn(JSON.stringify({
    level: 'WARN',
    event: 'doc_ai_setting_invalid',
    envVar,
    value,
    expected,
    using
  }));
}

/**
 * Parse a boolean environment variable.
 *
 * Recognizes `true`, `1`, `yes`, and `on` (case-insensitive) as true, and
 * `false`, `0`, `no`, and `off` as false. When the variable is unset, empty,
 * or set to an unrecognized value, the documented default is returned (a
 * warning is logged only for unrecognized, non-empty values). This never
 * throws so that settings load cannot fail on a malformed flag.
 *
 * @param {string} envVar - Environment variable name
 * @param {boolean} [defaultValue=false] - Default value when unset or invalid
 * @returns {boolean} Parsed boolean value
 * @example
 * // DOC_AI_ENABLED unset -> false (indexer skips all embedding work)
 * const enabled = parseBool('DOC_AI_ENABLED', false);
 */
function parseBool(envVar, defaultValue = false) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  warnInvalidSetting(envVar, value, 'boolean', defaultValue);
  return defaultValue;
}

/**
 * Parse an enumerated string environment variable, validating it against a
 * fixed set of allowed values.
 *
 * When the variable is unset or empty, `defaultValue` is returned. When it is
 * set to one of `allowedValues`, that value is returned. When it is set to an
 * unrecognized value, a warning is logged and `fallbackValue` is returned.
 * `fallbackValue` defaults to `defaultValue`, but may differ where the spec
 * requires an unset default that is distinct from the invalid-value fallback
 * (for example, retrieval mode defaults to `semantic` when unset but falls
 * back to `keyword` when misconfigured). This never throws.
 *
 * @param {string} envVar - Environment variable name
 * @param {Array<string>} allowedValues - Recognized values
 * @param {string} defaultValue - Value returned when the variable is unset/empty
 * @param {string} [fallbackValue=defaultValue] - Value returned when set but invalid
 * @returns {string} Validated setting value
 * @example
 * // Unset -> 'semantic'; invalid -> warn + 'keyword'; 'keyword' -> 'keyword'
 * const mode = parseEnum('DOC_AI_RETRIEVAL_MODE', DOC_AI_RETRIEVAL_MODES, 'semantic', 'keyword');
 */
function parseEnum(envVar, allowedValues, defaultValue, fallbackValue = defaultValue) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const trimmed = value.trim();
  if (allowedValues.includes(trimmed)) {
    return trimmed;
  }
  warnInvalidSetting(envVar, value, `one of: ${allowedValues.join(', ')}`, fallbackValue);
  return fallbackValue;
}

/**
 * Parse an integer environment variable with inclusive range validation.
 *
 * When the variable is unset or empty, `defaultValue` is returned. When it
 * parses to an integer within `[min, max]`, that value is returned. Otherwise
 * (non-numeric or out of range) a warning is logged and `defaultValue` is
 * returned. This never throws so that settings load cannot fail on a malformed
 * numeric value.
 *
 * @param {string} envVar - Environment variable name
 * @param {number} defaultValue - Default value when unset or invalid
 * @param {Object} [options] - Validation options
 * @param {number} [options.min=1] - Minimum allowed value (inclusive)
 * @param {number} [options.max=Infinity] - Maximum allowed value (inclusive)
 * @returns {number} Parsed integer value
 * @example
 * const dimensions = parseIntSetting('DOC_AI_EMBEDDING_DIMENSIONS', 1024, { min: 1 });
 */
function parseIntSetting(envVar, defaultValue, { min = 1, max = Infinity } = {}) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    warnInvalidSetting(envVar, value, `integer in range [${min}, ${max}]`, defaultValue);
    return defaultValue;
  }
  return parsed;
}

/**
 * Load the AI-assisted semantic search configuration from environment
 * variables.
 *
 * This returns the `documentation.ai` settings block, mirroring
 * `read-function/config/settings.js` so both functions share the same shape and
 * defaults. Values are read at call time (not module load) to match the
 * indexer's existing environment-driven, testable pattern in
 * `index-builder.build()`; callers may invoke it once per build.
 *
 * The feature is DISABLED by default (`enabled === false`) so the indexer skips
 * all embedding work and behaves exactly as it does today until an operator
 * explicitly enables it. All values are parsed defensively — invalid or
 * out-of-range values log a warning and fall back to the documented default
 * rather than throwing.
 *
 * Environment variables (index-time consumers marked with *):
 * - `DOC_AI_ENABLED` (bool, default false) * - master feature flag
 * - `DOC_AI_MIN_TIER` (default `paid`) - minimum tier for semantic search
 *   (public|registered|paid|private)
 * - `DOC_AI_RETRIEVAL_MODE` (default `semantic`) - retrieval strategy
 *   (keyword|semantic|semantic-assisted); invalid values fall back to `keyword`
 * - `DOC_AI_VECTOR_STORE` (default `s3-vectors`) * - vector store backend
 *   (dynamodb|s3-vectors)
 * - `DOC_AI_EMBEDDING_MODEL` (default `amazon.titan-embed-text-v2:0`) *
 * - `DOC_AI_EMBEDDING_DIMENSIONS` (int, default 1024) *
 * - `DOC_AI_EMBEDDING_MAX_INPUT_TOKENS` (int, default 8000) *
 * - `DOC_AI_EMBEDDING_REGION` (default '') * - optional embedding client
 *   region override; empty means "use deployment region"
 * - `DOC_AI_ASSIST_MODEL` (default `amazon.nova-micro-v1:0`)
 * - `DOC_AI_ASSIST_MAX_CANDIDATES` (int, default 25)
 * - `DOC_AI_TOP_K` (int, default 10)
 * - `DOC_AI_CANDIDATE_MULTIPLIER` (int, default 3)
 * - `DOC_AI_S3_VECTOR_BUCKET` (default '') *
 * - `DOC_AI_S3_VECTOR_INDEX` (default '') *
 *
 * @returns {{
 *   enabled: boolean,
 *   minTier: string,
 *   retrievalMode: string,
 *   vectorStore: string,
 *   embedding: {model: string, dimensions: number, maxInputTokens: number, region: string},
 *   assist: {model: string, maxCandidates: number},
 *   topK: number,
 *   candidateMultiplier: number,
 *   s3Vectors: {bucket: string, index: string}
 * }} The `documentation.ai` settings block.
 * @example
 * const { loadDocAiSettings } = require('./settings');
 * const docAi = loadDocAiSettings();
 * if (docAi.enabled) {
 *   // ... generate embeddings with docAi.embedding.model ...
 * }
 */
function loadDocAiSettings() {
  return {
    // Master feature flag. Defaults to false so the indexer skips all
    // embedding work and behaves exactly as it does today until enabled.
    enabled: parseBool('DOC_AI_ENABLED', false),

    // Minimum access tier eligible for semantic search (query-time concern;
    // mirrored for parity). Invalid values fall back to `paid`.
    minTier: parseEnum('DOC_AI_MIN_TIER', DOC_AI_TIERS, 'paid'),

    // Retrieval strategy (query-time concern; mirrored for parity). Defaults
    // to `semantic` when unset; unrecognized values fall back to `keyword`.
    retrievalMode: parseEnum('DOC_AI_RETRIEVAL_MODE', DOC_AI_RETRIEVAL_MODES, 'semantic', 'keyword'),

    // Vector store backend the indexer upserts embeddings to. Invalid values
    // fall back to `s3-vectors`.
    vectorStore: parseEnum('DOC_AI_VECTOR_STORE', DOC_AI_VECTOR_STORES, 's3-vectors'),

    // >! Embedding model ID is read from the environment (public Bedrock
    // >! model identifier, not a secret) with a documented default.
    embedding: {
      model: process.env.DOC_AI_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
      dimensions: parseIntSetting('DOC_AI_EMBEDDING_DIMENSIONS', 1024, { min: 1 }),
      maxInputTokens: parseIntSetting('DOC_AI_EMBEDDING_MAX_INPUT_TOKENS', 8000, { min: 1 }),
      // Optional embedding client region override. Defensive string
      // pass-through: empty string (the default) means "use the deployment
      // region" and is fully valid; parsing never throws. The CloudFormation
      // DocAiEmbeddingRegion AllowedPattern is the real input gate. Embedding
      // models cannot use Bedrock cross-region inference profiles, so a hard
      // client-side region pin is the only cross-region mechanism available.
      region: process.env.DOC_AI_EMBEDDING_REGION || ''
    },

    // Small-model assist configuration (query-time concern; mirrored for
    // parity). Not used by the index-time embedding path.
    // >! Assist model ID is read from the environment with a documented default.
    assist: {
      model: process.env.DOC_AI_ASSIST_MODEL || 'amazon.nova-micro-v1:0',
      maxCandidates: parseIntSetting('DOC_AI_ASSIST_MAX_CANDIDATES', 25, { min: 1 })
    },

    // Query-time result sizing (mirrored for parity).
    topK: parseIntSetting('DOC_AI_TOP_K', 10, { min: 1 }),
    candidateMultiplier: parseIntSetting('DOC_AI_CANDIDATE_MULTIPLIER', 3, { min: 1 }),

    // S3 Vectors store location. Empty strings indicate the store is not yet
    // configured; used only when `vectorStore` is `s3-vectors`.
    s3Vectors: {
      bucket: process.env.DOC_AI_S3_VECTOR_BUCKET || '',
      index: process.env.DOC_AI_S3_VECTOR_INDEX || ''
    }
  };
}

module.exports = {
  loadDocAiSettings,
  parseBool,
  parseEnum,
  parseIntSetting,
  DOC_AI_TIERS,
  DOC_AI_RETRIEVAL_MODES,
  DOC_AI_VECTOR_STORES
};
