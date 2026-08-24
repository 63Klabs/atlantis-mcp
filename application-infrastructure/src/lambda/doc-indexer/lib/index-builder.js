'use strict';

const http = require('http');
const { hashContentPath } = require('./hasher');
const { isIndexable } = require('./file-filter');
const { extractArchive } = require('./archive-processor');
const {
	listRepositories,
	getLatestRelease,
	downloadArchive,
	getRepositoryProperties,
	buildGithubUrl
} = require('./github-client');
const markdownExtractor = require('./extractors/markdown');
const jsdocExtractor = require('./extractors/jsdoc');
const pythonExtractor = require('./extractors/python');
const cfnExtractor = require('./extractors/cloudformation');
const {
	writeContentEntries,
	writeSearchKeywords,
	writeMainIndex,
	updateVersionPointer,
	setTtlOnPreviousVersion,
	computeTtl,
	SEVEN_DAYS_SECONDS
} = require('./dynamo-writer');
const { loadDocAiSettings } = require('./settings');
const {
	buildEmbeddingInput,
	computeEmbeddingInputHash,
	shouldReuseEmbedding
} = require('./embedding-input');

/**
 * Content type weights for relevance scoring.
 * @type {Object.<string, number>}
 */
const TYPE_WEIGHTS = {
	'documentation': 1.0,
	'template-pattern': 0.9,
	'code-example': 0.8
};

/**
 * Relevance score component weights.
 * @type {Object.<string, number>}
 */
const SCORE_WEIGHTS = {
	titleMatch: 10,
	excerptMatch: 5,
	keywordMatch: 3
};

/**
 * Parse the ATLANTIS_GITHUB_USER_ORGS environment variable into
 * a trimmed, non-empty array of organization/user names.
 *
 * @param {string} envValue - Comma-delimited string of org names
 * @returns {Array<string>} Trimmed, non-empty org names
 * @example
 * parseOrgs('63klabs, acme-corp , test-org');
 * // ['63klabs', 'acme-corp', 'test-org']
 */
function parseOrgs(envValue) {
	if (!envValue || typeof envValue !== 'string') {
		return [];
	}
	return envValue
		.split(',')
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

/**
 * Generate a version identifier from the current timestamp.
 *
 * @returns {string} Version string in format "YYYYMMDDTHHmmss"
 * @example
 * generateVersion(); // "20250715T060000"
 */
function generateVersion() {
	const now = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Retrieve the GitHub token from SSM Parameter Store using the
 * Parameters and Secrets Lambda Extension HTTP interface.
 *
 * @param {string} paramStorePath - Base parameter path (e.g., "/atlantis/mcp/")
 * @returns {Promise<string>} GitHub Personal Access Token
 * @throws {Error} When the token is not configured or retrieval fails
 */
async function getGitHubToken(paramStorePath) {
	const paramName = `${paramStorePath}GitHubToken`;
	const sessionToken = process.env.AWS_SESSION_TOKEN;
	console.log(paramName);

	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'localhost',
			port: 2773,
			path: `/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}&withDecryption=true`,
			method: 'GET',
			headers: {
				'X-Aws-Parameters-Secrets-Token': sessionToken
			}
		};

		const req = http.request(options, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				try {
					const body = Buffer.concat(chunks).toString('utf8');
					const data = JSON.parse(body);
					const value = data.Parameter && data.Parameter.Value;
					if (!value) {
						reject(new Error('GitHub token is not configured or is blank'));
						return;
					}
					resolve(value);
				} catch (err) {
					reject(new Error(`Failed to parse SSM response: ${err.message}`));
				}
			});
		});

		req.on('error', (err) => {
			reject(new Error(`Failed to retrieve GitHub token from SSM: ${err.message}`));
		});

		req.end();
	});
}

/**
 * Select the appropriate extractor for a file based on its extension.
 *
 * @param {string} filePath - File path within the repository
 * @returns {{extract: function}|null} Extractor module or null
 */
function getExtractor(filePath) {
	const ext = filePath.split('.').pop().toLowerCase();
	const baseName = filePath.split('/').pop().toLowerCase();

	if (filePath.endsWith('.md')) {
		return markdownExtractor;
	}
	if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
		return jsdocExtractor;
	}
	if (filePath.endsWith('.py')) {
		return pythonExtractor;
	}
	if ((filePath.endsWith('.yml') || filePath.endsWith('.yaml')) && baseName.startsWith('template')) {
		return cfnExtractor;
	}
	return null;
}

/**
 * Compute relevance score for a keyword relative to a content entry.
 * Scoring: title match +10, excerpt match +5, keyword match +3.
 *
 * @param {string} keyword - The keyword being scored
 * @param {Object} entry - Content entry with title, excerpt, keywords
 * @returns {number} Relevance score
 */
function computeRelevanceScore(keyword, entry) {
	let score = 0;
	const lowerKeyword = keyword.toLowerCase();

	if (entry.title && entry.title.toLowerCase().includes(lowerKeyword)) {
		score += SCORE_WEIGHTS.titleMatch;
	}
	if (entry.excerpt && entry.excerpt.toLowerCase().includes(lowerKeyword)) {
		score += SCORE_WEIGHTS.excerptMatch;
	}
	if (entry.keywords && entry.keywords.some(k => k.toLowerCase() === lowerKeyword)) {
		score += SCORE_WEIGHTS.keywordMatch;
	}

	return score;
}

/**
 * Build keyword entries with relevance scores for a set of content entries.
 *
 * @param {Array<Object>} entries - Content entries with hash, title, excerpt, keywords, type
 * @returns {Array<{hash: string, keyword: string, relevanceScore: number, typeWeight: number}>}
 */
function buildKeywordEntries(entries) {
	const keywordEntries = [];

	for (const entry of entries) {
		const typeWeight = TYPE_WEIGHTS[entry.type] || 0.8;
		// Deduplicate keywords per entry to avoid duplicate pk/sk in DynamoDB batch writes
		const uniqueKeywords = [...new Set(entry.keywords.map(k => k.toLowerCase()))];

		for (const keyword of uniqueKeywords) {
			const baseScore = computeRelevanceScore(keyword, entry);
			const relevanceScore = Math.round(baseScore * typeWeight);

			keywordEntries.push({
				hash: entry.hash,
				keyword,
				relevanceScore,
				typeWeight
			});
		}
	}

	return keywordEntries;
}

/**
 * Process a single repository: download archive, extract files, run extractors.
 *
 * Each returned entry carries, in addition to the extractor output:
 * - `hash` — SHA-256(contentPath) truncated to 16 hex (the per-section content key).
 * - `documentPath` — `{org}/{repo}/{filePath}` (file-level, no heading slug).
 * - `documentHash` — SHA-256(documentPath) truncated to 16 hex (the per-file document key,
 *   used by `get_document` resolution and the `document:{fileHash}` write in task 1.5).
 * - `githubUrl` — file-level `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}`, or
 *   `null` when a component is unavailable. `{ref}` is the release tag when the release
 *   archive was downloaded, else the repository default branch.
 * - `repositoryType` / `namespace` — from the repository's GitHub custom properties, or
 *   `null` when absent (best-effort; a custom-property failure never fails the build).
 * - `fileContent` — the full raw source file text, retained so task 1.5 can write one
 *   `document:{fileHash}` item per file (de-duplicated by `documentHash`).
 *
 * @param {Object} repo - Repository info with name, defaultBranch, owner
 * @param {string} token - GitHub PAT
 * @returns {Promise<Array<Object>>} Extracted content entries with hash and file-level metadata
 */
async function processRepository(repo, token) {
	const release = await getLatestRelease(repo.owner, repo.name, token);

	let archiveUrl;
	let ref;
	if (release) {
		archiveUrl = release.zipUrl;
		// Ref actually indexed: the release tag when the release archive was downloaded.
		ref = release.tagName;
	} else {
		archiveUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/zipball/${repo.defaultBranch}`;
		// Otherwise the default branch that was archived.
		ref = repo.defaultBranch;
	}

	// Repository classification (best-effort; never throws, never fails the build).
	const { repositoryType, namespace } = await getRepositoryProperties(repo.owner, repo.name, token);

	const buffer = await downloadArchive(archiveUrl, token);
	const files = extractArchive(buffer);
	const entries = [];

	for (const file of files) {
		if (!isIndexable(file.path)) {
			continue;
		}

		const extractor = getExtractor(file.path);
		if (!extractor) {
			continue;
		}

		try {
			const extracted = extractor.extract(file.content, file.path, {
				org: repo.owner,
				repo: repo.name
			});

			// File-level values shared by every section entry from this file.
			const documentPath = `${repo.owner}/${repo.name}/${file.path}`;
			const documentHash = hashContentPath(documentPath);
			const githubUrl = buildGithubUrl({
				owner: repo.owner,
				repo: repo.name,
				ref,
				filePath: file.path
			});

			for (const entry of extracted) {
				entries.push({
					...entry,
					hash: hashContentPath(entry.contentPath),
					documentPath,
					documentHash,
					githubUrl,
					repositoryType,
					namespace,
					ref,
					// Full raw file body retained so task 1.5 writes it once per file.
					fileContent: file.content,
					repository: repo.name,
					owner: repo.owner
				});
			}
		} catch (err) {
			console.warn(JSON.stringify({
				level: 'WARN',
				event: 'extractor_error',
				org: repo.owner,
				repo: repo.name,
				file: file.path,
				error: err.message
			}));
		}
	}

	return entries;
}

/**
 * Require a `doc-ai-common` layer module by base name.
 *
 * In Lambda the layer is extracted to `/opt/nodejs`; tests point `DOC_AI_LAYER_PATH` at
 * the local layer `nodejs/` directory so they can load the real modules without the
 * runtime layer. Isolating the require here keeps the layer-load target in a single,
 * auditable place and lets the embedding phase treat a load failure as recoverable.
 *
 * @param {string} name - Layer module base name (e.g. `'embedding-provider'`, `'vector-store'`).
 * @returns {Object} The required module's exports.
 * @example
 * const { EmbeddingProvider } = loadLayerModule('embedding-provider');
 */
function loadLayerModule(name) {
	// >! Layer path from a fixed env var with a safe default; `name` is a first-party
	// >! constant (never user input), so this is not a dynamic-require injection risk.
	const base = process.env.DOC_AI_LAYER_PATH || '/opt/nodejs';
	return require(`${base}/${name}`);
}

/**
 * Load a prior index version's embeddings into a hash-keyed map for incremental reuse.
 *
 * Reads the previous version's vectors from the store (only when a previous version
 * exists) and builds `Map(hash -> { embeddingInputHash, model, dims, vector })` so the
 * embedding phase can decide, per entry, whether to reuse instead of re-embedding
 * (Requirement 6.2). Any failure (or no previous version) yields an empty map, so every
 * entry is (re)embedded rather than failing the build.
 *
 * @param {Object} vectorStore - A VectorStore exposing `getVersionVectors(version)`.
 * @param {?string} previousVersion - The prior index version, or falsy on first build.
 * @returns {Promise<Map<string, {embeddingInputHash: (string|undefined), model: (string|undefined), dims: (number|undefined), vector: number[]}>>}
 *   Map keyed by content hash (empty when there is nothing to reuse).
 * @example
 * const prior = await loadPriorEmbeddings(store, 'v2');
 * const record = prior.get(entry.hash); // maybe { embeddingInputHash, model, dims, vector }
 */
async function loadPriorEmbeddings(vectorStore, previousVersion) {
	const map = new Map();
	// No previous version (first build) or a store that cannot enumerate -> nothing to reuse.
	if (!previousVersion || !vectorStore || typeof vectorStore.getVersionVectors !== 'function') {
		return map;
	}

	try {
		const records = await vectorStore.getVersionVectors(previousVersion);
		for (const record of records) {
			if (!record || typeof record.hash !== 'string' || record.hash.length === 0) {
				continue;
			}
			const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata : {};
			map.set(record.hash, {
				embeddingInputHash: metadata.embeddingInputHash,
				model: metadata.model,
				dims: metadata.dims,
				vector: record.vector
			});
		}
	} catch (err) {
		// >! Non-fatal: log and return an empty map so all entries are (re)embedded rather
		// >! than failing the build (a rebuilt index is better than none).
		console.warn(JSON.stringify({
			level: 'WARN',
			event: 'prior_embeddings_load_failed',
			previousVersion,
			error: err.message
		}));
		return new Map();
	}

	return map;
}

/**
 * Run the index-time embedding phase for one build: compute each entry's embedding input
 * and hash, reuse a matching prior-version embedding when possible (Requirement 6.2) or
 * embed via Bedrock otherwise, and upsert the resulting vectors to the configured store.
 *
 * This phase is failure-tolerant (design "Error Handling"): a layer require/construct
 * failure skips the phase, a per-entry embedding failure skips just that entry, and an
 * upsert failure is logged — none of them fail the overall build, so the keyword index
 * (already written) still succeeds. It is exported so task 5.3 can unit test it with
 * injected `embeddingProvider`, `vectorStore`, and `priorEmbeddings`.
 *
 * Returns a summary `{ ran, upserted, total, reused, embedded, skipped, model, dimensions }`
 * that {@link build} uses to decide whether to record the embedding model/dimensions on the
 * `version:pointer/active` item (task 5.2). `upserted` is `true` only when the store write
 * succeeded AND at least one vector record was produced; it is `false` when the phase init
 * failed, no records were produced, or the upsert threw (all already logged/degraded).
 *
 * @param {Object} params - Phase inputs.
 * @param {string} params.tableName - DocIndex table name (used to construct the default DynamoDB store).
 * @param {string} params.version - The new index version the vectors are written under.
 * @param {?string} params.previousVersion - Prior index version for reuse (falsy on first build).
 * @param {Array<Object>} params.entries - Deduplicated content entries (`{ hash, title, excerpt, content, type, subType, repository, owner, ... }`).
 * @param {Object} params.docAi - The `documentation.ai` settings block (from {@link loadDocAiSettings}).
 * @param {Object} [params.embeddingProvider] - Injected EmbeddingProvider (test seam); constructed from the layer when omitted.
 * @param {Object} [params.vectorStore] - Injected VectorStore (test seam); constructed from the layer when omitted.
 * @param {Map<string, Object>} [params.priorEmbeddings] - Injected prior-embedding map (test seam); loaded via {@link loadPriorEmbeddings} when omitted.
 * @returns {Promise<{ran: boolean, upserted: boolean, total: number, reused: number, embedded: number, skipped: number, model: string, dimensions: number}>}
 *   A summary of the phase (never rejects for embedding/store failures); `upserted` gates the version-metadata write in {@link build}.
 * @example
 * await runEmbeddingPhase({
 *   tableName, version, previousVersion, entries: uniqueEntries, docAi,
 *   embeddingProvider: mockProvider, vectorStore: mockStore, priorEmbeddings: new Map()
 * });
 */
async function runEmbeddingPhase({
	tableName,
	version,
	previousVersion,
	entries,
	docAi,
	embeddingProvider,
	vectorStore,
	priorEmbeddings
}) {
	const model = docAi.embedding.model;
	const dimensions = docAi.embedding.dimensions;
	const entryList = Array.isArray(entries) ? entries : [];

	// Resolve the provider + store. Tests inject them; in Lambda they are constructed from
	// the doc-ai-common layer. A require/construct failure must NOT fail the build — log
	// and skip the phase (design "Error Handling": partial index is better than none).
	let provider = embeddingProvider || null;
	let store = vectorStore || null;
	if (!provider || !store) {
		try {
			if (!provider) {
				const { EmbeddingProvider } = loadLayerModule('embedding-provider');
				provider = new EmbeddingProvider({
					model: docAi.embedding.model,
					dimensions: docAi.embedding.dimensions,
					maxInputTokens: docAi.embedding.maxInputTokens,
					// >! Optional cross-region pin (Requirement 10.1). Read defensively: this
					// >! settings field may be absent until the settings module adds it, and an
					// >! empty/unset value cleanly falls back to the deployment region (identical
					// >! to prior behavior).
					region: docAi.embedding.region ?? ''
				});
			}
			if (!store) {
				const { createVectorStore } = loadLayerModule('vector-store');
				store = createVectorStore({
					vectorStore: docAi.vectorStore,
					dimensions: docAi.embedding.dimensions,
					dynamodb: { tableName },
					s3Vectors: docAi.s3Vectors
				});
			}
		} catch (err) {
			// >! Layer unavailable or store misconfigured: skip embeddings without failing
			// >! the build. The keyword index is unaffected.
			console.error(JSON.stringify({
				level: 'ERROR',
				event: 'embedding_phase_init_failed',
				version,
				error: err.message
			}));
			// >! Phase could not run: report nothing upserted so build() writes the version
			// >! pointer with its keyword-only shape (no embedding metadata recorded).
			return { ran: true, upserted: false, total: entryList.length, reused: 0, embedded: 0, skipped: 0, model, dimensions };
		}
	}

	// Prior-version embeddings for incremental reuse (empty map on first build / any error).
	const prior = priorEmbeddings || await loadPriorEmbeddings(store, previousVersion);

	let reused = 0;
	let embedded = 0;
	let skipped = 0;
	const vectorRecords = [];

	for (const entry of entryList) {
		const embeddingInput = buildEmbeddingInput(entry);
		if (embeddingInput.length === 0) {
			// No embeddable text (no title/excerpt/content) — skip without calling Bedrock.
			skipped++;
			continue;
		}
		const embeddingInputHash = computeEmbeddingInputHash(embeddingInput);

		let vector;
		const priorRecord = prior.get(entry.hash);
		if (shouldReuseEmbedding(priorRecord, { embeddingInputHash, model, dimensions })) {
			// >! Reuse the unchanged prior embedding — no Bedrock call (Requirement 6.2).
			vector = priorRecord.vector;
			reused++;
		} else {
			try {
				vector = await provider.embed(embeddingInput);
				embedded++;
			} catch (err) {
				// >! Per-entry embedding failure is logged and skipped (partial index is
				// >! better than none); it never fails the build. No input text is logged,
				// >! only the content hash + error code.
				console.warn(JSON.stringify({
					level: 'WARN',
					event: 'embedding_entry_skipped',
					version,
					hash: entry.hash,
					code: (err && err.code) ? err.code : 'EMBEDDING_ERROR',
					error: err ? err.message : 'unknown'
				}));
				// >! A model-not-available classification is a configuration problem
				// >! (wrong model id or a region without access), not routine degrade
				// >! noise. Emit ONE additional ERROR-level line — carrying the model id
				// >! and the region that was targeted (DocAiEmbeddingRegion when set,
				// >! otherwise the deployment region) — so it is loud and searchable
				// >! (Requirement 10.5). No input text is logged. This does not change the
				// >! degrade behavior: the entry is still skipped below.
				const isModelUnavailable = (err && err.code === 'MODEL_NOT_AVAILABLE')
					|| (err && err.cause && err.cause.code === 'MODEL_NOT_AVAILABLE');
				if (isModelUnavailable) {
					console.error(JSON.stringify({
						level: 'ERROR',
						event: 'doc_ai_bedrock_model_unavailable',
						version,
						model,
						region: docAi.embedding.region || process.env.AWS_REGION || ''
					}));
				}
				skipped++;
				continue;
			}
		}

		vectorRecords.push({
			hash: entry.hash,
			vector,
			metadata: {
				type: entry.type,
				subType: entry.subType,
				repository: entry.repository,
				owner: entry.owner,
				embeddingInputHash,
				model,
				dims: dimensions
			}
		});
	}

	// Upsert all vectors for this version. A store failure is logged and swallowed so the
	// already-written keyword index still succeeds (graceful degradation).
	let upsertSucceeded = false;
	try {
		await store.upsertVectors(version, vectorRecords);
		upsertSucceeded = true;
	} catch (err) {
		console.error(JSON.stringify({
			level: 'ERROR',
			event: 'embedding_upsert_failed',
			version,
			error: err ? err.message : 'unknown'
		}));
	}

	// >! Report the version as "upserted" only when the store write succeeded AND at least
	// >! one vector record was produced. build() records the embedding model/dimensions on
	// >! version:pointer/active only when this is true, so the query path (task 6.2) never
	// >! attempts semantic retrieval against a version that has no vectors — it falls back
	// >! to keyword instead (Req 2.5).
	const upserted = upsertSucceeded && vectorRecords.length > 0;

	console.log(JSON.stringify({
		level: 'INFO',
		event: 'embedding_phase_complete',
		version,
		total: entryList.length,
		reused,
		embedded,
		skipped,
		upserted
	}));

	return {
		ran: true,
		upserted,
		total: entryList.length,
		reused,
		embedded,
		skipped,
		model,
		dimensions
	};
}

/**
 * Build the complete documentation index. This is the main orchestrator
 * that coordinates the full index build lifecycle:
 *
 * 1. Parse org list from environment
 * 2. Retrieve GitHub token from SSM
 * 3. Discover and process repositories
 * 4. Write content entries, keyword entries, and main index to DynamoDB
 * 5. Update version pointer on success
 * 6. Set TTL on previous version entries
 *
 * If the build fails at any point, the version pointer remains unchanged.
 *
 * When the AI feature is enabled (spec 0-0-6), an index-time embedding phase runs after
 * the main index is written and before the version pointer flips; it is skipped entirely
 * (no layer/Bedrock/store work) when disabled, and its failures never fail the build.
 *
 * @param {Object} [options] - Build options (primarily for testing)
 * @param {string} [options.orgsEnv] - Override for ATLANTIS_GITHUB_USER_ORGS
 * @param {string} [options.tableName] - Override for DOC_INDEX_TABLE
 * @param {string} [options.paramStorePath] - Override for PARAM_STORE_PATH
 * @param {function} [options.tokenProvider] - Override for GitHub token retrieval
 * @param {Object} [options.docAiSettings] - Override for the `documentation.ai` settings block (test seam; defaults to {@link loadDocAiSettings}).
 * @param {Object} [options.embeddingProvider] - Injected EmbeddingProvider for the embedding phase (test seam).
 * @param {Object} [options.vectorStore] - Injected VectorStore for the embedding phase (test seam).
 * @param {Map<string, Object>} [options.priorEmbeddings] - Injected prior-embedding map for the embedding phase (test seam).
 * @returns {Promise<{version: string, totalEntries: number, totalRepos: number, duration: number}>}
 * @throws {Error} When the build fails critically (token missing, DynamoDB write error)
 */
async function build(options = {}) {
	const startTime = Date.now();
	const version = generateVersion();

	const orgsEnv = options.orgsEnv || process.env.ATLANTIS_GITHUB_USER_ORGS || '';
	const tableName = options.tableName || process.env.DOC_INDEX_TABLE || '';
	const paramStorePath = options.paramStorePath || process.env.PARAM_STORE_PATH || '';

	const orgs = parseOrgs(orgsEnv);

	console.log(JSON.stringify({
		level: 'INFO',
		event: 'index_build_start',
		version,
		orgs
	}));

	if (orgs.length === 0) {
		throw new Error('No GitHub organizations/users configured in ATLANTIS_GITHUB_USER_ORGS');
	}

	// Retrieve GitHub token
	let token;
	if (options.tokenProvider) {
		token = await options.tokenProvider();
	} else {
		token = await getGitHubToken(paramStorePath);
	}

	if (!token) {
		throw new Error('GitHub token is not configured or is blank');
	}

	const allEntries = [];
	let totalRepos = 0;

	// Process each org/user
	for (const org of orgs) {
		let repos;
		try {
			repos = await listRepositories(org, token);
			console.log(JSON.stringify({
				level: 'INFO',
				event: 'repos_discovered',
				org,
				repoCount: repos.length
			}));
		} catch (err) {
			console.warn(JSON.stringify({
				level: 'WARN',
				event: 'org_failed',
				org,
				error: err.message
			}));
			continue;
		}

		for (const repo of repos) {
			try {
				const entries = await processRepository(repo, token);
				allEntries.push(...entries);
				totalRepos++;

				console.log(JSON.stringify({
					level: 'INFO',
					event: 'repo_indexed',
					org,
					repo: repo.name,
					entryCount: entries.length
				}));
			} catch (err) {
				console.warn(JSON.stringify({
					level: 'WARN',
					event: 'repo_skipped',
					org,
					repo: repo.name,
					error: err.message
				}));
			}
		}
	}

	console.log(JSON.stringify({
		level: 'INFO',
		event: 'entries_indexed',
		version,
		totalEntries: allEntries.length,
		duration: Date.now() - startTime
	}));

	// Deduplicate entries by hash — keep first occurrence to avoid overwriting content
	const seenHashes = new Set();
	const uniqueEntries = [];
	for (const entry of allEntries) {
		if (!seenHashes.has(entry.hash)) {
			seenHashes.add(entry.hash);
			uniqueEntries.push(entry);
		}
	}

	// Write to DynamoDB
	await writeContentEntries(tableName, version, uniqueEntries);

	const keywordEntries = buildKeywordEntries(uniqueEntries);
	await writeSearchKeywords(tableName, version, keywordEntries);

	// Build and write main index
	const now = new Date().toISOString();
	const indexEntries = uniqueEntries.map(entry => ({
		hash: entry.hash,
		path: entry.contentPath,
		type: entry.type,
		subType: entry.subType,
		title: entry.title,
		repository: entry.repository,
		owner: entry.owner,
		keywords: entry.keywords,
		lastIndexed: now
	}));

	await writeMainIndex(tableName, version, indexEntries);

	// Update version pointer (read previous version first)
	let previousVersion = null;
	try {
		const { getDocClient } = require('./dynamo-writer');
		const { GetCommand } = require('@aws-sdk/lib-dynamodb');
		const client = getDocClient();
		const result = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: 'version:pointer', sk: 'active' }
		}));
		if (result.Item) {
			previousVersion = result.Item.version || null;
		}
	} catch (err) {
		// No previous version — first build
	}

	// -- Bedrock-assisted semantic search: index-time embedding phase (spec 0-0-6) --
	// >! Gated behind the feature flag. When disabled the indexer performs NO embedding
	// >! work — no layer require, no EmbeddingProvider/vector-store construction, no
	// >! Bedrock call, no vector upsert, and no embedding version-metadata write — so every
	// >! DynamoDB write (including version:pointer/active below) is byte-for-byte identical
	// >! to the keyword-only behavior. Runs after `previousVersion` is known (for
	// >! incremental reuse) and before the version pointer flips, so the new version's
	// >! vectors exist before it becomes active. Embedding/store failures never fail the
	// >! overall build (see runEmbeddingPhase).
	const docAi = options.docAiSettings || loadDocAiSettings();
	let embeddingSummary = null;
	if (docAi.enabled) {
		embeddingSummary = await runEmbeddingPhase({
			tableName,
			version,
			previousVersion,
			entries: uniqueEntries,
			docAi,
			embeddingProvider: options.embeddingProvider,
			vectorStore: options.vectorStore,
			priorEmbeddings: options.priorEmbeddings
		});
	}

	// >! Record which embedding model/dimensions this version was built with on
	// >! version:pointer/active — but ONLY when the feature is enabled AND vectors were
	// >! actually upserted for this version. The query path (task 6.2) reads
	// >! version:pointer/active to learn the active version AND its embedding model/dims, so
	// >! it embeds queries with the SAME model; gating on "actually upserted" keeps it from
	// >! attempting semantic retrieval against a version with no vectors (it falls back to
	// >! keyword — Req 2.5). Otherwise (disabled, or nothing upserted) the pointer is
	// >! written with its keyword-only shape, byte-for-byte unchanged.
	if (docAi.enabled && embeddingSummary && embeddingSummary.upserted === true) {
		await updateVersionPointer(tableName, version, previousVersion, {
			model: embeddingSummary.model,
			dimensions: embeddingSummary.dimensions
		});
	} else {
		await updateVersionPointer(tableName, version, previousVersion);
	}

	console.log(JSON.stringify({
		level: 'INFO',
		event: 'version_pointer_updated',
		version,
		previousVersion
	}));

	// Set TTL on previous version entries
	if (previousVersion) {
		const ttlTimestamp = Math.floor(Date.now() / 1000) + SEVEN_DAYS_SECONDS;
		await setTtlOnPreviousVersion(tableName, previousVersion, ttlTimestamp);
	}

	const duration = Date.now() - startTime;

	console.log(JSON.stringify({
		level: 'INFO',
		event: 'index_build_success',
		version,
		totalEntries: allEntries.length,
		totalRepos,
		duration
	}));

	return { version, totalEntries: allEntries.length, totalRepos, duration };
}

module.exports = {
	build,
	parseOrgs,
	generateVersion,
	getGitHubToken,
	getExtractor,
	computeRelevanceScore,
	buildKeywordEntries,
	processRepository,
	// Index-time embedding phase (spec 0-0-6, task 5.1) — exported for task 5.3 tests.
	runEmbeddingPhase,
	loadPriorEmbeddings,
	loadLayerModule,
	buildEmbeddingInput,
	computeEmbeddingInputHash,
	shouldReuseEmbedding,
	TYPE_WEIGHTS,
	SCORE_WEIGHTS
};
