'use strict';

/**
 * AssistProvider — a thin wrapper around Amazon Bedrock `InvokeModel` for the SMALL
 * assist model used by `semantic-assisted` retrieval. Its sole job is to RE-RANK a set
 * of already-retrieved candidate documents by relevance to the query. It is shared (via
 * the `doc-ai-common` Lambda Layer) and consumed by the read-function's
 * {@link module:retrieval-strategy SemanticAssistedRetrieval} strategy.
 *
 * Model — Amazon Nova Micro (`amazon.nova-micro-v1:0`) by default, from
 * `documentation.ai.assist.model`. Nova `InvokeModel` request/response shapes (verified
 * against the AWS Nova user guide, see references below):
 *   Request body:  `{ schemaVersion: 'messages-v1', system: [{ text }],
 *                     messages: [{ role: 'user', content: [{ text }] }],
 *                     inferenceConfig: { maxTokens, temperature, topP } }`
 *   Response body: `{ output: { message: { role: 'assistant', content: [ { text }, ... ] } },
 *                     stopReason, usage: { inputTokens, outputTokens, totalTokens },
 *                     metrics: { latencyMs } }`
 *   (the response `body` is a `Uint8Array` of UTF-8 JSON; the assistant text is the first
 *   content block exposing a string `text` — other blocks such as `reasoningContent` /
 *   `toolUse` / `image` are ignored.)
 *
 * Design notes:
 *   - RE-RANK ONLY, NEVER PROSE: the model is instructed to return ONLY a compact JSON
 *     array of candidate indices (e.g. `[3,0,1]`) ordered by relevance. This provider
 *     returns that ordering as `number[]`; it NEVER returns model-authored text, so the
 *     caller can reorder existing results without ever inserting synthesized content
 *     (Requirement 5.2).
 *   - Deterministic: `temperature: 0` (and a low `maxTokens`) are used so the same query
 *     and candidates yield the same ordering, which keeps `semantic-assisted` testable
 *     (Requirement 5.1) and its cost bounded.
 *   - Lazy client: the `BedrockRuntimeClient` is NOT constructed at module load or in the
 *     constructor. It is created on the first `rerank()` call (or injected for tests), so
 *     merely attaching this layer costs nothing until the feature is used (Requirement
 *     7.1). The region is resolved from the Lambda environment (`AWS_REGION`) by the SDK
 *     default provider chain — it is never hardcoded.
 *   - Typed errors: `rerank()` throws {@link AssistError} (with a stable `code`) instead of
 *     swallowing failures, so the calling strategy can surface it as a typed retrieval
 *     error (Requirement 5.3; the graceful degrade + cost logging is added in task 7.2).
 *   - Bounded cost: candidates are capped to `maxCandidates` and each candidate's
 *     title/excerpt is truncated to a small character budget before being sent, so token
 *     usage (and therefore cost) stays bounded regardless of how large the candidate set
 *     or documents are.
 *
 * Security:
 *   - AWS SDK v3 is provided by the Lambda runtime and required normally; this layer
 *     bundles no production dependencies and no credentials (see AGENTS.md).
 *   - The query and candidate text are treated as UNTRUSTED (they originate from callers
 *     and indexed documents and may contain prompt-injection). The model output is ALSO
 *     treated as untrusted: it is parsed strictly into integer indices only, prose is
 *     rejected, and model text is never echoed into results — so injection cannot alter
 *     what content is returned, only (at most) its ordering.
 *   - Error messages never include the query or candidate text, to avoid leaking
 *     caller/indexed content in logs.
 *
 * @module assist-provider
 * @example
 * const { AssistProvider } = require('/opt/nodejs/assist-provider');
 *
 * const assist = new AssistProvider({ model: 'amazon.nova-micro-v1:0', maxCandidates: 25 });
 *
 * const { order, usage } = await assist.rerank({
 *   query: 'rotate the cache secure data key',
 *   candidates: [
 *     { index: 0, title: 'Caching overview', excerpt: 'How the cache stores data...' },
 *     { index: 1, title: 'Rotating the secure data key', excerpt: 'Steps to rotate...' }
 *   ],
 *   topK: 10
 * });
 * // order === [1, 0]  (most relevant candidate index first); usage carries token counts.
 *
 * @see https://docs.aws.amazon.com/nova/latest/userguide/using-invoke-api.html
 * @see https://docs.aws.amazon.com/nova/latest/userguide/complete-request-schema.html
 * @see https://docs.aws.amazon.com/nova/latest/userguide/complete-request-schema-response.html
 */

// >! AWS SDK v3 is provided by the Lambda runtime; require it normally (do NOT bundle).
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

/** Default small assist model ID used when none is configured (`documentation.ai.assist.model`). */
const DEFAULT_MODEL = 'amazon.nova-micro-v1:0';
/** Default maximum number of candidates fed to the model (`documentation.ai.assist.maxCandidates`). */
const DEFAULT_MAX_CANDIDATES = 25;
/**
 * Default maximum output tokens. A re-rank response is only a short JSON array of integer
 * indices, so a low cap bounds cost and latency while leaving ample room for the ordering.
 * @constant {number}
 */
const DEFAULT_MAX_TOKENS = 512;
/** Default per-candidate title character budget (bounds tokens/cost). */
const DEFAULT_MAX_TITLE_CHARS = 160;
/** Default per-candidate excerpt character budget (bounds tokens/cost). */
const DEFAULT_MAX_EXCERPT_CHARS = 240;
/** Default query character budget (bounds tokens/cost). */
const DEFAULT_MAX_QUERY_CHARS = 512;

/**
 * Bedrock SDK error `name`s that indicate the requested assist model is not available or
 * not usable in the targeted region/account (as opposed to a transient/throttling failure).
 * When `rerank()`'s underlying invocation catches an error whose `name` is in this set, it
 * classifies the wrapped {@link AssistError} as `code: 'MODEL_NOT_AVAILABLE'` so callers can
 * log it distinctly as a configuration problem (e.g. an inference profile ID that is not
 * enabled or reachable from the deployment region) rather than a routine invocation failure.
 * Mirrors the classification in {@link module:embedding-provider EmbeddingProvider}. See
 * Requirement 10.5 (cross-region model access). Unlike the embedding path, no region/client
 * override accompanies this classification: the assist model relies on AWS's server-side
 * cross-region routing via a configured inference profile ID (Requirement 10.3).
 *
 * @constant {Set<string>}
 */
const MODEL_UNAVAILABLE_ERROR_NAMES = new Set([
  'ResourceNotFoundException',
  'ValidationException',
  'AccessDeniedException'
]);

/**
 * System prompt constraining the assist model to a strict re-rank function that emits ONLY
 * a JSON array of candidate indices — never prose or new content (Requirement 5.2).
 *
 * @constant {string}
 */
const RERANK_SYSTEM_PROMPT =
  'You are a deterministic re-ranking function for a documentation search system. ' +
  'You receive a search query and a numbered list of candidate documents. ' +
  'Reorder the candidates from most to least relevant to the query. ' +
  'Respond with ONLY a compact JSON array of the candidate numbers, most relevant first, ' +
  'for example: [2,0,1]. ' +
  'Do NOT output any prose, explanation, markdown, code fences, or new text. ' +
  'Do NOT invent numbers. Use only the candidate numbers provided, each at most once.';

/**
 * Error thrown when an assist (re-rank) operation fails. Callers can catch this typed error
 * to distinguish an assist failure from other errors and surface it as a typed retrieval
 * error (task 7.2 converts it into a graceful degrade to plain semantic + cost logging).
 *
 * Mirrors {@link module:embedding-provider EmbeddingError}'s shape (`message`, `code`,
 * optional `cause`).
 *
 * @example
 * try {
 *   await assist.rerank({ query, candidates, topK });
 * } catch (error) {
 *   if (error instanceof AssistError) {
 *     // error.code is one of: INVALID_INPUT | INVOCATION_FAILED | INVALID_ASSIST_RESPONSE
 *   }
 * }
 */
class AssistError extends Error {
  /**
   * Creates a new AssistError.
   *
   * @param {string} message - Human-readable description (never includes the query or candidate text).
   * @param {Object} [options] - Additional error context.
   * @param {string} [options.code='ASSIST_ERROR'] - Stable, machine-readable code
   *   (e.g. `'INVALID_INPUT'`, `'INVOCATION_FAILED'`, `'INVALID_ASSIST_RESPONSE'`).
   * @param {Error} [options.cause] - The underlying error (e.g. the AWS SDK error).
   */
  constructor(message, { code = 'ASSIST_ERROR', cause } = {}) {
    super(message);
    this.name = 'AssistError';
    this.code = code;
    // >! Preserve the underlying error as `cause` so callers can inspect/log it without the
    // >! wrapper discarding the original failure detail.
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Wraps Bedrock `InvokeModel` to re-rank candidate documents with a small assist model.
 *
 * @example
 * // Production usage (client created lazily on first rerank call):
 * const assist = new AssistProvider({ model: 'amazon.nova-micro-v1:0' });
 * const { order, usage } = await assist.rerank({ query, candidates, topK: 10 });
 *
 * @example
 * // Test usage (inject a client with a `.send()` method — no real Bedrock call):
 * const assist = new AssistProvider({ client: mockClient });
 * const { order } = await assist.rerank({ query: 'q', candidates: [{ index: 0, title: 't' }] });
 */
class AssistProvider {
  /**
   * Memoized Bedrock Runtime client. Populated by an injected client (test seam) or lazily
   * on first use; `null` until then so instantiation stays free.
   *
   * @private
   * @type {?Object}
   */
  #client;

  /**
   * Creates a new AssistProvider.
   *
   * @param {Object} [config] - Provider configuration (from `documentation.ai.assist` settings).
   * @param {string} [config.model='amazon.nova-micro-v1:0'] - Bedrock assist model ID.
   * @param {number} [config.maxCandidates=25] - Maximum candidates sent to the model; extra candidates are dropped to bound tokens/cost.
   * @param {number} [config.maxTokens=512] - Output token cap for the ordering response (kept low; a re-rank reply is only a short array of indices).
   * @param {number} [config.maxTitleChars=160] - Per-candidate title truncation budget.
   * @param {number} [config.maxExcerptChars=240] - Per-candidate excerpt truncation budget.
   * @param {number} [config.maxQueryChars=512] - Query truncation budget.
   * @param {Object} [config.client] - Optional pre-constructed Bedrock Runtime client exposing a `.send(command)` method. Primarily for test injection; when omitted the client is created lazily on first use.
   */
  constructor({ model, maxCandidates, maxTokens, maxTitleChars, maxExcerptChars, maxQueryChars, client } = {}) {
    this.model = model || DEFAULT_MODEL;
    this.maxCandidates = (Number.isInteger(maxCandidates) && maxCandidates > 0) ? maxCandidates : DEFAULT_MAX_CANDIDATES;
    this.maxTokens = (Number.isInteger(maxTokens) && maxTokens > 0) ? maxTokens : DEFAULT_MAX_TOKENS;
    this.maxTitleChars = (Number.isInteger(maxTitleChars) && maxTitleChars > 0) ? maxTitleChars : DEFAULT_MAX_TITLE_CHARS;
    this.maxExcerptChars = (Number.isInteger(maxExcerptChars) && maxExcerptChars > 0) ? maxExcerptChars : DEFAULT_MAX_EXCERPT_CHARS;
    this.maxQueryChars = (Number.isInteger(maxQueryChars) && maxQueryChars > 0) ? maxQueryChars : DEFAULT_MAX_QUERY_CHARS;
    // >! Optional injected client (test seam). Not constructed here so that merely
    // >! instantiating the provider / attaching the layer incurs zero cold-start cost.
    this.#client = client || null;
  }

  /**
   * Re-ranks candidate documents by relevance to the query using the assist model.
   *
   * The model is asked to return ONLY a JSON array of candidate indices; the response is
   * parsed strictly into an integer array (see security notes). No model-authored text is
   * ever returned — only an ordering of the caller's existing candidate indices.
   *
   * @async
   * @param {Object} params - Re-rank parameters.
   * @param {string} params.query - The search query. Must be a non-empty string.
   * @param {Array<{index: number, title?: string, excerpt?: string}>} params.candidates - Lightweight candidate descriptors. Each must carry an integer `index` (the caller's reference for the candidate); `title`/`excerpt` are optional and truncated before use. Capped to `maxCandidates`.
   * @param {number} [params.topK] - Maximum number of indices to request in the ordering (defaults to the number of candidates).
   * @returns {Promise<{order: number[], usage: (Object|null)}>} `order` is a de-duplicated subset/permutation of the input candidate indices (most relevant first); `usage` is the raw Bedrock token-count object (`{ inputTokens, outputTokens, totalTokens }`) for cost logging in task 7.2, or `null` when absent.
   * @throws {AssistError} `INVALID_INPUT` when `query`/`candidates` are missing or malformed; `MODEL_NOT_AVAILABLE` (with `cause`) when the Bedrock invocation fails because the assist model/inference profile is missing, invalid, or unauthorized in the targeted region/account; `INVOCATION_FAILED` (with `cause`) for any other Bedrock invocation failure; `INVALID_ASSIST_RESPONSE` when the response cannot be parsed into any valid candidate index.
   * @example
   * const { order, usage } = await assist.rerank({
   *   query: 'rotate the key',
   *   candidates: [{ index: 0, title: 'A' }, { index: 1, title: 'B' }],
   *   topK: 10
   * });
   */
  async rerank({ query, candidates, topK } = {}) {
    const cleanQuery = this.#validateQuery(query);
    const cappedCandidates = this.#validateCandidates(candidates);
    // >! The valid-index set is derived from the candidates actually sent to the model, so
    // >! only those indices are ever accepted back from the (untrusted) model output.
    const validIndexSet = new Set(cappedCandidates.map((candidate) => candidate.index));
    const effectiveTopK = (Number.isInteger(topK) && topK > 0) ? topK : cappedCandidates.length;

    const requestBody = this.#buildRequestBody(cleanQuery, cappedCandidates, effectiveTopK);
    const parsed = await this.#invoke(requestBody);
    const assistantText = AssistProvider.#extractAssistantText(parsed);
    const order = AssistProvider.#parseOrder(assistantText, validIndexSet);
    const usage = (parsed && typeof parsed.usage === 'object' && parsed.usage !== null) ? parsed.usage : null;

    return { order, usage };
  }

  /**
   * Validates the query input.
   *
   * @private
   * @param {string} query - Raw query.
   * @returns {string} The validated query.
   * @throws {AssistError} `INVALID_INPUT` when `query` is not a non-empty string.
   */
  #validateQuery(query) {
    // >! Treat all input as untrusted; validate type and content before use.
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new AssistError('rerank requires a non-empty "query" string', { code: 'INVALID_INPUT' });
    }
    return query;
  }

  /**
   * Validates the candidate list, keeping only well-formed descriptors (integer `index`)
   * and capping the result to `maxCandidates` to bound tokens/cost.
   *
   * @private
   * @param {Array<Object>} candidates - Raw candidate descriptors.
   * @returns {Array<{index: number, title?: string, excerpt?: string}>} The cleaned, capped candidates.
   * @throws {AssistError} `INVALID_INPUT` when `candidates` is not a non-empty array or contains no descriptor with an integer `index`.
   */
  #validateCandidates(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new AssistError('rerank requires a non-empty "candidates" array', { code: 'INVALID_INPUT' });
    }
    const valid = candidates.filter((candidate) => candidate && Number.isInteger(candidate.index));
    if (valid.length === 0) {
      throw new AssistError('rerank candidates must each include an integer "index"', { code: 'INVALID_INPUT' });
    }
    // >! Cap the candidate count so a large candidate set cannot balloon tokens/cost.
    return valid.slice(0, this.maxCandidates);
  }

  /**
   * Builds the Nova `InvokeModel` request body for a re-rank request.
   *
   * @private
   * @param {string} query - The validated query.
   * @param {Array<{index: number, title?: string, excerpt?: string}>} candidates - The capped candidates.
   * @param {number} topK - Maximum indices to request.
   * @returns {Object} The Nova request body (`schemaVersion`/`system`/`messages`/`inferenceConfig`).
   */
  #buildRequestBody(query, candidates, topK) {
    const userPrompt = this.#buildUserPrompt(query, candidates, topK);
    // Amazon Nova `InvokeModel` request shape (messages schema).
    return {
      schemaVersion: 'messages-v1',
      system: [{ text: RERANK_SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [{ text: userPrompt }]
        }
      ],
      inferenceConfig: {
        maxTokens: this.maxTokens,
        // >! temperature 0 -> deterministic ordering for the same query + candidates, which
        // >! keeps semantic-assisted results reproducible/testable and cost predictable.
        temperature: 0,
        topP: 1
      }
    };
  }

  /**
   * Builds the user-turn prompt: the query plus a numbered candidate list (each candidate
   * on a single, whitespace-collapsed, length-capped line) and a strict output instruction.
   *
   * @private
   * @param {string} query - The validated query.
   * @param {Array<{index: number, title?: string, excerpt?: string}>} candidates - The capped candidates.
   * @param {number} topK - Maximum indices to request.
   * @returns {string} The user prompt text.
   */
  #buildUserPrompt(query, candidates, topK) {
    const candidateLines = candidates.map((candidate) => {
      const title = AssistProvider.#clip(candidate.title, this.maxTitleChars);
      const excerpt = AssistProvider.#clip(candidate.excerpt, this.maxExcerptChars);
      const summary = excerpt.length > 0 ? `${title} - ${excerpt}` : title;
      return `#${candidate.index}: ${summary}`;
    });

    return [
      `Query: ${AssistProvider.#clip(query, this.maxQueryChars)}`,
      '',
      'Candidates:',
      ...candidateLines,
      '',
      `Respond with ONLY a JSON array of at most ${topK} candidate numbers (the "#" values above), ` +
      'ordered from most to least relevant to the query. Output just the array, for example [2,0,1].'
    ].join('\n');
  }

  /**
   * Invokes the assist model and decodes the JSON response body.
   *
   * @private
   * @async
   * @param {Object} requestBody - The Nova request body.
   * @returns {Promise<Object>} The decoded response object.
   * @throws {AssistError} `MODEL_NOT_AVAILABLE` when the Bedrock call fails with a model-unavailable/config error (`ResourceNotFoundException`, `ValidationException`, `AccessDeniedException`); `INVOCATION_FAILED` for any other Bedrock call failure; `INVALID_ASSIST_RESPONSE` when the response body cannot be decoded/parsed.
   */
  async #invoke(requestBody) {
    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody)
    });

    let response;
    try {
      response = await this.#getClient().send(command);
    } catch (error) {
      // >! Wrap the SDK error as `cause` and rethrow a typed error so the calling strategy
      // >! can surface it. The query/candidate text is deliberately omitted from the message
      // >! to avoid leaking content.
      // >! Classify config errors (assist model/inference profile missing, invalid, or
      // >! unauthorized) as MODEL_NOT_AVAILABLE so callers can log them distinctly at ERROR
      // >! level, separate from routine invocation failures (Requirement 10.5). No region
      // >! override is applied here: the assist model relies on AWS's server-side
      // >! cross-region routing via the configured inference profile ID (Requirement 10.3).
      const code = MODEL_UNAVAILABLE_ERROR_NAMES.has(error && error.name)
        ? 'MODEL_NOT_AVAILABLE'
        : 'INVOCATION_FAILED';
      throw new AssistError(
        `Bedrock InvokeModel failed for assist model "${this.model}"`,
        { code, cause: error }
      );
    }

    try {
      // Nova returns the response body as a Uint8Array of UTF-8 JSON bytes.
      const decoded = new TextDecoder().decode(response && response.body);
      return JSON.parse(decoded);
    } catch (error) {
      throw new AssistError('Failed to decode assist model response body', {
        code: 'INVALID_ASSIST_RESPONSE',
        cause: error
      });
    }
  }

  /**
   * Lazily resolves the Bedrock Runtime client, constructing it on first use and memoizing
   * it for subsequent calls.
   *
   * @private
   * @returns {Object} A Bedrock Runtime client exposing a `.send(command)` method.
   */
  #getClient() {
    if (!this.#client) {
      // >! Construct the Bedrock client only on first use. The SDK default provider chain
      // >! resolves the region from the Lambda environment (AWS_REGION); do not hardcode a
      // >! region or credentials here.
      this.#client = new BedrockRuntimeClient({});
    }
    return this.#client;
  }

  /**
   * Extracts the assistant text from a Nova response: the first `output.message.content`
   * block exposing a string `text` (ignoring `reasoningContent`/`toolUse`/`image` blocks).
   *
   * @private
   * @param {Object} parsed - The decoded Nova response object.
   * @returns {string} The assistant text.
   * @throws {AssistError} `INVALID_ASSIST_RESPONSE` when no text content block is present.
   */
  static #extractAssistantText(parsed) {
    const content = parsed && parsed.output && parsed.output.message && parsed.output.message.content;
    if (!Array.isArray(content)) {
      throw new AssistError('Assist model response did not contain output.message.content', {
        code: 'INVALID_ASSIST_RESPONSE'
      });
    }
    // >! Ignore non-text blocks (reasoningContent/toolUse/image); take the first text block.
    const textBlock = content.find((block) => block && typeof block.text === 'string');
    if (!textBlock) {
      throw new AssistError('Assist model response contained no text content block', {
        code: 'INVALID_ASSIST_RESPONSE'
      });
    }
    return textBlock.text;
  }

  /**
   * Strictly parses the model's assistant text into an ordered array of valid candidate
   * indices.
   *
   * @private
   * @param {string} text - The assistant text.
   * @param {Set<number>} validIndexSet - The set of candidate indices that were sent to the model.
   * @returns {number[]} The de-duplicated ordering of valid candidate indices.
   * @throws {AssistError} `INVALID_ASSIST_RESPONSE` when no JSON array can be extracted/parsed, or it yields no valid candidate index.
   */
  static #parseOrder(text, validIndexSet) {
    // >! Treat the model output as UNTRUSTED. Extract only the first bracketed JSON array and
    // >! parse it strictly with JSON.parse (never eval). Prose is rejected, and model text is
    // >! never echoed into results — only integer indices are ever used.
    const start = text.indexOf('[');
    const end = start === -1 ? -1 : text.indexOf(']', start + 1);
    if (start === -1 || end === -1) {
      throw new AssistError('Assist model response did not contain a JSON array of indices', {
        code: 'INVALID_ASSIST_RESPONSE'
      });
    }

    let rawArray;
    try {
      rawArray = JSON.parse(text.slice(start, end + 1));
    } catch (error) {
      throw new AssistError('Assist model response ordering was not valid JSON', {
        code: 'INVALID_ASSIST_RESPONSE',
        cause: error
      });
    }
    if (!Array.isArray(rawArray)) {
      throw new AssistError('Assist model response ordering was not a JSON array', {
        code: 'INVALID_ASSIST_RESPONSE'
      });
    }

    const order = [];
    const seen = new Set();
    for (const value of rawArray) {
      // >! Accept only integers that are valid candidate indices; drop everything else
      // >! (non-integers, out-of-range values, prose tokens, and duplicates).
      if (Number.isInteger(value) && validIndexSet.has(value) && !seen.has(value)) {
        seen.add(value);
        order.push(value);
      }
    }

    if (order.length === 0) {
      throw new AssistError('Assist model response did not yield any valid candidate indices', {
        code: 'INVALID_ASSIST_RESPONSE'
      });
    }
    return order;
  }

  /**
   * Collapses whitespace in a value and truncates it to a character budget. Non-strings
   * become an empty string. Collapsing newlines keeps each candidate on one prompt line and
   * reduces the prompt-injection surface.
   *
   * @private
   * @param {*} value - The value to clip (typically a title or excerpt string).
   * @param {number} maxChars - Maximum characters to retain.
   * @returns {string} The collapsed, length-capped string (empty when `value` is not a string).
   */
  static #clip(value, maxChars) {
    if (typeof value !== 'string') {
      return '';
    }
    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed;
  }
}

module.exports = {
  AssistProvider,
  AssistError
};
