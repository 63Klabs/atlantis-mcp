'use strict';

const https = require('https');

/**
 * Maximum number of retries on HTTP 403 rate-limit responses.
 * @type {number}
 */
const MAX_RETRIES = 3;

/**
 * Base delay in milliseconds for exponential backoff (1 second).
 * @type {number}
 */
const BASE_BACKOFF_MS = 1000;

/**
 * GitHub API base hostname.
 * @type {string}
 */
const GITHUB_API_HOST = 'api.github.com';

/**
 * In-memory cache for GitHub API responses within a single build run.
 * Keyed by request URL.
 * @type {Map<string, *>}
 */
const requestCache = new Map();

/**
 * Tracks the most recent rate-limit headers from GitHub API responses.
 * @type {{remaining: number|null, reset: number|null}}
 */
const rateLimitState = {
	remaining: null,
	reset: null
};

/**
 * Sleep utility that returns a promise resolving after the given milliseconds.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clear the in-memory request cache. Intended for use between build runs
 * or in tests.
 */
function clearCache() {
	requestCache.clear();
}

/**
 * Reset the tracked rate-limit state. Useful in tests.
 */
function resetRateLimitState() {
	rateLimitState.remaining = null;
	rateLimitState.reset = null;
}

/**
 * Return the current rate-limit state (read-only copy).
 *
 * @returns {{remaining: number|null, reset: number|null}}
 */
function getRateLimitState() {
	return { ...rateLimitState };
}

/**
 * Update rate-limit tracking from response headers.
 *
 * @param {Object} headers - HTTP response headers (lowercased keys)
 */
function updateRateLimitFromHeaders(headers) {
	if (headers['x-ratelimit-remaining'] !== undefined) {
		rateLimitState.remaining = parseInt(headers['x-ratelimit-remaining'], 10);
	}
	if (headers['x-ratelimit-reset'] !== undefined) {
		rateLimitState.reset = parseInt(headers['x-ratelimit-reset'], 10);
	}
}

/**
 * Wait until the rate-limit reset time if remaining requests are zero.
 * Uses the tracked reset timestamp from the most recent API response.
 *
 * @returns {Promise<void>}
 */
async function waitForRateLimitReset() {
	if (rateLimitState.remaining !== null && rateLimitState.remaining <= 0 && rateLimitState.reset !== null) {
		const nowSeconds = Math.floor(Date.now() / 1000);
		const waitSeconds = rateLimitState.reset - nowSeconds;
		if (waitSeconds > 0) {
			await sleep(waitSeconds * 1000);
		}
	}
}

/**
 * Perform an HTTPS GET request to the GitHub API with rate-limit handling,
 * exponential backoff on 403, and in-memory caching.
 *
 * @param {string} path - API path (e.g., "/orgs/63klabs/repos")
 * @param {string} token - GitHub Personal Access Token
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.skipCache=false] - Bypass the in-memory cache
 * @param {boolean} [options.rawBuffer=false] - Return raw Buffer instead of parsed JSON
 * @returns {Promise<*>} Parsed JSON response or Buffer
 * @throws {Error} When request fails after retries or on non-retryable errors
 */
async function githubRequest(path, token, options = {}) {
	const { skipCache = false, rawBuffer = false } = options;
	const cacheKey = path;

	if (!skipCache && requestCache.has(cacheKey)) {
		return requestCache.get(cacheKey);
	}

	await waitForRateLimitReset();

	let lastError = null;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
			await sleep(delay);
		}

		try {
			const result = await makeHttpsRequest(path, token, rawBuffer);
			updateRateLimitFromHeaders(result.headers);

			if (result.statusCode === 200) {
				const data = rawBuffer ? result.body : JSON.parse(result.body);
				if (!skipCache) {
					requestCache.set(cacheKey, data);
				}
				return data;
			}

			if (result.statusCode === 404) {
				return null;
			}

			if (result.statusCode === 403) {
				lastError = new Error(`GitHub API rate limit exceeded (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
				updateRateLimitFromHeaders(result.headers);
				if (attempt < MAX_RETRIES) {
					continue;
				}
				throw lastError;
			}

			throw new Error(`GitHub API error: ${result.statusCode} ${result.body.toString().substring(0, 200)}`);
		} catch (err) {
			if (err === lastError && attempt >= MAX_RETRIES) {
				throw err;
			}
			if (err !== lastError) {
				throw err;
			}
		}
	}

	throw lastError || new Error('GitHub API request failed after retries');
}

/**
 * Low-level HTTPS GET request to GitHub API.
 *
 * @param {string} urlPath - API path or full URL
 * @param {string} token - GitHub PAT
 * @param {boolean} [rawBuffer=false] - Return body as Buffer
 * @returns {Promise<{statusCode: number, headers: Object, body: string|Buffer}>}
 */
function makeHttpsRequest(urlPath, token, rawBuffer = false) {
	return new Promise((resolve, reject) => {
		const isFullUrl = urlPath.startsWith('https://');
		let requestOptions;

		if (isFullUrl) {
			const url = new URL(urlPath);
			requestOptions = {
				hostname: url.hostname,
				path: url.pathname + url.search,
				method: 'GET',
				headers: {
					'User-Agent': 'atlantis-doc-indexer',
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28'
				}
			};
		} else {
			requestOptions = {
				hostname: GITHUB_API_HOST,
				path: urlPath,
				method: 'GET',
				headers: {
					'User-Agent': 'atlantis-doc-indexer',
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28'
				}
			};
		}

		const req = https.request(requestOptions, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const buffer = Buffer.concat(chunks);
				resolve({
					statusCode: res.statusCode,
					headers: res.headers,
					body: rawBuffer ? buffer : buffer.toString('utf8')
				});
			});
		});

		req.on('error', reject);
		req.end();
	});
}

/**
 * List all repositories for a GitHub organization or user.
 *
 * @param {string} org - GitHub organization or username
 * @param {string} token - GitHub Personal Access Token
 * @returns {Promise<Array<{name: string, defaultBranch: string, owner: string}>>} Array of repository info
 * @throws {Error} When the API request fails
 * @example
 * const repos = await listRepositories('63klabs', token);
 * // [{ name: 'cache-data', defaultBranch: 'main', owner: '63klabs' }, ...]
 */
async function listRepositories(org, token) {
	const data = await githubRequest(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=public`, token);

	if (!data) {
		// Try as user if org endpoint returns 404
		const userData = await githubRequest(`/users/${encodeURIComponent(org)}/repos?per_page=100&type=public`, token);
		if (!userData) {
			return [];
		}
		return userData.map((repo) => ({
			name: repo.name,
			defaultBranch: repo.default_branch || 'main',
			owner: org
		}));
	}

	return data.map((repo) => ({
		name: repo.name,
		defaultBranch: repo.default_branch || 'main',
		owner: org
	}));
}

/**
 * Check for the latest published (non-draft, non-prerelease) release of a repository.
 *
 * @param {string} owner - Repository owner (org or user)
 * @param {string} repo - Repository name
 * @param {string} token - GitHub Personal Access Token
 * @returns {Promise<{tagName: string, zipUrl: string}|null>} Release info or null if none
 * @example
 * const release = await getLatestRelease('63klabs', 'cache-data', token);
 * // { tagName: 'v1.3.6', zipUrl: 'https://api.github.com/repos/...' } or null
 */
async function getLatestRelease(owner, repo, token) {
	const data = await githubRequest(
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`,
		token
	);

	if (!data || data.draft || data.prerelease) {
		return null;
	}

	return {
		tagName: data.tag_name,
		zipUrl: data.zipball_url
	};
}

/**
 * Download a zip archive from a URL as a Buffer.
 *
 * @param {string} url - Zip archive URL (GitHub zipball endpoint)
 * @param {string} token - GitHub Personal Access Token
 * @returns {Promise<Buffer>} Zip archive contents
 * @throws {Error} When download fails
 * @example
 * const buffer = await downloadArchive('https://api.github.com/repos/63klabs/cache-data/zipball/v1.3.6', token);
 */
async function downloadArchive(url, token) {
	return downloadWithRedirects(url, token, 5);
}

/**
 * Follow redirects when downloading an archive (GitHub returns 302 for zipball URLs).
 *
 * @param {string} url - URL to download
 * @param {string} token - GitHub PAT
 * @param {number} maxRedirects - Maximum redirects to follow
 * @returns {Promise<Buffer>} Downloaded content
 * @throws {Error} When download fails or too many redirects
 */
async function downloadWithRedirects(url, token, maxRedirects) {
	if (maxRedirects <= 0) {
		throw new Error('Too many redirects while downloading archive');
	}

	const result = await makeHttpsRequest(url, token, true);
	updateRateLimitFromHeaders(result.headers);

	if (result.statusCode === 302 || result.statusCode === 301) {
		const location = result.headers.location;
		if (!location) {
			throw new Error('Redirect without Location header');
		}
		return downloadWithRedirects(location, token, maxRedirects - 1);
	}

	if (result.statusCode === 200) {
		return result.body;
	}

	throw new Error(`Archive download failed: ${result.statusCode}`);
}

module.exports = {
	listRepositories,
	getLatestRelease,
	downloadArchive,
	clearCache,
	resetRateLimitState,
	getRateLimitState,
	// Exposed for testing
	githubRequest,
	updateRateLimitFromHeaders,
	waitForRateLimitReset,
	sleep,
	makeHttpsRequest,
	MAX_RETRIES,
	BASE_BACKOFF_MS
};
