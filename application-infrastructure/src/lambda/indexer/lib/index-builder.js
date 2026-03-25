'use strict';

const http = require('http');
const { hashContentPath } = require('./hasher');
const { isIndexable } = require('./file-filter');
const { extractArchive } = require('./archive-processor');
const { listRepositories, getLatestRelease, downloadArchive } = require('./github-client');
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
	keywordMatch: 3,
	exactPhrase: 20
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

		for (const keyword of entry.keywords) {
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
 * @param {Object} repo - Repository info with name, defaultBranch, owner
 * @param {string} token - GitHub PAT
 * @returns {Promise<Array<Object>>} Extracted content entries with hash
 */
async function processRepository(repo, token) {
	const release = await getLatestRelease(repo.owner, repo.name, token);

	let archiveUrl;
	if (release) {
		archiveUrl = release.zipUrl;
	} else {
		archiveUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/zipball/${repo.defaultBranch}`;
	}

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

			for (const entry of extracted) {
				entries.push({
					...entry,
					hash: hashContentPath(entry.contentPath),
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
 * @param {Object} [options] - Build options (primarily for testing)
 * @param {string} [options.orgsEnv] - Override for ATLANTIS_GITHUB_USER_ORGS
 * @param {string} [options.tableName] - Override for DOC_INDEX_TABLE
 * @param {string} [options.paramStorePath] - Override for PARAM_STORE_PATH
 * @param {function} [options.tokenProvider] - Override for GitHub token retrieval
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

	// Write to DynamoDB
	await writeContentEntries(tableName, version, allEntries);

	const keywordEntries = buildKeywordEntries(allEntries);
	await writeSearchKeywords(tableName, version, keywordEntries);

	// Build and write main index
	const now = new Date().toISOString();
	const indexEntries = allEntries.map(entry => ({
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

	await updateVersionPointer(tableName, version, previousVersion);

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
	TYPE_WEIGHTS,
	SCORE_WEIGHTS
};
