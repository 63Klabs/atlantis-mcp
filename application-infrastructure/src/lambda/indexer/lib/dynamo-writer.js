'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Maximum items per DynamoDB BatchWriteItem request.
 * @type {number}
 */
const BATCH_LIMIT = 25;

/**
 * Seven days in seconds, used for TTL calculation.
 * @type {number}
 */
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

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
 * Compute a TTL timestamp approximately 7 days from now.
 *
 * @returns {number} Unix timestamp in seconds
 */
function computeTtl() {
	return Math.floor(Date.now() / 1000) + SEVEN_DAYS_SECONDS;
}

/**
 * Split an array into chunks of the given size.
 *
 * @param {Array<*>} items - Array to split
 * @param {number} size - Maximum chunk size
 * @returns {Array<Array<*>>} Array of chunks
 */
function chunk(items, size) {
	const chunks = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

/**
 * Deduplicate items by their pk+sk composite key, keeping the last occurrence.
 *
 * @param {Array<Object>} items - Array of DynamoDB items with pk and sk attributes
 * @returns {Array<Object>} Deduplicated array
 */
function deduplicateItems(items) {
	const seen = new Map();
	for (const item of items) {
		const key = `${item.pk}#${item.sk}`;
		seen.set(key, item);
	}
	return Array.from(seen.values());
}

/**
 * Execute a BatchWriteItem request, handling the 25-item limit.
 * Deduplicates items by pk+sk before batching to avoid DynamoDB
 * ValidationException for duplicate keys within a single batch.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {Array<Object>} putRequests - Array of PutRequest items
 * @returns {Promise<void>}
 */
async function batchWrite(tableName, putRequests) {
	const client = getDocClient();
	const deduplicated = deduplicateItems(putRequests);
	const batches = chunk(deduplicated, BATCH_LIMIT);

	for (const batch of batches) {
		const params = {
			RequestItems: {
				[tableName]: batch.map(item => ({
					PutRequest: { Item: item }
				}))
			}
		};
		await client.send(new BatchWriteCommand(params));
	}
}

/**
 * Write content metadata and content body items to DynamoDB for a set
 * of extracted entries. Each entry produces two items: a metadata item
 * (pk=`content:{hash}`, sk=`v:{version}:metadata`) and a content body
 * item (pk=`content:{hash}`, sk=`v:{version}:content`).
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier (e.g., "20250715T060000")
 * @param {Array<Object>} entries - Extracted content entries with hash, contentPath, title, excerpt, content, type, subType, keywords, repository, owner
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeContentEntries('my-table', '20250715T060000', [{
 *   hash: 'ea6f1a2b3c4d5e6f',
 *   contentPath: '63klabs/cache-data/README.md/install',
 *   title: 'Install',
 *   excerpt: 'Run npm install...',
 *   content: 'Run npm install @63klabs/cache-data',
 *   type: 'documentation',
 *   subType: 'guide',
 *   keywords: ['install', 'npm'],
 *   repository: 'cache-data',
 *   owner: '63klabs'
 * }]);
 */
async function writeContentEntries(tableName, version, entries) {
	const ttl = computeTtl();
	const items = [];

	for (const entry of entries) {
		const now = new Date().toISOString();

		items.push({
			pk: `content:${entry.hash}`,
			sk: `v:${version}:metadata`,
			version,
			path: entry.contentPath,
			type: entry.type,
			subType: entry.subType,
			title: entry.title,
			excerpt: entry.excerpt,
			repository: entry.repository,
			owner: entry.owner,
			keywords: entry.keywords,
			lastIndexed: now,
			ttl
		});

		items.push({
			pk: `content:${entry.hash}`,
			sk: `v:${version}:content`,
			version,
			content: entry.content,
			ttl
		});
	}

	await batchWrite(tableName, items);
}

/**
 * Write search keyword entries to DynamoDB. Each keyword for each entry
 * produces one item (pk=`search:{keyword}`, sk=`v:{version}:{hash}`)
 * with a pre-computed relevance score.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @param {Array<Object>} entries - Keyword entries with hash, keyword, relevanceScore, typeWeight
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeSearchKeywords('my-table', '20250715T060000', [{
 *   hash: 'ea6f1a2b3c4d5e6f',
 *   keyword: 'install',
 *   relevanceScore: 13,
 *   typeWeight: 1.0
 * }]);
 */
async function writeSearchKeywords(tableName, version, entries) {
	const ttl = computeTtl();
	const items = entries.map(entry => ({
		pk: `search:${entry.keyword}`,
		sk: `v:${version}:${entry.hash}`,
		version,
		hash: entry.hash,
		relevanceScore: entry.relevanceScore,
		typeWeight: entry.typeWeight,
		ttl
	}));

	await batchWrite(tableName, items);
}

/**
 * Write the main index entry to DynamoDB. The main index maps all
 * indexed content paths to their hashes and metadata.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @param {Array<Object>} indexEntries - Array of index entry objects with hash, path, type, subType, title, repository, owner, keywords
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeMainIndex('my-table', '20250715T060000', [{
 *   hash: 'ea6f1a2b3c4d5e6f',
 *   path: '63klabs/cache-data/README.md/install',
 *   type: 'documentation',
 *   subType: 'guide',
 *   title: 'Install',
 *   repository: 'cache-data',
 *   owner: '63klabs',
 *   keywords: ['install', 'npm'],
 *   lastIndexed: '2025-07-15T06:10:00Z'
 * }]);
 */
async function writeMainIndex(tableName, version, indexEntries) {
	const ttl = computeTtl();
	const client = getDocClient();

	const item = {
		pk: `mainindex:${version}`,
		sk: 'entries',
		version,
		entries: indexEntries,
		entryCount: indexEntries.length,
		ttl
	};

	await client.send(new PutCommand({ TableName: tableName, Item: item }));
}

/**
 * Update the version pointer to point to the new active index version.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} newVersion - New version identifier to activate
 * @param {string|null} previousVersion - Previous version identifier (for rollback reference)
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await updateVersionPointer('my-table', '20250715T060000', '20250714T060000');
 */
async function updateVersionPointer(tableName, newVersion, previousVersion) {
	const client = getDocClient();

	const item = {
		pk: 'version:pointer',
		sk: 'active',
		version: newVersion,
		previousVersion: previousVersion || null,
		updatedAt: new Date().toISOString()
	};

	await client.send(new PutCommand({ TableName: tableName, Item: item }));
}

/**
 * Set TTL on previous version entries so they are cleaned up after ~7 days.
 * This is a no-op if previousVersion is null (first build).
 *
 * Note: In practice, TTL is already set when entries are written. This
 * function exists for explicit TTL updates on older entries if needed.
 * Since all versioned entries are written with a TTL at creation time,
 * this serves as a safety net.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string|null} previousVersion - Previous version identifier
 * @param {number} ttlTimestamp - Unix timestamp for TTL expiration
 * @returns {Promise<void>}
 */
async function setTtlOnPreviousVersion(tableName, previousVersion, ttlTimestamp) {
	if (!previousVersion) {
		return;
	}
	// TTL is set at write time on all versioned entries.
	// This function is a placeholder for explicit TTL updates
	// on previous version entries if the cleanup strategy changes.
	// Currently a no-op since entries already have TTL set.
}

module.exports = {
	writeContentEntries,
	writeSearchKeywords,
	writeMainIndex,
	updateVersionPointer,
	setTtlOnPreviousVersion,
	// Exposed for testing
	getDocClient,
	setDocClient,
	computeTtl,
	batchWrite,
	chunk,
	deduplicateItems,
	BATCH_LIMIT,
	SEVEN_DAYS_SECONDS
};
