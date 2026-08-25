'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { Config } = require('../config');

/**
 * Maximum keys per DynamoDB BatchGetItem request.
 * @type {number}
 */
const BATCH_GET_LIMIT = 100;

/**
 * Maximum number of attempts (initial + retries) per batch chunk when DynamoDB returns
 * `UnprocessedKeys`. Bounds the retry loop so a pathological response cannot loop forever.
 * @type {number}
 */
const MAX_BATCH_GET_ATTEMPTS = 3;

/**
 * Base delay in milliseconds for exponential backoff between `UnprocessedKeys` retries.
 * @type {number}
 */
const BATCH_GET_BASE_BACKOFF_MS = 50;

/**
 * DynamoDB partition-key prefix for a content metadata/body item.
 * @type {string}
 */
const CONTENT_PK_PREFIX = 'content:';

/**
 * DynamoDB partition-key prefix for a per-file document body item. The key is deliberately
 * version-less (spec 0-0-6, Requirement 2.1) so a document can be read without the caller
 * supplying an index version.
 * @type {string}
 */
const DOCUMENT_PK_PREFIX = 'document:';

/**
 * DynamoDB sort key for a per-file document body item.
 * @type {string}
 */
const DOCUMENT_SK = 'content';

/**
 * Relevance points added to a keyword-mode candidate whose `title` or `excerpt` contains
 * the caller's full query phrase.
 *
 * Exact-phrase matching depends on the query, so it can only be evaluated at query time.
 * This value matches the weight the indexer previously declared (and never used) as
 * `SCORE_WEIGHTS.exactPhrase`, which was removed as dead code (R9.3).
 *
 * @type {number}
 */
const EXACT_PHRASE_BOOST = 20;

/**
 * Documentation Index DAO
 *
 * Queries the persistent DynamoDB-backed documentation index built by the
 * Indexer Lambda. Replaces the previous in-memory index building approach.
 *
 * DynamoDB key patterns:
 * - Version pointer: pk=`version:pointer`, sk=`active`
 * - Main index: pk=`mainindex:{version}`, sk=`entries`
 * - Content metadata: pk=`content:{hash}`, sk=`v:{version}:metadata`
 * - Document body: pk=`document:{fileHash}`, sk=`content` (version-less, one per source file)
 * - Search keywords: pk=`search:{keyword}`, sk=`v:{version}:{hash}`
 */

/**
 * Lazily initialized DynamoDB Document Client.
 * @type {DynamoDBDocumentClient|null}
 */
let docClient = null;

/**
 * Get or create the DynamoDB Document Client singleton.
 *
 * @returns {DynamoDBDocumentClient}
 */
function getDocClient() {
	if (!docClient) {
		const client = new DynamoDBClient({});
		docClient = DynamoDBDocumentClient.from(client, {
			marshallOptions: { removeUndefinedValues: true }
		});
	}
	return docClient;
}

/**
 * Override the DynamoDB Document Client (for testing).
 *
 * @param {DynamoDBDocumentClient|null} client - Client instance or null to reset
 */
function setDocClient(client) {
	docClient = client;
}

/**
 * Common stop words filtered from search queries.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
	'the', 'and', 'for', 'with', 'from', 'this', 'that',
	'are', 'was', 'were', 'been', 'have', 'has', 'had'
]);

/**
 * Read the active version from the DynamoDB version pointer.
 *
 * @param {string} tableName - DynamoDB table name
 * @returns {Promise<string|null>} Active version identifier or null if none exists
 * @example
 * const version = await getActiveVersion('my-doc-index-table');
 * // version = '20250715T060000' or null
 */
async function getActiveVersion(tableName) {
	const client = getDocClient();

	try {
		const result = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: 'version:pointer', sk: 'active' }
		}));

		if (result.Item && result.Item.version) {
			return result.Item.version;
		}

		return null;
	} catch (error) {
		DebugAndLog.error(`Failed to read version pointer: ${error.message}`, error.stack);
		return null;
	}
}

/**
 * Read the main index entries for a specific version.
 * Supports chunked main index: reads the manifest at sk=`entries`
 * to get the chunk count, then fetches each chunk at sk=`entries:{i}`.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @returns {Promise<Array<Object>>} Array of index entries or empty array
 * @example
 * const entries = await getMainIndex('my-doc-index-table', '20250715T060000');
 */
async function getMainIndex(tableName, version) {
	const client = getDocClient();

	try {
		// Read manifest item
		const manifestResult = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: `mainindex:${version}`, sk: 'entries' }
		}));

		if (!manifestResult.Item) {
			return [];
		}

		const manifest = manifestResult.Item;

		// Legacy format: entries stored directly on the manifest item
		if (Array.isArray(manifest.entries)) {
			return manifest.entries;
		}

		// Chunked format: fetch each chunk
		const totalChunks = manifest.totalChunks || 0;
		if (totalChunks === 0) {
			return [];
		}

		const allEntries = [];
		for (let i = 0; i < totalChunks; i++) {
			const chunkResult = await client.send(new GetCommand({
				TableName: tableName,
				Key: { pk: `mainindex:${version}`, sk: `entries:${i}` }
			}));

			if (chunkResult.Item && Array.isArray(chunkResult.Item.entries)) {
				allEntries.push(...chunkResult.Item.entries);
			}
		}

		return allEntries;
	} catch (error) {
		DebugAndLog.error(`Failed to read main index for version ${version}: ${error.message}`, error.stack);
		return [];
	}
}

/**
 * Extract keywords from a query string.
 *
 * Lowercases, splits on whitespace, filters stop words and short tokens,
 * and deduplicates.
 *
 * @param {string} query - Raw search query
 * @returns {Array<string>} Deduplicated keyword array
 */
function extractQueryKeywords(query) {
	if (!query || typeof query !== 'string') {
		return [];
	}

	const words = query
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(w => w.length > 2 && !STOP_WORDS.has(w));

	return [...new Set(words)];
}

/**
 * Apply `type`/`subType` filter push-down to a ranked set of search-index candidates.
 *
 * Uses the `type`/`subType` attributes carried on `search:{keyword}` entries to discard
 * candidates that cannot satisfy the requested filter, so the metadata `BatchGetItem`
 * reads fewer items (R8.2).
 *
 * A candidate is discarded ONLY when its indexed value is known (non-null) and differs
 * from the requested value. Candidates indexed before `type`/`subType` were written to
 * search entries carry `null` and are always retained, leaving the authoritative
 * post-fetch metadata filter to decide — so the returned membership is identical to the
 * post-fetch-only behavior (R8.5).
 *
 * @param {Array<{hash: string, totalScore: number, type: (string|null), subType: (string|null)}>} candidates
 *   Ranked candidates from the search-keyword aggregation.
 * @param {string} [type] - Requested `type` filter, or falsy for no filter.
 * @param {string} [subType] - Requested `subType` filter, or falsy for no filter.
 * @returns {Array<Object>} The retained candidates, in their original ranked order. The
 *   input array is returned unchanged when no filter is requested.
 * @example
 * const kept = applyIndexedFilterPushDown(
 *   [{ hash: 'a', type: 'documentation' }, { hash: 'b', type: 'code-example' }, { hash: 'c', type: null }],
 *   'documentation'
 * );
 * // kept = [{ hash: 'a', ... }, { hash: 'c', ... }]  ('c' is unknown, so it survives to the post-fetch filter)
 */
function applyIndexedFilterPushDown(candidates, type, subType) {
	if (!type && !subType) {
		return candidates;
	}

	return candidates.filter((entry) => {
		if (type && entry.type !== null && entry.type !== undefined && entry.type !== type) {
			return false;
		}
		if (subType && entry.subType !== null && entry.subType !== undefined && entry.subType !== subType) {
			return false;
		}
		return true;
	});
}

/**
 * Normalize text for exact-phrase comparison.
 *
 * Applies the SAME transformation {@link extractQueryKeywords} applies to the query
 * (lowercase, non-alphanumeric/non-hyphen characters replaced with a space) and then
 * collapses runs of whitespace, so a query phrase and a candidate's title/excerpt are
 * compared on equal footing regardless of punctuation or spacing differences.
 *
 * @param {string} text - Raw text to normalize
 * @returns {string} Normalized text, or an empty string for non-string/empty input
 * @example
 * normalizeForPhraseMatch('Cache-Data:  Installation Guide!');
 * // 'cache-data installation guide'
 */
function normalizeForPhraseMatch(text) {
	if (!text || typeof text !== 'string') {
		return '';
	}

	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Apply the query-time exact-phrase relevance boost to keyword-mode candidates (R9.1, R9.2).
 *
 * Runs over the already-enriched top candidates, so it adds no additional DynamoDB reads.
 * A candidate receives {@link EXACT_PHRASE_BOOST} when its `title` or `excerpt` contains the
 * normalized full query phrase (case- and punctuation-insensitive via
 * {@link normalizeForPhraseMatch}).
 *
 * The boost mutates each candidate's `relevanceScore` in place and NEVER adds or removes
 * candidates, so it changes only ordering, never membership (R9.4). Callers must re-sort by
 * `relevanceScore` descending afterwards.
 *
 * @param {Array<{title: (string|undefined), excerpt: (string|undefined), relevanceScore: number}>} candidates
 *   Enriched candidates to score, mutated in place.
 * @param {string} query - The caller's raw query string.
 * @returns {Array<Object>} The same `candidates` array, for convenient chaining.
 * @example
 * const scored = applyExactPhraseBoost(
 *   [{ title: 'Cache-Data Installation', excerpt: '', relevanceScore: 10 }],
 *   'cache-data installation'
 * );
 * // scored[0].relevanceScore === 30
 */
function applyExactPhraseBoost(candidates, query) {
	const phrase = normalizeForPhraseMatch(query);

	// >! An empty/punctuation-only query normalizes away; boosting on '' would match
	// >! every candidate, so skip the pass entirely.
	if (phrase === '') {
		return candidates;
	}

	for (const candidate of candidates) {
		const title = normalizeForPhraseMatch(candidate.title);
		const excerpt = normalizeForPhraseMatch(candidate.excerpt);

		if (title.includes(phrase) || excerpt.includes(phrase)) {
			candidate.relevanceScore += EXACT_PHRASE_BOOST;
		}
	}

	return candidates;
}

/**
 * Query the DynamoDB documentation index.
 *
 * Searches keyword entries, aggregates relevance scores per content hash,
 * fetches content metadata for top results, and returns formatted results
 * sorted by relevance descending.
 *
 * @param {Object} options - Query options
 * @param {string} options.query - Search query (keywords)
 * @param {string} [options.type] - Filter by type (documentation, template-pattern, code-example)
 * @param {string} [options.subType] - Filter by subType
 * @param {number} [options.limit=10] - Maximum results
 * @returns {Promise<Object>} Search results with relevance ranking
 * @example
 * const result = await queryIndex({
 *   query: 'cache-data installation',
 *   type: 'documentation',
 *   limit: 5
 * });
 */
async function queryIndex(options = {}) {
	const { query, type, subType, limit = 10 } = options;
	const settings = Config.settings();
	const tableName = settings.docIndexTable;

	// >! Handle empty query
	if (!query || query.trim() === '') {
		return {
			results: [],
			totalResults: 0,
			query: query || '',
			suggestions: ['Please provide a search query']
		};
	}

	// >! Get active version
	const version = await getActiveVersion(tableName);

	if (!version) {
		return {
			results: [],
			totalResults: 0,
			query,
			suggestions: ['No active documentation index found. Please verify the indexer has run.']
		};
	}

	// >! Extract keywords from query
	const keywords = extractQueryKeywords(query);

	if (keywords.length === 0) {
		return {
			results: [],
			totalResults: 0,
			query,
			suggestions: ['Try using more specific keywords']
		};
	}

	const client = getDocClient();

	// >! For each keyword, query DynamoDB for search:{keyword} entries
	const scoresByHash = {};

	for (const keyword of keywords) {
		try {
			const result = await client.send(new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
				ExpressionAttributeValues: {
					':pk': `search:${keyword}`,
					':skPrefix': `v:${version}:`
				}
			}));

			if (result.Items) {
				for (const item of result.Items) {
					const hash = item.hash;
					if (!scoresByHash[hash]) {
						scoresByHash[hash] = {
							hash,
							totalScore: 0,
							typeWeight: item.typeWeight || 1.0,
							// >! `type`/`subType` on search entries were added by spec 0-0-6 task 1.6.
							// >! Entries written before that deploy have them absent; normalize to null
							// >! so the push-down below can tell "known value" from "unknown".
							type: (item.type === undefined || item.type === null) ? null : item.type,
							subType: (item.subType === undefined || item.subType === null) ? null : item.subType
						};
					} else {
						// >! A hash can appear under several keywords. Adopt the first known
						// >! type/subType so a legacy (null) entry does not mask a populated one.
						const known = scoresByHash[hash];
						if (known.type === null && item.type !== undefined && item.type !== null) {
							known.type = item.type;
						}
						if (known.subType === null && item.subType !== undefined && item.subType !== null) {
							known.subType = item.subType;
						}
					}
					scoresByHash[hash].totalScore += (item.relevanceScore || 0);
				}
			}
		} catch (error) {
			DebugAndLog.warn(`Failed to query keyword '${keyword}': ${error.message}`);
		}
	}

	// >! Convert to array and sort by relevance descending
	let ranked = Object.values(scoresByHash)
		.sort((a, b) => b.totalScore - a.totalScore);

	// >! Select the top slice BEFORE filtering, exactly as the pre-push-down code did, so the
	// >! candidate window (and therefore the returned membership) is unchanged (R8.5).
	const fetchLimit = Math.min(ranked.length, limit * 3);
	const topHashes = ranked.slice(0, fetchLimit);

	// >! Filter push-down (R8.2): drop candidates whose indexed type/subType already
	// >! contradicts the requested filter, so the metadata BatchGetItem reads fewer items.
	// >! Candidates with an unknown (null) type/subType are retained and settled by the
	// >! authoritative post-fetch filter below, keeping membership identical to the
	// >! post-fetch-only behavior for indexes written before task 1.6 (R8.5).
	const candidates = applyIndexedFilterPushDown(topHashes, type, subType);

	// >! Batched metadata read (BatchGetItem, chunked at 100) instead of one GetItem per
	// >! hash, so read cost/latency scale sub-linearly with result count (R1.1).
	const metadataByHash = await batchGetMetadata(tableName, version, candidates.map((entry) => entry.hash));

	// >! Walk the ranked slice (not the returned map) so the pre-fetch ordering survives:
	// >! BatchGetItem may return items in any order (R1.4). Hashes with no stored metadata
	// >! are simply skipped rather than failing the request (R1.5).
	const metadataResults = [];
	for (const entry of candidates) {
		const item = metadataByHash[entry.hash];
		if (item) {
			metadataResults.push({
				...item,
				relevanceScore: entry.totalScore
			});
		}
	}

	// >! Authoritative type/subType filter. Push-down above only removes candidates whose
	// >! indexed type/subType is KNOWN to mismatch; this pass settles candidates whose search
	// >! entries predate task 1.6 (type/subType absent), so membership is identical to the
	// >! original post-fetch-only filtering (R8.5).
	let filtered = metadataResults;
	if (type) {
		filtered = filtered.filter(item => item.type === type);
	}
	if (subType) {
		filtered = filtered.filter(item => item.subType === subType);
	}

	// >! Query-time exact-phrase boost (R9.1, R9.2). Runs over the already-fetched candidates
	// >! so it costs no additional reads, and only adjusts scores — membership is unchanged
	// >! (R9.4). This is the keyword path only; the semantic/assisted paths rank by cosine in
	// >! services/documentation.js buildResults() and are untouched (R9.5).
	applyExactPhraseBoost(filtered, query);

	// >! Sort by FINAL relevance descending — after filtering and after the phrase boost —
	// >! before slicing to limit (R9.4).
	filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);

	const totalResults = filtered.length;
	const results = filtered.slice(0, limit);

	// >! Generate suggestions if no results
	const suggestions = totalResults === 0
		? ['Try using fewer or more general keywords', 'Try filtering by type: documentation, template-pattern, or code-example']
		: [];

	return {
		results: results.map(r => ({
			title: r.title || '',
			excerpt: (r.excerpt || '').substring(0, 200),
			filePath: r.path || '',
			githubUrl: r.githubUrl || null,
			type: r.type || '',
			subType: r.subType || '',
			relevanceScore: r.relevanceScore,
			repository: r.repository || null,
			repositoryType: r.repositoryType || null,
			namespace: r.namespace || null,
			codeExamples: r.codeExamples || undefined,
			context: r.context || undefined
		})),
		totalResults,
		query,
		suggestions
	};
}

/**
 * Fetch content metadata items for a set of content hashes at a specific index version.
 *
 * Reads the `pk=content:{hash}, sk=v:{version}:metadata` items via the shared batched
 * reader ({@link batchGetMetadata}), so the semantic/assisted path uses the SAME chunked
 * `BatchGetItem` mechanism as the keyword path (R1.2) and the SAME content metadata the
 * keyword path returns. Hashes with no stored metadata are tolerated and simply omitted
 * from the map, and a read failure is degraded rather than thrown, so a partial or
 * superseded index can never fail the caller.
 *
 * Because the returned value is a `hash -> item` map, callers (e.g.
 * `services/documentation.js` `buildResults()`) preserve their own vector-rank order by
 * walking their ranked hits and looking each hash up in the map.
 *
 * @param {string} tableName - DynamoDB table name.
 * @param {string} version - Index version identifier whose metadata to read.
 * @param {Array<string>} hashes - Content hashes to fetch metadata for.
 * @returns {Promise<Object.<string, Object>>} Map of content hash to its metadata item
 *   (hashes with no stored metadata are omitted).
 * @example
 * const byHash = await getContentMetadataByHashes('my-doc-index-table', '20250715T060000', ['abc123', 'def456']);
 * // byHash.abc123 = { title, excerpt, path, type, subType, repository, ... }
 */
async function getContentMetadataByHashes(tableName, version, hashes) {
	return batchGetMetadata(tableName, version, hashes);
}

/**
 * Sleep for the given number of milliseconds.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recover the content hash from a metadata item's partition key
 * (`content:{hash}` -> `{hash}`).
 *
 * @param {string} pk - The content item partition key
 * @returns {string} The content hash, or an empty string when `pk` is not parseable
 */
function hashFromContentPk(pk) {
	if (typeof pk !== 'string' || !pk.startsWith(CONTENT_PK_PREFIX)) {
		return '';
	}
	return pk.slice(CONTENT_PK_PREFIX.length);
}

/**
 * Fetch the metadata items for a single chunk of at most {@link BATCH_GET_LIMIT} hashes,
 * retrying only `UnprocessedKeys` with bounded attempts and exponential backoff. Resolved
 * items are written into `map` keyed by content hash. A per-chunk request failure is
 * logged and degraded (those hashes are omitted) rather than failing the whole request.
 *
 * @param {DynamoDBDocumentClient} client - Shared document client
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @param {Array<string>} hashChunk - Up to {@link BATCH_GET_LIMIT} content hashes
 * @param {Object.<string, Object>} map - Accumulator map (mutated in place)
 * @returns {Promise<void>}
 */
async function fetchMetadataChunk(client, tableName, version, hashChunk, map) {
	let keys = hashChunk.map((hash) => ({
		pk: `${CONTENT_PK_PREFIX}${hash}`,
		sk: `v:${version}:metadata`
	}));

	let attempt = 0;
	while (keys.length > 0 && attempt < MAX_BATCH_GET_ATTEMPTS) {
		if (attempt > 0) {
			// >! Exponential backoff before retrying only the unprocessed keys.
			await sleep(BATCH_GET_BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
		}
		attempt++;

		let result;
		try {
			result = await client.send(new BatchGetCommand({
				RequestItems: { [tableName]: { Keys: keys } }
			}));
		} catch (error) {
			// >! Degrade gracefully: omit this chunk's hashes rather than failing the request.
			DebugAndLog.warn(`batchGetMetadata chunk failed: ${error.message}`);
			return;
		}

		const responses = result.Responses && result.Responses[tableName];
		if (Array.isArray(responses)) {
			for (const item of responses) {
				const hash = hashFromContentPk(item.pk);
				if (hash) {
					map[hash] = item;
				}
			}
		}

		// >! Retry ONLY the keys DynamoDB could not process; the set shrinks each round and
		// >! the attempt cap prevents an unbounded loop.
		const unprocessed = result.UnprocessedKeys && result.UnprocessedKeys[tableName];
		keys = (unprocessed && Array.isArray(unprocessed.Keys)) ? unprocessed.Keys : [];
	}
}

/**
 * Fetch content metadata items for a set of content hashes using batched DynamoDB
 * `BatchGetItem` requests instead of one serial `GetItem` per hash.
 *
 * Builds `pk=content:{hash}, sk=v:{version}:metadata` keys, chunks them at the 100-key
 * `BatchGetItem` limit, issues the chunks in parallel, retries only `UnprocessedKeys`
 * with a bounded number of attempts and exponential backoff, and returns a `hash -> item`
 * map. Hashes with no stored metadata (e.g. a superseded/partial index) are simply absent
 * from the map, and a per-chunk failure is degraded rather than failing the request.
 *
 * This is the shared enrichment primitive for both the keyword path ({@link queryIndex})
 * and the semantic/assisted path ({@link getContentMetadataByHashes}). Because
 * `BatchGetItem` may return items out of order and may omit missing keys, callers are
 * responsible for re-sorting the results by their pre-fetch ranking.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier whose metadata to read
 * @param {Array<string>} hashes - Content hashes to fetch metadata for
 * @returns {Promise<Object.<string, Object>>} Map of content hash to its metadata item
 *   (hashes with no stored metadata are omitted)
 * @example
 * const byHash = await batchGetMetadata('doc-index-table', '20250715T060000', ['abc', 'def']);
 * // byHash.abc = { pk: 'content:abc', title, excerpt, path, type, ... }
 */
async function batchGetMetadata(tableName, version, hashes) {
	const map = {};

	// >! Tolerate empty/invalid input and a missing version: return an empty map rather
	// >! than issuing malformed reads.
	if (!tableName || !version || !Array.isArray(hashes) || hashes.length === 0) {
		return map;
	}

	const uniqueHashes = [...new Set(hashes.filter((h) => typeof h === 'string' && h.length > 0))];
	if (uniqueHashes.length === 0) {
		return map;
	}

	const client = getDocClient();

	// Chunk at the 100-key BatchGetItem limit and issue the chunks in parallel.
	const chunks = [];
	for (let i = 0; i < uniqueHashes.length; i += BATCH_GET_LIMIT) {
		chunks.push(uniqueHashes.slice(i, i + BATCH_GET_LIMIT));
	}

	await Promise.all(chunks.map((hashChunk) => fetchMetadataChunk(client, tableName, version, hashChunk, map)));

	return map;
}

/**
 * Read a single section's content metadata item and return the pointers `get_document`
 * resolution needs.
 *
 * Reads `pk=content:{hash}, sk=v:{version}:metadata` through the shared batched reader
 * ({@link batchGetMetadata}), so it inherits that helper's bounded `UnprocessedKeys` retry
 * and its degrade-rather-than-throw behavior instead of duplicating a `GetItem` path.
 *
 * `documentHash` and `githubUrl` were added to the metadata item by spec 0-0-6 task 1.6;
 * items written before that deploy have them absent, so both are normalized to `null`. A
 * `null` return therefore means "no metadata item for this hash/version", which is distinct
 * from "item present but its pointers were never indexed".
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier whose metadata to read
 * @param {string} hash - Section content hash (16 hex characters)
 * @returns {Promise<?{documentHash: (string|null), githubUrl: (string|null)}>} The section's
 *   document pointer and file-level GitHub URL, or `null` when no metadata item exists
 * @example
 * const pointers = await getSectionMetadata('doc-index-table', '20250715T060000', 'ea6f1a2b3c4d5e6f');
 * // pointers = { documentHash: 'b1c2d3e4f5a60718', githubUrl: 'https://github.com/…/README.md' }
 */
async function getSectionMetadata(tableName, version, hash) {
	if (!tableName || !version || typeof hash !== 'string' || hash.length === 0) {
		return null;
	}

	const byHash = await batchGetMetadata(tableName, version, [hash]);
	const item = byHash[hash];

	if (!item) {
		return null;
	}

	return {
		// >! Normalize absent (pre-task-1.6) attributes to null so callers have one shape.
		documentHash: item.documentHash ?? null,
		githubUrl: item.githubUrl ?? null
	};
}

/**
 * Read the stored source file for a document hash.
 *
 * Reads the version-less `pk=document:{fileHash}, sk=content` item written once per source
 * file by the indexer (spec 0-0-6 task 1.5). Because the key omits the index version, the
 * caller never has to supply one (Requirement 2.4).
 *
 * This is a storage-only read: a missing item resolves to `null` and a read failure is
 * logged and degraded to `null`. Neither case triggers a GitHub fetch — delegating a
 * storage miss to the client is what keeps the server off GitHub's shared rate limit
 * (Requirement 6.5).
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} fileHash - Document (per-file) hash, 16 hex characters
 * @returns {Promise<?Object>} The document item (`content`, `documentPath`, `githubUrl`,
 *   `repositoryType`, `namespace`, `repository`, `owner`, …), or `null` when it is not stored
 * @example
 * const doc = await getDocumentByFileHash('doc-index-table', 'b1c2d3e4f5a60718');
 * // doc.content = '# Cache Data\n\n…'  (raw source file)
 */
async function getDocumentByFileHash(tableName, fileHash) {
	if (!tableName || typeof fileHash !== 'string' || fileHash.length === 0) {
		return null;
	}

	const client = getDocClient();

	try {
		const result = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: `${DOCUMENT_PK_PREFIX}${fileHash}`, sk: DOCUMENT_SK }
		}));

		return result.Item || null;
	} catch (error) {
		// >! Degrade to a storage miss rather than failing the caller; the client is handed
		// >! the GitHub URL and fetches the document itself.
		DebugAndLog.warn(`Failed to read document ${fileHash}: ${error.message}`);
		return null;
	}
}

/**
 * Test harness for accessing internal state for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Reset the DynamoDB client for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @private
	 */
	static resetClient() {
		docClient = null;
	}

	/**
	 * Get access to internal helpers for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{applyIndexedFilterPushDown: typeof applyIndexedFilterPushDown, applyExactPhraseBoost: typeof applyExactPhraseBoost, normalizeForPhraseMatch: typeof normalizeForPhraseMatch, EXACT_PHRASE_BOOST: number}} Internal helpers
	 * @private
	 * @example
	 * // In tests only - DO NOT use in production
	 * const { applyIndexedFilterPushDown } = TestHarness.getInternals();
	 * const kept = applyIndexedFilterPushDown([{ hash: 'a', type: 'documentation' }], 'documentation');
	 */
	static getInternals() {
		return {
			applyIndexedFilterPushDown,
			applyExactPhraseBoost,
			normalizeForPhraseMatch,
			EXACT_PHRASE_BOOST
		};
	}
}

module.exports = {
	getActiveVersion,
	getMainIndex,
	queryIndex,
	getContentMetadataByHashes,
	batchGetMetadata,
	getSectionMetadata,
	getDocumentByFileHash,
	setDocClient,
	TestHarness
};
