/**
 * Documentation Service
 *
 * Provides business logic for documentation search operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Documentation and code pattern search across GitHub repositories
 * - Filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
 * - Keyword-based search with relevance ranking
 * - Suggestions when no results are found, or when the matched set is large enough to warrant
 *   narrowing by type/subType
 * - Additive `availableFilters` facets (distinct type/subType/repository values with counts)
 * - Storage-only retrieval of a full source file by `filePath`/`hash` ({@link getDocument});
 *   the server never fetches from GitHub
 *
 * Searches across:
 * - Markdown documentation from GitHub repositories
 * - CloudFormation template sections and patterns
 * - Python and Node.js code from app starters
 * - cache-data package usage patterns
 * - README headings and top-of-file comments
 *
 * @module services/documentation
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');
const { hashContentPath, stripSlug } = require('../utils/content-hash');
const ContentSizer = require('../utils/content-sizer');

/**
 * Default Lambda mount path for the `doc-ai-common` layer modules. In the Lambda runtime
 * the layer is extracted to `/opt/nodejs`; tests override this via `DOC_AI_LAYER_PATH` to
 * point at the local layer `nodejs/` directory so the real layer modules load without the
 * runtime layer present.
 *
 * @constant {string}
 */
const DEFAULT_DOC_AI_LAYER_PATH = '/opt/nodejs';

/**
 * Vector-store label reported in the semantic-assisted usage/degrade log lines. S3 Vectors
 * is the sole backend (spec 0-0-6, Requirement 7), so this is a fixed label rather than a
 * configurable setting. Logging only — it never affects retrieval behavior.
 *
 * @constant {string}
 */
const VECTOR_STORE_LABEL = 's3-vectors';

/**
 * `totalResults` count at (or above) which the search envelope's existing `suggestions`
 * array gains a "narrow by type/subType" nudge (spec 0-0-6, Requirement 8.4). Below this
 * the result set is considered small enough that refinement guidance is noise, and
 * `suggestions` keeps its current zero-results-only usage.
 *
 * @constant {number}
 */
const NARROW_SUGGESTION_THRESHOLD = 25;

/**
 * Stable, machine-parseable prefix for the discovery-observability `discovery_search` log
 * line (spec 0-0-7, Requirement 12.1/12.4), following the existing `DOC_AI_USAGE` convention
 * (`doc-ai-common` `retrieval-strategy.js`): a fixed token, one space, then compact JSON. The
 * read-function runs with `AWS_LAMBDA_LOG_FORMAT=text`, so a CloudWatch Logs metric filter can
 * only key on a literal substring, not a JSON field selector.
 *
 * @constant {string}
 */
const DISCOVERY_SEARCH_EVENT = 'DISCOVERY_SEARCH';

/**
 * Additional literal, stable token appended to the `discovery_search` log line whenever
 * `emptyResult` is `true` (spec 0-0-7, Requirement 12.4/12.6; `template.yml`
 * `DiscoverySearchZeroResultMetricFilter`). The metric filter keys on this exact substring,
 * so it MUST be present on the line whenever the matched set is empty, and MUST NOT appear
 * when it is not.
 *
 * @constant {string}
 */
const DISCOVERY_SEARCH_EMPTY_TOKEN = 'DISCOVERY_SEARCH_EMPTY';

/**
 * Stable, machine-parseable prefix for the discovery-observability `discovery_tool_call` log
 * line (spec 0-0-7, Requirement 12.2/12.3), emitted once per `tools/call` dispatch.
 *
 * @constant {string}
 */
const DISCOVERY_TOOL_CALL_EVENT = 'DISCOVERY_TOOL_CALL';

/**
 * Stable, machine-parseable prefix for the discovery-observability `discovery_manifest_degraded`
 * log line (spec 0-0-7, Requirement 12.1; design section 13). Emitted by
 * {@link logManifestDegraded}, called from the corpus-manifest degradation ladder once task
 * 13.1 implements it; defined now so that task has a ready-made, tested injection point.
 *
 * @constant {string}
 */
const DISCOVERY_MANIFEST_DEGRADED_EVENT = 'DISCOVERY_MANIFEST_DEGRADED';

/**
 * Count query tokens for the `discovery_search` log event WITHOUT logging the tokens or the
 * query text itself (Requirement 12.5 — never log query text alongside caller identity).
 * A simple whitespace split is sufficient here: this is an observability count, not a
 * retrieval-affecting tokenization (that remains `normalize.js`/`doc-index.js`).
 *
 * @param {string} query - Trimmed query string.
 * @returns {number} Number of whitespace-separated tokens (`0` for an empty string).
 * @example
 * countQueryTokens('cache-data rotate key'); // => 3
 */
function countQueryTokens(query) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    return 0;
  }
  return query.trim().split(/\s+/).length;
}

/**
 * Derive the list of filters actually supplied on a `search_documentation` call, for the
 * `filtersApplied` field of the `discovery_search` log event (Requirement 12.1). Covers
 * `type`, `subType`, `ghusers`, and the `repository`/`repositoryType`/`namespace` filters
 * added by task 12.1 (design 7.1).
 *
 * @param {Object} options - The filter options supplied to {@link search}.
 * @param {string} [options.type] - Type filter, if supplied.
 * @param {string} [options.subType] - SubType filter, if supplied.
 * @param {Array<string>} [options.ghusers] - GitHub users/orgs filter, if supplied.
 * @param {string} [options.repository] - Repository filter, if supplied.
 * @param {string} [options.repositoryType] - RepositoryType filter, if supplied.
 * @param {string} [options.namespace] - Namespace filter, if supplied.
 * @returns {Array<string>} Names of the filters that were supplied, e.g. `['type', 'ghusers']`.
 * @example
 * filtersAppliedFrom({ type: 'documentation', ghusers: ['63klabs'] }); // => ['type', 'ghusers']
 */
function filtersAppliedFrom({ type, subType, ghusers, repository, repositoryType, namespace } = {}) {
  const applied = [];
  if (typeof type === 'string' && type.length > 0) {
    applied.push('type');
  }
  if (typeof subType === 'string' && subType.length > 0) {
    applied.push('subType');
  }
  if (Array.isArray(ghusers) && ghusers.length > 0) {
    applied.push('ghusers');
  }
  if (typeof repository === 'string' && repository.length > 0) {
    applied.push('repository');
  }
  if (typeof repositoryType === 'string' && repositoryType.length > 0) {
    applied.push('repositoryType');
  }
  if (typeof namespace === 'string' && namespace.length > 0) {
    applied.push('namespace');
  }
  return applied;
}

/**
 * Best-effort label of the retrieval strategy used for a `search_documentation` call, for the
 * `strategy` field of the `discovery_search` log event (Requirement 12.1).
 *
 * Mirrors the SAME decision inputs `selectStrategy` (`doc-ai-common` `retrieval-strategy.js`)
 * uses to choose a primary strategy, without importing the layer or re-deriving its internal
 * fallback bookkeeping: the AI feature flag, the configured `retrievalMode`, and whether the
 * caller's tier qualifies. This is independent of whether a semantic call later degrades to
 * keyword at runtime (e.g. an embedding failure) — that degrade path already has its own log
 * line (`doc-ai-common` `FallbackRetrieval`); this label reports what was SELECTED, which is
 * what an observability signal on "is `instructions` steering agents toward semantic search"
 * needs.
 *
 * @param {Object} ai - The `documentation.ai` settings block.
 * @param {string} tier - Resolved caller tier (defaults applied upstream).
 * @returns {string} One of `'keyword'`, `'semantic'`, or `'semantic-assisted'`.
 */
function strategyLabelFor(ai, tier) {
  if (!ai || ai.enabled !== true || ai.retrievalMode === 'keyword') {
    return 'keyword';
  }

  const tierRankOrder = { public: 0, authenticated: 1, paid: 2, private: 3 };
  const callerRank = tierRankOrder[tier] ?? 0;
  const minRank = tierRankOrder[ai.minTier] ?? tierRankOrder.paid;
  if (callerRank < minRank) {
    return 'keyword';
  }

  return ai.retrievalMode === 'semantic-assisted' ? 'semantic-assisted' : 'semantic';
}

/**
 * Emit the structured `discovery_search` observability log event (Requirement 12.1, 12.4,
 * 12.5). Called once per `search_documentation` call, on both cache hit and cache miss, so
 * the zero-result signal and the CloudWatch metric baseline (R12.6) reflect every call rather
 * than only cache misses.
 *
 * Logs `tokenCount` (a count, never the query text or tokens) and never logs caller identity
 * or any credential/PII alongside it (Requirement 12.5). Emitted at INFO so it is visible in
 * PROD (consistent with `DOC_AI_USAGE`, which the maintainer also wants visible there).
 *
 * The line always carries the stable {@link DISCOVERY_SEARCH_EVENT} token; it ADDITIONALLY
 * carries the literal {@link DISCOVERY_SEARCH_EMPTY_TOKEN} substring whenever `emptyResult` is
 * `true`, per the `DiscoverySearchZeroResultMetricFilter` contract in `template.yml` (the
 * read-function logs in TEXT format, so the filter matches a literal substring, not a JSON
 * field).
 *
 * @param {Object} fields - Event fields.
 * @param {number} fields.tokenCount - Query token count (not the tokens themselves).
 * @param {Array<string>} fields.filtersApplied - Filter names supplied on the call.
 * @param {number} fields.resultCount - Size of the matched result set.
 * @param {string} fields.strategy - Retrieval strategy label (`keyword`/`semantic`/`semantic-assisted`).
 * @param {boolean} fields.emptyResult - Whether the matched result set was empty.
 * @param {?string} [fields.manifestTier] - Corpus-manifest degradation tier, when available
 *   (task 13.1); `null` until that task populates it.
 * @param {?string} [fields.manifestSource] - Corpus-manifest source, when available (task
 *   11.1); `null` until that task populates it.
 * @example
 * logDiscoverySearch({
 *   tokenCount: 2, filtersApplied: ['type'], resultCount: 0, strategy: 'keyword',
 *   emptyResult: true, manifestTier: null, manifestSource: null
 * });
 */
function logDiscoverySearch({
  tokenCount,
  filtersApplied,
  resultCount,
  strategy,
  emptyResult,
  manifestTier = null,
  manifestSource = null
}) {
  try {
    const payload = {
      tokenCount,
      filtersApplied: Array.isArray(filtersApplied) ? filtersApplied : [],
      resultCount,
      strategy,
      emptyResult: emptyResult === true,
      manifestTier,
      manifestSource
    };
    // >! The literal DISCOVERY_SEARCH_EMPTY_TOKEN substring is appended to the line itself
    // >! (not just the JSON field) so the TEXT-format log line stays filterable by a plain
    // >! CloudWatch Logs metric filter substring match (see template.yml contract comment).
    const emptySuffix = payload.emptyResult ? ` ${DISCOVERY_SEARCH_EMPTY_TOKEN}` : '';
    DebugAndLog.info(`${DISCOVERY_SEARCH_EVENT} ${JSON.stringify(payload)}${emptySuffix}`);
  } catch {
    // >! Best-effort telemetry: swallow any logging error so it can never fail the request.
  }
}

/**
 * Emit the structured `discovery_tool_call` observability log event (Requirement 12.2, 12.3).
 *
 * Intended to be called once per `tools/call` dispatch from the shared JSON-RPC router
 * injection point (`utils/json-rpc-router.js` `handleToolsCall`), NOT duplicated per
 * controller, so tool-selection frequency and first-tool-in-session are derivable from one
 * log line per call regardless of which tool was invoked.
 *
 * `firstInSession` is a per-container (per warm Lambda execution environment) signal, not a
 * true per-client-session signal: the MCP server is stateless across requests, so "session"
 * here means "the first tool call this container has observed since its last cold start" —
 * an honest, documented limitation (design section 13) rather than a synthetic session id.
 *
 * @param {string} toolName - Invoked tool name.
 * @param {boolean} firstInSession - Whether this is the first tool call this container has
 *   observed since cold start.
 * @example
 * logDiscoveryToolCall('search_documentation', true);
 */
function logDiscoveryToolCall(toolName, firstInSession) {
  try {
    const payload = { toolName, firstInSession: firstInSession === true };
    DebugAndLog.info(`${DISCOVERY_TOOL_CALL_EVENT} ${JSON.stringify(payload)}`);
  } catch {
    // >! Best-effort telemetry: swallow any logging error so it can never fail the request.
  }
}

/**
 * Emit the structured `discovery_manifest_degraded` observability log event (design section
 * 13, Requirement 12.1). Defined and exported now so the corpus-manifest degradation ladder
 * (task 13.1, not yet implemented) can call it directly without re-deriving the log shape;
 * there is no existing degradation code path to call this from yet.
 *
 * @param {string} fromTier - Manifest tier degraded FROM (e.g. `'full'`).
 * @param {string} toTier - Manifest tier degraded TO (e.g. `'compact'`).
 * @param {string} reason - Short, non-sensitive reason for the degradation (e.g. `'budget-exceeded'`).
 * @example
 * logManifestDegraded('full', 'compact', 'budget-exceeded');
 */
function logManifestDegraded(fromTier, toTier, reason) {
  try {
    const payload = { fromTier, toTier, reason };
    DebugAndLog.info(`${DISCOVERY_MANIFEST_DEGRADED_EVENT} ${JSON.stringify(payload)}`);
  } catch {
    // >! Best-effort telemetry: swallow any logging error so it can never fail the request.
  }
}

/**
 * Corpus-manifest degradation ladder tier names (spec 0-0-7, Requirement 8.8; design
 * section 9.3). Ordered richest-to-leanest; {@link selectManifestTier} walks this order.
 *
 * - `full` — every repository with its complete recorded detail (name, owner,
 *   repositoryType, namespace, sections, ref).
 * - `compact` — name and repositoryType only, when `full` would exceed the byte budget.
 * - `count` — a total count with `omitted: true`, when even `compact` would exceed the
 *   budget.
 *
 * @constant {{FULL: string, COMPACT: string, COUNT: string}}
 */
const MANIFEST_TIER = {
  FULL: 'full',
  COMPACT: 'compact',
  COUNT: 'count'
};

/**
 * Build the `full` tier shape: every repository's complete recorded detail (design 9.3).
 *
 * @param {Array<Object>} repositories - Corpus manifest repositories from `models/corpus.js`.
 * @returns {Array<{name: ?string, owner: ?string, repositoryType: ?string, namespace: ?string, sections: ?number, ref: ?string}>}
 */
function buildFullManifestEntries(repositories) {
  return repositories.map((repo) => ({
    name: repo?.name ?? null,
    owner: repo?.owner ?? null,
    repositoryType: repo?.repositoryType ?? null,
    namespace: repo?.namespace ?? null,
    sections: repo?.sections ?? null,
    ref: repo?.ref ?? null
  }));
}

/**
 * Build the `compact` tier shape: repository name and repositoryType only (design 9.3).
 *
 * @param {Array<Object>} repositories - Corpus manifest repositories from `models/corpus.js`.
 * @returns {Array<{name: ?string, repositoryType: ?string}>}
 */
function buildCompactManifestEntries(repositories) {
  return repositories.map((repo) => ({
    name: repo?.name ?? null,
    repositoryType: repo?.repositoryType ?? null
  }));
}

/**
 * Build the `count` tier shape: a total count with an omitted-listing indication (design 9.3).
 *
 * @param {Array<Object>} repositories - Corpus manifest repositories from `models/corpus.js`.
 * @returns {{repositoryCount: number, omitted: true}}
 */
function buildCountManifestSummary(repositories) {
  return { repositoryCount: repositories.length, omitted: true };
}

/**
 * Serialized byte length of a candidate `indexedRepositories` block, measured the same way
 * as the overall response ({@link ContentSizer}), so budget comparisons are apples-to-apples.
 *
 * @param {Object} block - A candidate `indexedRepositories` block (any tier shape).
 * @returns {number} UTF-8 byte length of the block's JSON serialization.
 */
function measureManifestBlockBytes(block) {
  return ContentSizer.measure(JSON.stringify(block)).byteLength;
}

/**
 * Select the richest corpus-manifest tier that fits within `maxBytes` (Requirement 8.7,
 * 8.8; design 9.3). Degrades `full` -> `compact` -> `count`; when even `count` does not
 * fit, returns `null` so the caller omits `indexedRepositories` entirely rather than
 * violate the budget (Requirement 8.8's "indication that the listing was omitted" case).
 *
 * This selection is against the manifest's OWN byte budget (`MCP_CORPUS_MANIFEST_MAX_BYTES`,
 * R8.7) and is independent of the overall response size threshold, which is checked
 * separately and may force a further degrade (design 9.4, {@link selectManifestForResponse}).
 *
 * @param {Array<Object>} repositories - Corpus manifest repositories from `models/corpus.js`.
 * @param {number} maxBytes - The manifest's own byte budget (`corpusManifestMaxBytes`).
 * @returns {?{tier: string, block: Object}} The selected tier and its block, or `null` when
 *   no tier fits.
 */
function selectManifestTier(repositories, maxBytes) {
  const candidates = [
    { tier: MANIFEST_TIER.FULL, entries: buildFullManifestEntries(repositories) },
    { tier: MANIFEST_TIER.COMPACT, entries: buildCompactManifestEntries(repositories) }
  ];

  for (const candidate of candidates) {
    const block = { tier: candidate.tier, repositories: candidate.entries };
    if (measureManifestBlockBytes(block) <= maxBytes) {
      return { tier: candidate.tier, block };
    }
  }

  const countBlock = { tier: MANIFEST_TIER.COUNT, ...buildCountManifestSummary(repositories) };
  if (measureManifestBlockBytes(countBlock) <= maxBytes) {
    return { tier: MANIFEST_TIER.COUNT, block: countBlock };
  }

  return null;
}

/**
 * Assemble the additive `indexedRepositories` response field with budget-aware degradation
 * (Requirements 8.1, 8.2, 8.4, 8.7, 8.8, 8.9).
 *
 * Assembly order follows design section 9.4 exactly:
 * 1. `results` (and the rest of `returnObject`) are already built by the caller — this
 *    function never sees or touches them, so `indexedRepositories` can never cause a
 *    caller's requested results to be truncated (R8.9).
 * 2. Select the manifest tier that fits the manifest's own byte budget
 *    (`corpusManifestMaxBytes`, R8.7/R8.8), degrading `full` -> `compact` -> `count`.
 * 3. Measure that candidate manifest TOGETHER WITH the already-serialized rest of the
 *    response against the response's overall size threshold ({@link ContentSizer}); if it
 *    does not fit, degrade one more tier (and log via {@link logManifestDegraded}); if
 *    `count` still does not fit, omit the manifest entirely rather than push the response
 *    over the hard cap (R8.8's binding constraint).
 *
 * @param {Array<Object>} repositories - Corpus manifest repositories from `models/corpus.js`
 *   (`getCorpusManifest()`'s `repositories` field; never `null` here — the caller omits the
 *   whole field upstream when the manifest source is `'unavailable'`).
 * @param {string} restOfResponseJson - JSON string of the response envelope WITHOUT
 *   `indexedRepositories`, used to measure the total response size the manifest would be
 *   added to (design 9.4 step 3).
 * @returns {{tier: string, block: Object}|null} The selected tier and block to attach as
 *   `indexedRepositories`, or `null` when no tier fits even after full degradation — the
 *   caller omits the field entirely in that case (R8.8).
 */
function assembleIndexedRepositories(repositories, restOfResponseJson) {
  const maxBytes = Config.settings().documentation.corpusManifestMaxBytes;
  const budgetSelection = selectManifestTier(repositories, maxBytes);

  if (!budgetSelection) {
    // >! Even the `count` tier exceeds its OWN budget — nothing to attach. No degrade log
    // >! here: there is no "from" tier that was ever a candidate for this response.
    return null;
  }

  // >! Log the budget-driven degrade (R8.8): `full` is always the richest tier a non-empty
  // >! corpus could have been served at, so any OTHER tier being selected here means the
  // >! ladder stepped down against `corpusManifestMaxBytes` before the response-size check
  // >! below ever runs.
  if (budgetSelection.tier !== MANIFEST_TIER.FULL) {
    const priorTier = budgetSelection.tier === MANIFEST_TIER.COMPACT ? MANIFEST_TIER.FULL : MANIFEST_TIER.COMPACT;
    logManifestDegraded(priorTier, budgetSelection.tier, 'manifest-byte-budget-exceeded');
  }

  const restBytes = ContentSizer.measure(restOfResponseJson).byteLength;
  const threshold = ContentSizer.DEFAULT_SIZE_THRESHOLD;

  // >! Degrade (design 9.4 step 4): walk down from the budget-selected tier while the
  // >! TOTAL (rest-of-response + manifest) would exceed the response's hard cap. `results`
  // >! is part of `restOfResponseJson` and is never touched here (R8.9).
  const ladder = [MANIFEST_TIER.FULL, MANIFEST_TIER.COMPACT, MANIFEST_TIER.COUNT];
  let currentTier = budgetSelection.tier;
  let currentBlock = budgetSelection.block;

  while (ladder.indexOf(currentTier) !== -1) {
    const manifestBytes = measureManifestBlockBytes(currentBlock);
    if (restBytes + manifestBytes <= threshold) {
      if (currentTier !== budgetSelection.tier) {
        logManifestDegraded(budgetSelection.tier, currentTier, 'response-size-threshold-exceeded');
      }
      return { tier: currentTier, block: currentBlock };
    }

    const nextIndex = ladder.indexOf(currentTier) + 1;
    if (nextIndex >= ladder.length) {
      break;
    }
    const nextTier = ladder[nextIndex];
    currentBlock = nextTier === MANIFEST_TIER.FULL
      ? { tier: nextTier, repositories: buildFullManifestEntries(repositories) }
      : nextTier === MANIFEST_TIER.COMPACT
        ? { tier: nextTier, repositories: buildCompactManifestEntries(repositories) }
        : { tier: nextTier, ...buildCountManifestSummary(repositories) };
    currentTier = nextTier;
  }

  // >! Even `count` would push the TOTAL response over the hard cap: omit the manifest
  // >! entirely rather than violate R8.8's binding constraint. Still log the degrade from
  // >! whatever tier the budget selection chose, so the omission is observable.
  if (budgetSelection.tier !== null) {
    logManifestDegraded(budgetSelection.tier, 'omitted', 'response-size-threshold-exceeded');
  }
  return null;
}

/**
 * Result fields exposed as facets in `availableFilters`. These are exactly the fields the
 * `search_documentation` tool accepts as filters, so every facet value an agent sees is a
 * value it can pass straight back as a filter.
 *
 * `repository` is kept distinct from the index-wide corpus manifest (design 9.3): this facet
 * is computed over the matched result set only, while the corpus manifest lists every
 * indexed repository regardless of what the query matched (spec 0-0-7, Requirement 5.5).
 *
 * @constant {Array<string>}
 */
const FACET_FIELDS = ['type', 'subType', 'repository'];

/**
 * Count the distinct values of one facet field across a result set.
 *
 * Empty, `null`, `undefined`, and non-string values are ignored so a partially indexed
 * result (whose `type`/`subType` may be `''`) never produces a facet value an agent cannot
 * filter by. Ordering is deterministic — descending count, then ascending value — so cached
 * and freshly computed envelopes are byte-identical for the same result set.
 *
 * @param {Array<Object>} results - Assembled search result objects.
 * @param {string} field - Result field to count (`'type'` or `'subType'`).
 * @returns {Array<{value: string, count: number}>} Distinct values with counts, or `[]` when none.
 * @example
 * countFacetValues([{ type: 'documentation' }, { type: 'documentation' }], 'type');
 * // => [{ value: 'documentation', count: 2 }]
 */
function countFacetValues(results, field) {
  const counts = new Map();
  for (const result of results) {
    const value = result ? result[field] : null;
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
}

/**
 * Build the additive `availableFilters` facet block for a search result set.
 *
 * Lists the distinct `type`, `subType`, and `repository` values present with their counts so
 * an agent can see exactly what a follow-up query can be narrowed to (spec 0-0-6, Requirement
 * 8.1; `repository` added by spec 0-0-7, Requirement 5.5). Returns `undefined` when no facet
 * value is present at all (no results, or results whose `type`/`subType`/`repository` are
 * absent), which keeps the envelope byte-identical to the pre-facet response in those cases —
 * the field is additive and optional (Requirement 8.5).
 *
 * Facets are computed over the results the retrieval path assembled for this request; a
 * field with no values is omitted rather than emitted as an empty array.
 *
 * @param {Array<Object>} results - Assembled search result objects.
 * @returns {?{type: Array<{value: string, count: number}>, subType: Array<{value: string, count: number}>, repository: Array<{value: string, count: number}>}} Facet block, or `undefined` when there is nothing to report.
 * @example
 * buildAvailableFilters([
 *   { type: 'documentation', subType: 'guide', repository: 'cache-data' },
 *   { type: 'documentation', subType: 'reference', repository: 'cache-data' }
 * ]);
 * // => { type: [{ value: 'documentation', count: 2 }],
 * //      subType: [{ value: 'guide', count: 1 }, { value: 'reference', count: 1 }],
 * //      repository: [{ value: 'cache-data', count: 2 }] }
 */
function buildAvailableFilters(results) {
  const list = Array.isArray(results) ? results : [];
  const facets = {};
  for (const field of FACET_FIELDS) {
    const values = countFacetValues(list, field);
    if (values.length > 0) {
      facets[field] = values;
    }
  }

  return Object.keys(facets).length > 0 ? facets : undefined;
}

/**
 * Append the "narrow by type/subType" nudge to a search envelope's `suggestions` array when
 * the matched set is large (spec 0-0-6, Requirement 8.4).
 *
 * Extends the existing zero-results-only usage of `suggestions` without changing its type:
 * the array is copied, existing entries are preserved in order, and the hint is appended.
 * Below the threshold the original entries are returned unchanged.
 *
 * @param {Array<string>} suggestions - Suggestions produced by the retrieval path.
 * @param {number} totalResults - Size of the matched set (pre-limit).
 * @returns {Array<string>} Suggestions, with the narrowing hint appended when warranted.
 * @example
 * withNarrowSuggestion([], 120);
 * // => ['120 results matched. Narrow the search with a type or subType filter (see availableFilters).']
 */
function withNarrowSuggestion(suggestions, totalResults) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (!(totalResults >= NARROW_SUGGESTION_THRESHOLD)) {
    return list;
  }

  return [
    ...list,
    `${totalResults} results matched. Narrow the search with a type or subType filter (see availableFilters).`
  ];
}

/**
 * Require a `doc-ai-common` layer module by base name.
 *
 * The read-function does NOT declare the layer as an npm dependency (it is provided at
 * runtime by the attached Lambda Layer), so the layer's modules are loaded from the layer
 * mount path via this helper rather than a package import. Isolating the require here keeps
 * the layer-load target in one place and lets tests point `DOC_AI_LAYER_PATH` at the local
 * layer directory.
 *
 * @param {string} name - Layer module base name (e.g. `'embedding-provider'`, `'retrieval-strategy'`).
 * @returns {Object} The required layer module's exports.
 * @example
 * const { selectStrategy } = loadLayerModule('retrieval-strategy');
 */
function loadLayerModule(name) {
  // >! Layer path from a fixed env var with a safe default; `name` is a first-party
  // >! constant (never user input), so this is not a dynamic-require injection risk.
  const base = process.env.DOC_AI_LAYER_PATH || DEFAULT_DOC_AI_LAYER_PATH;
  return require(`${base}/${name}`);
}

/**
 * Memoized doc-ai retrieval components, constructed once per warm container the first time
 * an AI-enabled request is served. Memoizing at module scope keeps the SemanticRetrieval
 * query-embedding cache warm across invocations and avoids re-instantiating the
 * Bedrock/vector clients per request. Stays `null` on the disabled path so keyword-only
 * deployments never load the layer or construct any AWS AI clients.
 *
 * @type {?{embeddingProvider: Object, vectorStore: Object, semantic: Object, assist: Object, semanticAssisted: Object}}
 */
let docAiComponents = null;

/**
 * Map ranked vector hits back to the existing `search_documentation` result shape.
 *
 * Injected into the semantic strategy so semantic hits are enriched with the SAME content
 * metadata the keyword path returns and are therefore indistinguishable in shape from
 * keyword results. Content metadata is fetched via
 * `Models.DocIndex.getContentMetadataByHashes` (`pk=content:{hash}, sk=v:{version}:metadata`);
 * hits whose metadata is missing are dropped, while ranked order and each hit's cosine
 * `score` (mapped onto `relevanceScore`) are preserved so the two retrieval paths share one
 * enrichment source and one result shape.
 *
 * @param {Array<{hash: string, score: number, metadata: Object}>} hits - Ranked vector hits from the store.
 * @param {Object} context - Retrieval context supplied by the semantic strategy.
 * @param {string} context.version - Active index version to read content metadata from.
 * @returns {Promise<Array<Object>>} Result objects in `queryIndex` shape, in ranked order.
 */
async function buildResults(hits, context) {
  const rankedHits = Array.isArray(hits) ? hits : [];
  if (rankedHits.length === 0) {
    return [];
  }

  const version = context && context.version;
  const tableName = Config.settings().docIndexTable;
  const hashes = rankedHits.map((hit) => hit.hash);

  // >! Fetch content metadata (hash -> item) in the model layer. Missing items are
  // >! tolerated there and simply absent from the map, so a partial index cannot fail here.
  const metadataByHash = await Models.DocIndex.getContentMetadataByHashes(tableName, version, hashes);

  const results = [];
  for (const hit of rankedHits) {
    const content = metadataByHash[hit.hash];
    // >! Drop hits whose content metadata is missing so semantic results never contain
    // >! half-populated entries; ranked order is preserved for the remaining hits.
    if (!content) {
      continue;
    }
    results.push({
      title: content.title || '',
      excerpt: (content.excerpt || '').substring(0, 200),
      filePath: content.path || '',
      githubUrl: content.githubUrl || null,
      type: content.type || '',
      subType: content.subType || '',
      // >! Cosine similarity from the vector hit becomes the result's relevanceScore so the
      // >! semantic and keyword result shapes are identical.
      relevanceScore: hit.score,
      repository: content.repository || null,
      repositoryType: content.repositoryType || null,
      namespace: content.namespace || null,
      codeExamples: content.codeExamples || undefined,
      context: content.context || undefined
    });
  }

  return results;
}

/**
 * Construct (once per container) and return the memoized doc-ai retrieval components for
 * the semantic and semantic-assisted paths. Layer modules are loaded via
 * {@link loadLayerModule}; the Bedrock/vector clients they wrap are created lazily on first
 * use, so this is safe to call as soon as the feature is enabled (Requirement 7.1).
 *
 * @param {Object} ai - The `documentation.ai` settings block.
 * @returns {{embeddingProvider: Object, vectorStore: Object, semantic: Object, assist: Object, semanticAssisted: Object}} The memoized components.
 */
function getDocAiComponents(ai) {
  if (docAiComponents) {
    return docAiComponents;
  }

  const { EmbeddingProvider } = loadLayerModule('embedding-provider');
  const { createVectorStore } = loadLayerModule('vector-store');
  const { SemanticRetrieval, SemanticAssistedRetrieval } = loadLayerModule('retrieval-strategy');
  const { AssistProvider } = loadLayerModule('assist-provider');

  const embeddingProvider = new EmbeddingProvider({
    model: ai.embedding.model,
    dimensions: ai.embedding.dimensions,
    maxInputTokens: ai.embedding.maxInputTokens,
    // >! Optional cross-region pin (Requirement 10.1). Read defensively: this settings
    // >! field may be absent until the settings module adds it, and an empty/unset value
    // >! cleanly falls back to the Lambda's deployment region (identical to prior behavior).
    region: ai.embedding.region ?? ''
  });

  // S3 Vectors is the sole backend (spec 0-0-6, Requirement 7); the factory needs only
  // the embedding dimensions and the vector bucket/index location.
  const vectorStore = createVectorStore({
    dimensions: ai.embedding.dimensions,
    s3Vectors: ai.s3Vectors
  });

  const semantic = new SemanticRetrieval({
    embeddingProvider,
    vectorStore,
    buildResults,
    topK: ai.topK,
    // >! TEMPORARY DIAGNOSTIC (spec 0-0-6-fix-documentation-index-ai-assist): lets
    // >! SemanticRetrieval.retrieve() emit INFO-level trace lines for this investigation.
    logger: DebugAndLog
  });

  const assist = new AssistProvider({
    model: ai.assist.model,
    maxCandidates: ai.assist.maxCandidates
  });

  const semanticAssisted = new SemanticAssistedRetrieval({
    semantic,
    assist,
    candidateMultiplier: ai.candidateMultiplier,
    maxCandidates: ai.assist.maxCandidates,
    topK: ai.topK,
    storeType: VECTOR_STORE_LABEL,
    logger: DebugAndLog
  });

  docAiComponents = { embeddingProvider, vectorStore, semantic, assist, semanticAssisted };
  return docAiComponents;
}

/**
 * Search documentation with cache-data pass-through caching
 *
 * Searches across all configured GitHub users/orgs repositories,
 * filtering by atlantis_repository-type custom property.
 * Returns search results with title, excerpt, file path, GitHub URL, and result type.
 *
 * @param {Object} options - Search options
 * @param {string} options.query - Search query (keywords, required)
 * @param {string} [options.type] - Filter by type (documentation, template-pattern, code-example)
 * @param {string} [options.subType] - Filter by subType (guide, tutorial, reference, troubleshooting, function, resource)
 * @param {number} [options.limit=10] - Maximum results to return
 * @param {Array<string>} [options.ghusers] - Filter to specific GitHub users/orgs (optional, validated against
 *   settings). Also narrows RETURNED results to sections whose `owner` is in this set (design 7.2) — not just
 *   which orgs are crawled.
 * @param {string} [options.repository] - Filter to a specific repository name (optional).
 * @param {string} [options.repositoryType] - Filter to a specific repository type (optional, enum over
 *   `settings.github.validRepositoryTypes`).
 * @param {string} [options.namespace] - Filter to a specific namespace (optional).
 * @param {Object} [options.authInfo] - Optional resolved auth context ({ tier, isAuthenticated, ... }).
 *   Threaded from the controller; the caller tier gates retrieval-strategy selection (task 8.4).
 *   When the AI feature is disabled or the tier is below the configured minimum, the keyword
 *   path is used and behaves byte-for-byte as before. Only the tier is used/logged; never PII.
 * @returns {Promise<Object>} { results: Array, totalResults: number, query: string, suggestions: Array, availableFilters: Object|undefined, indexedRepositories: Object|undefined, errors: Array, partialData: boolean }
 *
 * `availableFilters` is additive and optional: when the matched results carry
 * `type`/`subType`/`repository` values it lists each distinct value with its count (e.g.
 * `{ type: [{ value: 'documentation', count: 22 }], subType: [ ... ], repository: [ ... ] }`)
 * so a follow-up query can be narrowed; it is absent when there is nothing to report. The
 * `repository` facet is computed over the matched set only and is distinct from the
 * index-wide corpus manifest. When `totalResults` is large, `suggestions` also gains a
 * "narrow by type/subType" hint.
 *
 * `indexedRepositories` (spec 0-0-7, Requirement 8) is present on every call, including
 * zero-result ones, UNLESS the corpus manifest cannot be derived at all (`source ===
 * 'unavailable'`) or even its leanest `count` tier would push the total response over the
 * size threshold — in either case the field is omitted entirely rather than emitted empty.
 * Shaped `{ tier: 'full'|'compact'|'count', repositories: Array<Object> }` for the `full`/
 * `compact` tiers (richer-to-leaner: `full` carries name/owner/repositoryType/namespace/
 * sections/ref; `compact` carries name/repositoryType only), or `{ tier: 'count',
 * repositoryCount: number, omitted: true }` for the `count` tier. It lists every indexed
 * repository regardless of what the query matched and is distinct from `availableFilters`;
 * it never causes `results`/`totalResults` to be truncated.
 *
 * Each result object includes:
 * - title: string - Result title
 * - excerpt: string - Brief excerpt (max 200 chars)
 * - filePath: string - File path in repository or S3
 * - githubUrl: string - GitHub URL to full document (if available)
 * - type: string - Result type (documentation, template-pattern, code-example)
 * - subType: string - Result subtype (guide, tutorial, reference, troubleshooting, function, resource)
 * - relevanceScore: number - Relevance ranking score
 * - repository: string - Repository name (if from GitHub)
 * - repositoryType: string - Repository type (documentation, app-starter, templates, package, mcp)
 * - namespace: string - S3 namespace (if from S3)
 * - codeExamples: Array - Code snippets with context (if type is code-example)
 * - context: Object - Additional context (line numbers, function name, template section, etc.)
 *
 * @example
 * // Search all documentation
 * const result = await Documentation.search({ query: 'cache-data' });
 *
 * @example
 * // Search for specific type
 * const result = await Documentation.search({
 *   query: 'Lambda function',
 *   type: 'code-example'
 * });
 *
 * @example
 * // Search with subtype filter
 * const result = await Documentation.search({
 *   query: 'getting started',
 *   type: 'documentation',
 *   subType: 'tutorial'
 * });
 *
 * @example
 * // Search specific GitHub users/orgs
 * const result = await Documentation.search({
 *   query: 'CloudFormation',
 *   ghusers: ['63klabs']
 * });
 */
async function search(options = {}) {
  const { query, type, subType, limit = 10, ghusers, repository, repositoryType, namespace, authInfo } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query is required and must be a non-empty string');
  }

  // >! Resolve the AI feature config and the caller tier used to gate/select the retrieval
  // >! strategy (task 8.4). Log the tier only for observability; never log the auth
  // >! identity/PII.
  const ai = Config.settings().documentation.ai;
  const tier = authInfo?.tier || 'public';
  DebugAndLog.debug('Documentation.search invoked', { tier, docAiEnabled: ai.enabled === true });

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('documentation-index', 'doc-index');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for doc-index/search');
  }

  // >! Determine which GitHub users/orgs to search (filtered or all)
  let usersOrgsToSearch = ghusers;
  if (!usersOrgsToSearch || usersOrgsToSearch.length === 0) {
    usersOrgsToSearch = Config.settings().github.userOrgs;
  } else {
    // >! Validate that requested users/orgs are in configured users/orgs
    const validUsersOrgs = Config.settings().github.userOrgs;
    usersOrgsToSearch = usersOrgsToSearch.filter(u => validUsersOrgs.includes(u));
    if (usersOrgsToSearch.length === 0) {
      throw new Error('No valid GitHub users/orgs specified');
    }
  }

  // >! Set host to array of users/orgs (used in cache key)
  conn.host = usersOrgsToSearch;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = {
    query: query.trim(),
    type,
    subType,
    limit,
    // >! Cache-key discriminator: keyword vs semantic/semantic-assisted results (and the
    // >! per-tier gating outcome) must not collide in the shared documentation-index cache.
    // >! Disabled uses a fixed 'keyword' token; enabled varies by mode|tier so a
    // >! paid/private semantic hit is never served to a below-tier (keyword) caller and
    // >! vice versa. The former store segment is gone because S3 Vectors is the only
    // >! backend (spec 0-0-6, Requirement 7); stale keyed entries expire on the normal
    // >! TTL. Discriminator only; caching/TTLs are otherwise unchanged.
    docAiMode: (ai.enabled === true) ? `${ai.retrievalMode}|${tier}` : 'keyword',
    // >! Cache-key filters (task 12.2, R5.4/R13.4): `repository`/`repositoryType`/`namespace`
    // >! are included as-is (plain strings or undefined, same treatment as `type`/`subType`)
    // >! so a result set computed under one filter combination is never served for another.
    repository,
    repositoryType,
    namespace
  };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, _opts) => {
    DebugAndLog.debug('Searching documentation (cache miss)', {
      query: connection.parameters.query,
      type: connection.parameters.type,
      subType: connection.parameters.subType,
      limit: connection.parameters.limit,
      usersOrgs: connection.host
    });

    // >! Keyword search fn: wraps the existing DynamoDB keyword query and returns its
    // >! { results, totalResults, query, suggestions } shape UNCHANGED. This is both the
    // >! disabled-path search and the tier/error fallback for the semantic path, so keyword
    // >! behavior stays byte-for-byte the current search.
    // >!
    // >! `repository`/`repositoryType`/`namespace` are now also carried on
    // >! `connection.parameters` (task 12.2) and read from there below, consistent with
    // >! `type`/`subType`. `ghusers`' cache-key contribution is `conn.host` (see below), not
    // >! `connection.parameters`, so it is still read from the outer `search()` closure.
    // >!
    // >! Cache-key completeness (task 12.2, R5.4/R13.4): `conn.host = usersOrgsToSearch`
    // >! (set above) already varies the cache key by the resolved org list, because
    // >! `CacheableDataAccess.getData()` hashes `{ data, connection, cachePolicy }` as a
    // >! whole (`Cache.generateIdHash`, `dao-cache.js`) — i.e. the ENTIRE `connection`
    // >! object, not just `connection.parameters`. A caller-supplied `ghusers` is validated
    // >! and intersected against `settings.github.userOrgs` before being assigned to
    // >! `conn.host`, so two different `ghusers` inputs that resolve to the same org set
    // >! hash identically (correct: they would also return identical results), and two
    // >! inputs that resolve to different org sets hash differently (correct: the `owner`
    // >! push-down filter below would narrow results differently). No additional
    // >! `ghusers`/`owner` entry is needed on `conn.parameters` for this reason.
    // >!
    // >! `ownerFilter` is the CALLER-SUPPLIED `ghusers` only — never the resolved
    // >! `usersOrgsToSearch` default (which is every configured org when `ghusers` is
    // >! omitted). Filtering results by the default list would narrow every unfiltered
    // >! search to callers whose `owner` metadata happens to match a configured org string,
    // >! which is a behavior change this task must not make (R5.6/R13.3 membership
    // >! preservation when no new filter is supplied).
    const ownerFilter = (Array.isArray(ghusers) && ghusers.length > 0) ? usersOrgsToSearch : undefined;

    const keywordSearchFn = async () => {
      const keywordResult = await Models.DocIndex.queryIndex({
        query: connection.parameters.query,
        type: connection.parameters.type,
        subType: connection.parameters.subType,
        repository: connection.parameters.repository,
        repositoryType: connection.parameters.repositoryType,
        namespace: connection.parameters.namespace,
        ghusers: ownerFilter,
        limit: connection.parameters.limit
      });
      return {
        results: keywordResult.results || [],
        totalResults: keywordResult.totalResults || 0,
        query: connection.parameters.query,
        suggestions: keywordResult.suggestions || []
      };
    };

    let searchResult;
    if (ai.enabled !== true) {
      // >! Disabled: keyword-only, byte-for-byte current behavior. The layer is never
      // >! loaded and no Bedrock/vector clients are constructed on this path.
      searchResult = await keywordSearchFn();
    } else {
      // >! Enabled: build the keyword strategy (cheap, no AWS clients) and reuse the
      // >! memoized semantic/assisted components, then let selectStrategy gate on the caller
      // >! tier + retrieval mode. Any semantic-path error transparently falls back to keyword.
      const { KeywordRetrieval, selectStrategy } = loadLayerModule('retrieval-strategy');
      const keyword = new KeywordRetrieval({ keywordSearchFn });
      const { semantic, semanticAssisted } = getDocAiComponents(ai);

      // >! Active index version is required by the semantic path; resolved per cache-miss.
      const version = await Models.DocIndex.getActiveVersion(Config.settings().docIndexTable);

      // >! TEMPORARY DIAGNOSTIC (remove after root-causing the silent keyword fallback):
      // >! logs the exact runtime inputs selectStrategy() uses to decide wantsSemantic,
      // >! since every downstream log line (selectStrategy/strategies) has come back empty
      // >! despite settings/tier/layer content all checking out via static inspection.
      DebugAndLog.info('DIAG: pre-selectStrategy snapshot', {
        enabled: ai.enabled,
        enabledType: typeof ai.enabled,
        retrievalMode: ai.retrievalMode,
        minTier: ai.minTier,
        callerTier: authInfo?.tier,
        version,
        hasSemantic: Boolean(semantic),
        semanticHasRetrieve: typeof semantic?.retrieve === 'function',
        hasSemanticAssisted: Boolean(semanticAssisted),
        semanticAssistedHasRetrieve: typeof semanticAssisted?.retrieve === 'function'
      });

      const strategy = selectStrategy({
        config: ai,
        tier: authInfo?.tier,
        strategies: { keyword, semantic, semanticAssisted },
        logger: DebugAndLog
      });

      searchResult = await strategy.retrieve({
        query: connection.parameters.query,
        type: connection.parameters.type,
        // >! spec 0-0-7-tool-discovery-enhancement, task 19.1 (Requirement 10.2): thread
        // >! the repository/repositoryType/namespace filters through to the semantic path
        // >! the same way they are already threaded to the keyword path above, so filter
        // >! behavior does not depend on which retrieval strategy was selected.
        repository: connection.parameters.repository,
        repositoryType: connection.parameters.repositoryType,
        namespace: connection.parameters.namespace,
        ghusers,
        topK: (limit || ai.topK),
        authInfo,
        version
      });
    }

    // >! Return search results with metadata. The shape is identical across the keyword and
    // >! semantic paths so the tool's response contract is unchanged either way.
    const results = searchResult.results || [];
    const totalResults = searchResult.totalResults || 0;
    const returnObject = {
      results,
      totalResults,
      query: connection.parameters.query,
      // >! Existing suggestions are preserved in order; a "narrow by type/subType" hint is
      // >! appended only when the matched set is large (R8.4).
      suggestions: withNarrowSuggestion(searchResult.suggestions || [], totalResults),
      // >! Additive, optional facet block (R8.1/R8.5): distinct type/subType values with
      // >! counts over the matched set, so an agent can see what it can narrow to. Left
      // >! `undefined` (and therefore absent from the serialized response) when there is
      // >! nothing to report, keeping the envelope unchanged for existing clients.
      availableFilters: buildAvailableFilters(results),
      // No errors surfaced by the retrieval path, but we include the field for consistency
      errors: undefined,
      partialData: false
    };

    // >! Wrap the result in a response format suitable for CacheableDataAccess
    return ApiRequest.success({body: returnObject});
  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  // >! Shallow-copy defensively: `getBody()` may return a reference into cache-data's
  // >! internal cached state (shared across calls that hit the same cache entry), and the
  // >! corpus manifest below is attached PER CALL (R8.1) rather than cached alongside the
  // >! query result (R8.5 — it has its own independent, version-keyed cache). Mutating the
  // >! cached object directly would leak one call's manifest attachment into another.
  const body = { ...cacheObj.getBody(true) };

  // >! Corpus manifest (Requirement 8.1, 8.2): assembled OUTSIDE the query cache (above),
  // >! on every call including cache hits, because the manifest is cached independently of
  // >! any individual query (R8.5) — once per index version via `models/corpus.js`'s own
  // >! version-keyed cache, not once per `search_documentation` cache entry. This also keeps
  // >! `results`/`totalResults`/etc. (already finalized in `body`) completely untouched by
  // >! the manifest assembly below (R8.9).
  const manifest = await Models.Corpus.getCorpusManifest(Config.settings().docIndexTable);

  let manifestTier = null;
  const manifestSource = manifest.source;

  if (manifest.source !== Models.Corpus.MANIFEST_SOURCE.UNAVAILABLE && Array.isArray(manifest.repositories)) {
    // >! Measure against the REST of the response (everything already in `body`) so the
    // >! degradation ladder reacts to the response's actual total size, never to the
    // >! manifest in isolation (design 9.4 step 3; R8.9).
    const restOfResponseJson = JSON.stringify(body);
    const selection = assembleIndexedRepositories(manifest.repositories, restOfResponseJson);

    if (selection) {
      body.indexedRepositories = selection.block;
      manifestTier = selection.tier;
    }
    // >! selection === null: even the `count` tier would push the total response over the
    // >! hard cap (R8.8) — omit `indexedRepositories` entirely rather than violate the cap.
    // >! `manifestTier` stays `null` for the log line in that case.
  }

  // >! Discovery observability (Requirement 12.1, 12.4, 12.5): emitted on EVERY call,
  // >! cache hit or miss, so the zero-result signal/metric baseline (R12.6) reflects actual
  // >! caller-observed outcomes rather than only cache misses.
  logDiscoverySearch({
    tokenCount: countQueryTokens(conn.parameters.query),
    filtersApplied: filtersAppliedFrom({ type, subType, ghusers, repository, repositoryType, namespace }),
    resultCount: body?.totalResults ?? (body?.results ? body.results.length : 0),
    strategy: strategyLabelFor(ai, tier),
    emptyResult: (body?.totalResults ?? 0) === 0,
    manifestTier,
    manifestSource
  });

  return body;
}

/**
 * Build the ordered list of candidate document hashes to try for a `get_document` request.
 *
 * Resolution is a short, deterministic sequence rather than a single lookup because a
 * caller-supplied key can arrive in more than one form:
 *
 * 1. `metadataDocumentHash` — the `documentHash` pointer read from the section's metadata
 *    item. This is the authoritative answer whenever the section was indexed after spec
 *    0-0-6 task 1.6.
 * 2. `hashContentPath(stripSlug(filePath))` — the strip-slug fallback. A section contentPath
 *    is `{org}/{repo}/{filePath}/{slug}`, so removing the trailing heading slug reproduces
 *    the document path the indexer hashed. Covers sections indexed before `documentHash`
 *    was written, and sections whose metadata item has expired.
 * 3. `sectionHash` — the supplied `hash` (or `hashContentPath(filePath)`) used as-is, which
 *    resolves the case where the caller already handed us a document-level key rather than
 *    a section-level one.
 *
 * Duplicates and empty values are removed, so a request usually costs one document read and
 * at most three.
 *
 * @param {?string} metadataDocumentHash - `documentHash` from the section metadata item, if any.
 * @param {?string} filePath - Caller-supplied contentPath, if any.
 * @param {string} sectionHash - The resolved section hash (supplied or derived).
 * @returns {Array<string>} Candidate document hashes, in the order they should be tried.
 * @example
 * buildDocumentHashCandidates(null, '63klabs/cache-data/README.md/install', 'aabbccddeeff0011');
 * // [hashContentPath('63klabs/cache-data/README.md'), 'aabbccddeeff0011']
 */
function buildDocumentHashCandidates(metadataDocumentHash, filePath, sectionHash) {
  const candidates = [metadataDocumentHash];

  if (typeof filePath === 'string' && filePath.length > 0) {
    const documentPath = stripSlug(filePath);
    if (documentPath) {
      candidates.push(hashContentPath(documentPath));
    }
  }

  candidates.push(sectionHash);

  return [...new Set(candidates.filter((candidate) => typeof candidate === 'string' && candidate.length > 0))];
}

/**
 * Retrieve the full stored source file for a search result (the `get_document` tool).
 *
 * Storage-only retrieval (Requirement 6.5): every read is against the DynamoDB documentation
 * index and the server NEVER fetches from GitHub. The MCP server serves many clients, so
 * concentrating GitHub traffic on it would exhaust a shared rate limit; on a storage miss the
 * client is handed the file-level GitHub URL and performs the fetch itself.
 *
 * Because it touches neither Bedrock nor the vector store, this works identically regardless
 * of `EnableDocAi` or the active `DocAiRetrievalMode`, at the same access level as keyword
 * `search_documentation` (Requirement 6.6).
 *
 * Resolution (Requirement 6.4): the active index version is resolved server-side (the caller
 * never supplies one), the section hash comes from `hash` or from hashing `filePath`, that
 * section's metadata yields the `documentHash`/`githubUrl` pointers, and the version-less
 * `document:{fileHash}` item is then read. See {@link buildDocumentHashCandidates} for the
 * fallbacks used when the section metadata is unavailable.
 *
 * Wrapped in `CacheableDataAccess` via the `document`/`doc-data` connection so a hot document
 * is served from cache. A storage miss is signalled by a thrown error rather than a returned
 * value specifically so the miss is NOT cached — the next indexer build may well store the
 * document, and a cached miss would outlive the gap.
 *
 * @param {Object} options - Lookup options.
 * @param {string} [options.filePath] - Section contentPath from a search result
 *   (`{org}/{repo}/{filePath}/{slug}`). Either this or `hash` is required.
 * @param {string} [options.hash] - Section content hash (16 hex characters). Either this or
 *   `filePath` is required.
 * @param {Object} [options.authInfo] - Resolved auth context. Accepted for interface
 *   symmetry with {@link search} and for logging the caller tier only; `get_document` applies
 *   no additional tier gating (Requirement 6.6) and the tier is deliberately NOT part of the
 *   cache key, since the returned document is identical for every caller.
 * @returns {Promise<{filePath: string, githubUrl: (string|null), repository: (string|null), repositoryType: (string|null), namespace: (string|null), content: string}>}
 *   The stored source file and its file-level metadata.
 * @throws {Error} When neither `filePath` nor `hash` is supplied (`code` is unset — invalid input).
 * @throws {Error} When the document is not in storage. The error carries
 *   `code = 'DOCUMENT_NOT_FOUND'` plus `filePath`, `hash`, and `githubUrl` (the derived
 *   file-level URL, or `null` when it could not be derived) so the caller can return a
 *   JSON-RPC error that lets the client fetch the file directly (Requirements 6.8, 6.9).
 * @example
 * // Retrieve by the filePath returned on a search result
 * const doc = await Documentation.getDocument({
 *   filePath: '63klabs/cache-data/README.md/installation'
 * });
 * console.log(doc.content);   // raw source file
 * console.log(doc.githubUrl); // file-level GitHub URL
 *
 * @example
 * // Retrieve by section hash, handling a storage miss
 * try {
 *   const doc = await Documentation.getDocument({ hash: 'ea6f1a2b3c4d5e6f' });
 * } catch (error) {
 *   if (error.code === 'DOCUMENT_NOT_FOUND') {
 *     // Fetch error.githubUrl client-side; the server never fetches from GitHub
 *   }
 * }
 */
async function getDocument(options = {}) {
  const { filePath, hash, authInfo } = options;

  const hasFilePath = typeof filePath === 'string' && filePath.trim().length > 0;
  const hasHash = typeof hash === 'string' && hash.trim().length > 0;

  if (!hasFilePath && !hasHash) {
    throw new Error('getDocument requires either filePath or hash');
  }

  // >! Tier is logged for observability only; get_document applies no tier gating and the
  // >! tier is not part of the cache key. Never log the auth identity/PII.
  DebugAndLog.debug('Documentation.getDocument invoked', { tier: authInfo?.tier || 'public' });

  const { conn, cacheProfile } = Config.getConnCacheProfile('document', 'doc-data');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for document/doc-data');
  }

  // >! Cache key inputs. `filePath` and `hash` are opaque lookup keys — hashed and used as
  // >! DynamoDB key components only, never as a file-system path or shell argument.
  conn.parameters = {
    filePath: hasFilePath ? filePath.trim() : undefined,
    hash: hasHash ? hash.trim() : undefined
  };

  const fetchFunction = async (connection, _opts) => {
    const requestedFilePath = connection.parameters.filePath || null;
    const requestedHash = connection.parameters.hash || null;
    const tableName = Config.settings().docIndexTable;

    DebugAndLog.debug('Resolving document (cache miss)', {
      filePath: requestedFilePath,
      hash: requestedHash
    });

    // >! Active version is resolved server-side; the caller never supplies one (R2.4/R6).
    const version = await Models.DocIndex.getActiveVersion(tableName);

    // >! Section hash: the supplied hash wins, otherwise derive it from the contentPath the
    // >! same way the indexer did.
    const sectionHash = requestedHash || hashContentPath(requestedFilePath);

    // >! Section metadata supplies the documentHash pointer and the file-level GitHub URL.
    // >! Absent metadata (no active version, expired/superseded item) is not fatal — the
    // >! candidate fallbacks below can still resolve the document.
    const metadata = version
      ? await Models.DocIndex.getSectionMetadata(tableName, version, sectionHash)
      : null;

    const candidates = buildDocumentHashCandidates(
      metadata ? metadata.documentHash : null,
      requestedFilePath,
      sectionHash
    );

    let document = null;
    for (const candidate of candidates) {
      document = await Models.DocIndex.getDocumentByFileHash(tableName, candidate);
      if (document) {
        break;
      }
    }

    const metadataGithubUrl = metadata ? metadata.githubUrl : null;

    if (!document) {
      // >! Storage miss. Throw (rather than returning a value) so CacheableDataAccess does
      // >! NOT cache the miss: the next indexer build may store this document. The GitHub URL
      // >! rides along so the caller can hand it to the client, which fetches directly —
      // >! the server itself never fetches from GitHub (R6.8/R6.9).
      const error = new Error(
        `Document not found in storage: ${requestedFilePath || requestedHash}`
      );
      error.code = 'DOCUMENT_NOT_FOUND';
      error.filePath = requestedFilePath;
      error.hash = requestedHash;
      error.githubUrl = metadataGithubUrl;
      throw error;
    }

    return ApiRequest.success({
      body: {
        // >! Prefer the stored documentPath: it is the file the content actually came from,
        // >! whereas the caller's filePath may still carry a section slug.
        filePath: document.documentPath || requestedFilePath || '',
        // >! Section metadata and the document item store the same file-level URL; either is
        // >! acceptable, so take whichever is populated (R6.9).
        githubUrl: metadataGithubUrl || document.githubUrl || null,
        repository: document.repository || null,
        repositoryType: document.repositoryType || null,
        namespace: document.namespace || null,
        content: document.content || ''
      }
    });
  };

  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}
  );

  return cacheObj.getBody(true);
}

/**
 * Test harness for resetting module-scoped state in tests.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
  /**
   * Reset the memoized doc-ai components so the next AI-enabled request rebuilds them.
   * Lets a test exercise multiple configurations in one file without warm-container
   * memoization leaking across cases. WARNING: For testing only; never use in production.
   *
   * @private
   * @returns {void}
   */
  static resetDocAiComponents() {
    docAiComponents = null;
  }
}

module.exports = {
  search,
  getDocument,
  // >! Discovery observability (spec 0-0-7, task 4.1, Requirement 12.1). `logManifestDegraded`
  // >! is exported so the corpus-manifest degradation ladder (task 13.1) can call it directly
  // >! once it exists; the `discovery_search`/`discovery_tool_call` emitters are internal
  // >! (exercised via DebugAndLog log-line assertions, matching the existing DOC_AI_USAGE
  // >! test convention) and are not part of the service's public surface.
  logManifestDegraded,
  TestHarness
};
