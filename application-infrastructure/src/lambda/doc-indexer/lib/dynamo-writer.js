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
 * Write content metadata items to DynamoDB for a set of extracted entries.
 * Each entry produces one metadata item (pk=`content:{hash}`,
 * sk=`v:{version}:metadata`).
 *
 * The former per-section, per-version body item (sk=`v:{version}:content`) is no
 * longer written. Source bodies are stored once per file by
 * {@link writeDocumentEntries} under a version-less `document:{fileHash}` key,
 * which removes the per-version duplication and is what `get_document` reads
 * (spec 0-0-6, task 1.5).
 *
 * In addition to the fields it has always stored, the metadata item carries the
 * file-level attributes captured upstream (spec 0-0-6, task 1.6): `githubUrl`,
 * `repositoryType`, `namespace`, and `documentHash`. `documentHash` is the pointer
 * used to resolve a section to its owning `document:{fileHash}` item, and the other
 * three are returned directly on search results. Each is stored as `null` when it
 * could not be derived upstream rather than failing the build.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier (e.g., "20250715T060000")
 * @param {Array<Object>} entries - Extracted content entries with hash, contentPath, title, excerpt, type, subType, keywords, repository, owner, githubUrl, repositoryType, namespace, documentHash
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeContentEntries('my-table', '20250715T060000', [{
 *   hash: 'ea6f1a2b3c4d5e6f',
 *   contentPath: '63klabs/cache-data/README.md/install',
 *   title: 'Install',
 *   excerpt: 'Run npm install...',
 *   type: 'documentation',
 *   subType: 'guide',
 *   keywords: ['install', 'npm'],
 *   repository: 'cache-data',
 *   owner: '63klabs',
 *   githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
 *   repositoryType: 'package',
 *   namespace: null,
 *   documentHash: 'b1c2d3e4f5a60718'
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
			// File-level attributes (spec 0-0-6). Stored as null when un-derivable so the
			// build never fails and the read path can treat them uniformly as absent.
			githubUrl: entry.githubUrl ?? null,
			repositoryType: entry.repositoryType ?? null,
			namespace: entry.namespace ?? null,
			documentHash: entry.documentHash ?? null,
			lastIndexed: now,
			ttl
		});
	}

	await batchWrite(tableName, items);
}

/**
 * Write one document item per source file (pk=`document:{fileHash}`, sk=`content`).
 *
 * Entries arrive per section; every section extracted from the same file carries the
 * same `documentHash`/`documentPath` and the same retained `fileContent`, so entries
 * are grouped by `documentHash` and only the first occurrence of each file is written.
 * A file with N headings therefore produces exactly one document item.
 *
 * The key deliberately omits the index version: each build upserts the same key with
 * the latest body and a refreshed 7-day TTL, so bodies are never duplicated across
 * versions and a file that disappears from a build simply expires via TTL. The
 * `version` argument is recorded as an attribute (alongside `lastIndexed`) to show
 * which build last refreshed the item; it is not part of the key.
 *
 * Fields that could not be derived upstream (`githubUrl`, `repositoryType`,
 * `namespace`) are stored as `null` rather than failing the build. Entries with no
 * `documentHash` are skipped for the same reason.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier (e.g., "20250715T060000")
 * @param {Array<Object>} entries - Extracted content entries carrying documentHash, documentPath, fileContent, githubUrl, repositoryType, namespace, repository, owner
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeDocumentEntries('my-table', '20250715T060000', [{
 *   documentHash: 'b1c2d3e4f5a60718',
 *   documentPath: '63klabs/cache-data/README.md',
 *   fileContent: '# Cache Data\n\nRun npm install @63klabs/cache-data\n',
 *   githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
 *   repositoryType: 'package',
 *   namespace: null,
 *   repository: 'cache-data',
 *   owner: '63klabs'
 * }]);
 */
async function writeDocumentEntries(tableName, version, entries) {
	const ttl = computeTtl();
	const now = new Date().toISOString();
	const documentItems = new Map();

	for (const entry of entries) {
		// Without a document hash there is no key to write; skip rather than fail the build.
		if (!entry || !entry.documentHash) {
			continue;
		}

		// One item per file: keep the first section's copy of the file-level values.
		if (documentItems.has(entry.documentHash)) {
			continue;
		}

		documentItems.set(entry.documentHash, {
			pk: `document:${entry.documentHash}`,
			sk: 'content',
			version,
			documentPath: entry.documentPath ?? null,
			content: entry.fileContent ?? null,
			githubUrl: entry.githubUrl ?? null,
			repositoryType: entry.repositoryType ?? null,
			namespace: entry.namespace ?? null,
			repository: entry.repository ?? null,
			owner: entry.owner ?? null,
			lastIndexed: now,
			ttl
		});
	}

	await batchWrite(tableName, Array.from(documentItems.values()));
}

/**
 * Write search keyword entries to DynamoDB. Each keyword for each entry
 * produces one item (pk=`search:{keyword}`, sk=`v:{version}:{hash}`)
 * with a pre-computed relevance score.
 *
 * Each entry also carries its content `type` and `subType` (spec 0-0-6, task 1.6) so the
 * read path can apply `type`/`subType` filters to the ranked hash set *before* the
 * metadata enrichment fetch, reading fewer metadata items for a filtered query. Absent
 * values are stored as `null`.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @param {Array<Object>} entries - Keyword entries with hash, keyword, relevanceScore, typeWeight, type, subType
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * await writeSearchKeywords('my-table', '20250715T060000', [{
 *   hash: 'ea6f1a2b3c4d5e6f',
 *   keyword: 'install',
 *   relevanceScore: 13,
 *   typeWeight: 1.0,
 *   type: 'documentation',
 *   subType: 'guide'
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
		// Carried for read-side filter push-down; null when the extractor produced no value.
		type: entry.type ?? null,
		subType: entry.subType ?? null,
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
/**
 * Maximum number of index entries per main index chunk.
 * Each entry is roughly 300-500 bytes serialized; 500 entries keeps
 * each DynamoDB item well under the 400KB limit.
 * @type {number}
 */
const MAIN_INDEX_CHUNK_SIZE = 500;

/**
 * Write the main index to DynamoDB, splitting across multiple items
 * if the entry count exceeds MAIN_INDEX_CHUNK_SIZE. Each chunk is
 * stored with sk=`entries:{chunkIndex}` and a manifest item at
 * sk=`entries` records the total chunk count and entry count.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @param {Array<Object>} indexEntries - Array of index entry objects with hash, path, type, subType, title, repository, owner, keywords
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 */
async function writeMainIndex(tableName, version, indexEntries) {
	const ttl = computeTtl();
	const client = getDocClient();
	const chunks = chunk(indexEntries, MAIN_INDEX_CHUNK_SIZE);

	// Write each chunk
	for (let i = 0; i < chunks.length; i++) {
		const chunkItem = {
			pk: `mainindex:${version}`,
			sk: `entries:${i}`,
			version,
			entries: chunks[i],
			chunkIndex: i,
			ttl
		};
		await client.send(new PutCommand({ TableName: tableName, Item: chunkItem }));
	}

	// Write manifest item so readers know how many chunks to fetch
	const manifest = {
		pk: `mainindex:${version}`,
		sk: 'entries',
		version,
		entryCount: indexEntries.length,
		totalChunks: chunks.length,
		ttl
	};
	await client.send(new PutCommand({ TableName: tableName, Item: manifest }));
}

/**
 * Update the version pointer to point to the new active index version.
 *
 * When `embeddingMeta` is provided (only after the index-time embedding phase actually
 * wrote vectors for this version — spec 0-0-6), the pointer item additionally records
 * `embeddingEnabled: true`, `embeddingModel`, and `embeddingDimensions`, so the query path
 * can embed queries with the SAME model/dimensions the index was built with. When it is
 * omitted (the default, and the AI-disabled path) the item keeps its original keyword-only
 * shape, byte-for-byte unchanged.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} newVersion - New version identifier to activate
 * @param {string|null} previousVersion - Previous version identifier (for rollback reference)
 * @param {{model: string, dimensions: number}} [embeddingMeta] - When present, records the embedding model/dimensions this version was built with on the pointer item.
 * @returns {Promise<void>}
 * @throws {Error} When a DynamoDB write fails
 * @example
 * // Keyword-only (default): the pointer item has no embedding attributes.
 * await updateVersionPointer('my-table', '20250715T060000', '20250714T060000');
 * @example
 * // Semantic index built: record the embedding model/dimensions on the pointer.
 * await updateVersionPointer('my-table', '20250715T060000', '20250714T060000', {
 *   model: 'amazon.titan-embed-text-v2:0', dimensions: 1024
 * });
 */
async function updateVersionPointer(tableName, newVersion, previousVersion, embeddingMeta) {
	const client = getDocClient();

	const item = {
		pk: 'version:pointer',
		sk: 'active',
		version: newVersion,
		previousVersion: previousVersion || null,
		updatedAt: new Date().toISOString()
	};

	// >! Only augment the pointer when the caller passes embeddingMeta (i.e. vectors were
	// >! actually written for this version). Omitted/undefined leaves the item byte-for-byte
	// >! identical to the keyword-only behavior, preserving the disabled no-op guarantee.
	if (embeddingMeta && typeof embeddingMeta === 'object') {
		item.embeddingEnabled = true;
		item.embeddingModel = embeddingMeta.model;
		item.embeddingDimensions = embeddingMeta.dimensions;
	}

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
	writeDocumentEntries,
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
	SEVEN_DAYS_SECONDS,
	MAIN_INDEX_CHUNK_SIZE
};
