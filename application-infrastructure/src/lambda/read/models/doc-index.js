'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { Config } = require('../config');

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
		const result = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: `mainindex:${version}`, sk: 'entries' }
		}));

		if (result.Item && Array.isArray(result.Item.entries)) {
			return result.Item.entries;
		}

		return [];
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
	setDocClient,
	TestHarness
};
