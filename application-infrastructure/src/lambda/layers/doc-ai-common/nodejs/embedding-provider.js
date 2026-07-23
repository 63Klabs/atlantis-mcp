'use strict';

/**
 * EmbeddingProvider — a thin wrapper around Amazon Bedrock `InvokeModel` for text
 * embeddings. It is shared (via the `doc-ai-common` Lambda Layer) by the
 * doc-indexer (index-time embedding generation) and the read-function
 * (query-time embedding for semantic retrieval).
 *
 * Model — Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`):
 *   Request body:  `{ inputText: string, dimensions: number, normalize: true }`
 *   Response body: `{ embedding: number[], inputTextTokenCount: number }`
 *   (the response `body` is a `Uint8Array` of UTF-8 JSON).
 *
 * Design notes:
 *   - Lazy client: the `BedrockRuntimeClient` is NOT constructed at module load or
 *     in the constructor. It is created on the first `embed()` call (or injected for
 *     tests), so merely attaching this layer costs nothing until the feature is used
 *     (Requirement 7.1). The region is resolved from the Lambda environment
 *     (`AWS_REGION`) by the SDK default provider chain — it is never hardcoded.
 *   - Typed errors: `embed()` throws {@link EmbeddingError} (or
 *     {@link EmbeddingInvalidInputError}) instead of swallowing failures, so callers
 *     such as SemanticRetrieval can catch it and fall back to keyword search
 *     (Requirement 2.4).
 *   - Input truncation: input is capped to an approximate character budget derived
 *     from the configured token budget before calling Bedrock (Requirement 6.5).
 *
 * Security:
 *   - AWS SDK v3 is provided by the Lambda runtime and required normally; this layer
 *     bundles no production dependencies and no credentials (see AGENTS.md).
 *   - Input text is treated as untrusted and validated before use; error messages
 *     never include the input text, to avoid leaking indexed/query content in logs.
 *
 * @module embedding-provider
 * @example
 * const { EmbeddingProvider } = require('/opt/nodejs/embedding-provider');
 *
 * const provider = new EmbeddingProvider({
 *   model: 'amazon.titan-embed-text-v2:0',
 *   dimensions: 1024,
 *   maxInputTokens: 8000
 * });
 *
 * const vector = await provider.embed('How do I rotate the cache secure data key?');
 * // vector.length === 1024
 */

// >! AWS SDK v3 is provided by the Lambda runtime; require it normally (do NOT bundle).
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

/**
 * Approximate characters-per-token ratio used to derive a character budget from a
 * token budget. Titan exposes no client-side tokenizer, so ~4 chars/token is used
 * as a common heuristic. See {@link EmbeddingProvider} input-truncation notes.
 *
 * @constant {number}
 */
const APPROX_CHARS_PER_TOKEN = 4;

/** Default Titan embedding model ID used when none is configured. */
const DEFAULT_MODEL = 'amazon.titan-embed-text-v2:0';
/** Default output vector length used when none is configured. */
const DEFAULT_DIMENSIONS = 1024;
/** Default input token budget used when none is configured. */
const DEFAULT_MAX_INPUT_TOKENS = 8000;

/**
 * Error thrown when an embedding operation fails. Callers can catch this typed
 * error to distinguish embedding failures from other errors and fall back to
 * keyword search.
 *
 * @example
 * try {
 *   await provider.embed(text);
 * } catch (error) {
 *   if (error instanceof EmbeddingError) {
 *     // fall back to keyword search; error.code identifies the failure kind
 *   }
 * }
 */
class EmbeddingError extends Error {
  /**
   * Creates a new EmbeddingError.
   *
   * @param {string} message - Human-readable description (never includes input text).
   * @param {Object} [options] - Additional error context.
   * @param {string} [options.code='EMBEDDING_ERROR'] - Stable, machine-readable code
   *   (e.g. `'INVOCATION_FAILED'`, `'INVALID_RESPONSE'`, `'DIMENSION_MISMATCH'`).
   * @param {Error} [options.cause] - The underlying error (e.g. the AWS SDK error).
   */
  constructor(message, { code = 'EMBEDDING_ERROR', cause } = {}) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    // >! Preserve the underlying error as `cause` so callers can inspect/log it
    // >! without the wrapper discarding the original failure detail.
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Error thrown when embedding input is invalid (not a string, or empty/whitespace).
 * A distinct subtype so callers can differentiate a bad request from a transient
 * Bedrock failure. Carries `code === 'INVALID_INPUT'`.
 *
 * @example
 * try {
 *   await provider.embed('');
 * } catch (error) {
 *   if (error instanceof EmbeddingInvalidInputError) {
 *     // the caller passed empty/invalid text; do not retry
 *   }
 * }
 */
class EmbeddingInvalidInputError extends EmbeddingError {
  /**
   * Creates a new EmbeddingInvalidInputError.
   *
   * @param {string} message - Human-readable description of why the input is invalid.
   */
  constructor(message) {
    super(message, { code: 'INVALID_INPUT' });
    this.name = 'EmbeddingInvalidInputError';
  }
}

/**
 * Wraps Bedrock `InvokeModel` to produce Titan V2 text embeddings.
 *
 * @example
 * // Production usage (client created lazily on first embed call):
 * const provider = new EmbeddingProvider({ dimensions: 1024, maxInputTokens: 8000 });
 * const vector = await provider.embed('rotate the secure data key');
 *
 * @example
 * // Test usage (inject a client with a `.send()` method — no real Bedrock call):
 * const provider = new EmbeddingProvider({ dimensions: 3, client: mockClient });
 * const vectors = await provider.embedBatch(['one', 'two']);
 */
class EmbeddingProvider {
  /**
   * Memoized Bedrock Runtime client. Populated by an injected client (test seam)
   * or lazily on first use; `null` until then so instantiation stays free.
   *
   * @private
   * @type {?Object}
   */
  #client;

  /**
   * Creates a new EmbeddingProvider.
   *
   * @param {Object} [config] - Provider configuration (from `documentation.ai.embedding` settings).
   * @param {string} [config.model='amazon.titan-embed-text-v2:0'] - Bedrock embedding model ID.
   * @param {number} [config.dimensions=1024] - Output vector length requested from Titan and asserted on the response.
   * @param {number} [config.maxInputTokens=8000] - Token budget; input is truncated to an approximate character budget derived from this before calling Bedrock.
   * @param {Object} [config.client] - Optional pre-constructed Bedrock Runtime client exposing a `.send(command)` method. Primarily for test injection; when omitted the client is created lazily on first use.
   */
  constructor({ model, dimensions, maxInputTokens, client } = {}) {
    this.model = model || DEFAULT_MODEL;
    this.dimensions = Number.isInteger(dimensions) ? dimensions : DEFAULT_DIMENSIONS;
    this.maxInputTokens = Number.isInteger(maxInputTokens) ? maxInputTokens : DEFAULT_MAX_INPUT_TOKENS;
    // >! Optional injected client (test seam). Not constructed here so that merely
    // >! instantiating the provider / attaching the layer incurs zero cold-start cost.
    this.#client = client || null;
  }

  /**
   * Embeds a single text string into a dense vector using the configured Titan model.
   *
   * @async
   * @param {string} text - The text to embed. Must be a non-empty, non-whitespace string.
   * @returns {Promise<number[]>} A vector of length `dimensions`.
   * @throws {EmbeddingInvalidInputError} When `text` is not a string, or is empty/whitespace-only.
   * @throws {EmbeddingError} When the Bedrock invocation fails, the response cannot be parsed, or the returned vector length does not match `dimensions`.
   * @example
   * const provider = new EmbeddingProvider({ dimensions: 1024, maxInputTokens: 8000 });
   * const vector = await provider.embed('rotate the secure data key');
   * console.log(vector.length); // 1024
   */
  async embed(text) {
    const inputText = this.#prepareInput(text);

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      // Amazon Titan Text Embeddings V2 request shape.
      body: JSON.stringify({
        inputText,
        dimensions: this.dimensions,
        normalize: true
      })
    });

    let response;
    try {
      response = await this.#getClient().send(command);
    } catch (error) {
      // >! Wrap the SDK error as `cause` and rethrow a typed error so callers can
      // >! catch EmbeddingError and fall back to keyword search (Req 2.4). The input
      // >! text is deliberately omitted from the message to avoid leaking content.
      throw new EmbeddingError(
        `Bedrock InvokeModel failed for embedding model "${this.model}"`,
        { code: 'INVOCATION_FAILED', cause: error }
      );
    }

    return this.#parseEmbedding(response);
  }

  /**
   * Embeds multiple texts, returning vectors aligned with the input order.
   *
   * Titan V2 `InvokeModel` embeds a single input per call, so this iterates and
   * calls {@link EmbeddingProvider#embed} sequentially. The indexer can use this
   * helper to embed a batch of extracted entries.
   *
   * @async
   * @param {string[]} texts - Array of text strings to embed.
   * @returns {Promise<number[][]>} Array of vectors, each of length `dimensions`, in the same order as `texts`.
   * @throws {EmbeddingInvalidInputError} When `texts` is not an array, or any element is not a valid input string.
   * @throws {EmbeddingError} When any underlying `embed()` call fails.
   * @example
   * const vectors = await provider.embedBatch(['first entry', 'second entry']);
   * console.log(vectors.length); // 2
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts)) {
      throw new EmbeddingInvalidInputError(
        `embedBatch expects an array of strings, received ${typeof texts}`
      );
    }

    const vectors = [];
    for (const text of texts) {
      // Sequential embedding keeps request volume predictable and preserves order.
      vectors.push(await this.embed(text));
    }
    return vectors;
  }

  /**
   * Lazily resolves the Bedrock Runtime client, constructing it on first use and
   * memoizing it for subsequent calls.
   *
   * @private
   * @returns {Object} A Bedrock Runtime client exposing a `.send(command)` method.
   */
  #getClient() {
    if (!this.#client) {
      // >! Construct the Bedrock client only on first use. The SDK default provider
      // >! chain resolves the region from the Lambda environment (AWS_REGION); do not
      // >! hardcode a region or credentials here.
      this.#client = new BedrockRuntimeClient({});
    }
    return this.#client;
  }

  /**
   * Validates and normalizes embedding input: rejects non-strings and
   * empty/whitespace-only input, then truncates to the configured character budget.
   *
   * @private
   * @param {string} text - Raw input text.
   * @returns {string} The validated, length-capped input text.
   * @throws {EmbeddingInvalidInputError} When `text` is not a string or is empty/whitespace-only.
   */
  #prepareInput(text) {
    // >! Treat all input as untrusted; validate type and content before use.
    if (typeof text !== 'string') {
      throw new EmbeddingInvalidInputError(
        `Embedding input must be a string, received ${typeof text}`
      );
    }
    if (text.trim().length === 0) {
      // Embedding empty/whitespace-only text is not meaningful.
      throw new EmbeddingInvalidInputError('Embedding input must not be empty or whitespace-only');
    }
    return this.#truncate(text);
  }

  /**
   * Truncates text to an approximate character budget derived from `maxInputTokens`.
   *
   * Titan does not expose a client-side tokenizer, so this approximates the token
   * budget as a character budget using ~4 characters per token (a common heuristic).
   * This is an intentional over-approximation whose purpose is a safety cap against
   * oversized payloads and runaway cost, not exact token accounting; Bedrock enforces
   * the real token limit server-side.
   *
   * @private
   * @param {string} text - Input text (already validated as a non-empty string).
   * @returns {string} `text` unchanged when within budget, otherwise sliced to the budget.
   */
  #truncate(text) {
    const maxChars = this.maxInputTokens * APPROX_CHARS_PER_TOKEN;
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars);
  }

  /**
   * Decodes and validates a Titan V2 `InvokeModel` response into an embedding vector.
   *
   * @private
   * @param {{body: Uint8Array}} response - The InvokeModel response; `body` is a `Uint8Array` of UTF-8 JSON.
   * @returns {number[]} The embedding vector of length `dimensions`.
   * @throws {EmbeddingError} When the body cannot be decoded/parsed, lacks an `embedding` array, or has the wrong length.
   */
  #parseEmbedding(response) {
    let parsed;
    try {
      // Titan V2 returns the response body as a Uint8Array of UTF-8 JSON bytes.
      const decoded = new TextDecoder().decode(response && response.body);
      parsed = JSON.parse(decoded);
    } catch (error) {
      throw new EmbeddingError('Failed to decode Bedrock embedding response body', {
        code: 'INVALID_RESPONSE',
        cause: error
      });
    }

    const embedding = parsed ? parsed.embedding : undefined;
    if (!Array.isArray(embedding)) {
      throw new EmbeddingError('Bedrock embedding response did not contain an "embedding" array', {
        code: 'INVALID_RESPONSE'
      });
    }
    if (embedding.length !== this.dimensions) {
      // >! Assert the returned vector matches the configured/requested dimensions so a
      // >! misconfigured model or store cannot silently produce mismatched vectors.
      throw new EmbeddingError(
        `Embedding dimension mismatch: expected ${this.dimensions}, received ${embedding.length}`,
        { code: 'DIMENSION_MISMATCH' }
      );
    }
    return embedding;
  }
}

module.exports = {
  EmbeddingProvider,
  EmbeddingError,
  EmbeddingInvalidInputError
};
