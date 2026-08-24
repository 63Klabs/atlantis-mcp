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
 * Documentation Index DAO
 *
 * Queries the persistent DynamoDB-backed documentation index built by the
 * Indexer Lambda. Replaces the previous in-memory index building approach.
 *
 * DynamoDB key patterns:
 * - Version pointer: pk=`version:pointer`, sk=`active`
 * - Main index: pk=`mainindex:{version}`, sk=`entries`
 * - Content metadata: pk=`content:{hash}`, sk=`v:{version}:metadata`
 * - Content body: pk=`content:{hash}`, sk=`v:{version}:content`
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
						scoresByHash[hash] = { hash, totalScore: 0, typeWeight: item.typeWeight || 1.0 };
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

	// >! Fetch content metadata for top results (before type filtering, fetch enough)
	const fetchLimit = Math.min(ranked.length, limit * 3);
	const topHashes = ranked.slice(0, fetchLimit);

	const metadataResults = [];
	for (const entry of topHashes) {
		try {
			const metaResult = await client.send(new GetCommand({
				TableName: tableName,
				Key: {
					pk: `content:${entry.hash}`,
					sk: `v:${version}:metadata`
				}
			}));

			if (metaResult.Item) {
				metadataResults.push({
					...metaResult.Item,
					relevanceScore: entry.totalScore
				});
			}
		} catch (error) {
			DebugAndLog.warn(`Failed to fetch metadata for hash ${entry.hash}: ${error.message}`);
		}
	}

	// >! Apply type filters
	let filtered = metadataResults;
	if (type) {
		filtered = filtered.filter(item => item.type === type);
	}
	if (subType) {
		filtered = filtered.filter(item => item.subType === subType);
	}

	// >! Sort by relevance descending (already mostly sorted, but re-sort after filtering)
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
 * Reads each `pk=content:{hash}, sk=v:{version}:metadata` item using the same shared
 * DynamoDB Document Client and `GetCommand` access pattern as {@link queryIndex}, and
 * returns a `hash -> item` map. Hashes with no stored metadata are tolerated and simply
 * omitted from the map, and a per-hash read error is logged and skipped, so a partial or
 * superseded index can never fail the caller. Used by the semantic retrieval path (task
 * 8.4) to enrich ranked vector hits with the SAME content metadata the keyword path
 * returns, so both paths share one enrichment source.
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
	const map = {};

	// >! Tolerate empty/invalid input and a missing version: return an empty map rather
	// >! than issuing malformed reads, so a caller can pass ranked hits through unchanged.
	if (!Array.isArray(hashes) || hashes.length === 0 || !version) {
		return map;
	}

	const client = getDocClient();

	for (const hash of hashes) {
		try {
			const metaResult = await client.send(new GetCommand({
				TableName: tableName,
				Key: {
					pk: `content:${hash}`,
					sk: `v:${version}:metadata`
				}
			}));

			// >! Skip hashes with no stored metadata (e.g. superseded/partial index) so the
			// >! returned map only contains fully-resolvable content.
			if (metaResult.Item) {
				map[hash] = metaResult.Item;
			}
		} catch (error) {
			DebugAndLog.warn(`Failed to fetch content metadata for hash ${hash}: ${error.message}`);
		}
	}

	return map;
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
}

module.exports = {
	getActiveVersion,
	getMainIndex,
	queryIndex,
	getContentMetadataByHashes,
	batchGetMetadata,
	setDocClient,
	TestHarness
};
