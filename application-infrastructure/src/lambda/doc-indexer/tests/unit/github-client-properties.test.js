'use strict';

/**
 * Unit tests for the github-client additions (spec 0-0-6, tasks 1.3 and 1.4):
 *   - buildGithubUrl: file-level blob URL construction and null fallback (Requirement 4).
 *   - getRepositoryProperties: atlantis_repository-type -> repositoryType and
 *     atlantis_namespace -> namespace mapping, absent-property null, and fetch-failure
 *     tolerance (Requirement 5).
 *
 * The HTTPS layer is mocked so getRepositoryProperties is exercised end-to-end through
 * githubRequest without any real network call. The GitHub token is never asserted in a
 * log line (best-effort logging must never leak it).
 */

jest.mock('https');
const https = require('https');
const { EventEmitter } = require('events');

const {
	buildGithubUrl,
	getRepositoryProperties,
	normalizePropertyValue,
	clearCache,
	resetRateLimitState
} = require('../../lib/github-client');

/**
 * Program the mocked https.request to answer the next request with a fixed response.
 *
 * @param {{statusCode: number, body?: string, headers?: Object}} response - Response to emit
 */
function mockHttpsResponse({ statusCode, body = '', headers = {} }) {
	https.request.mockImplementation((options, callback) => {
		const req = new EventEmitter();
		req.end = () => {
			const res = new EventEmitter();
			res.statusCode = statusCode;
			res.headers = headers;
			process.nextTick(() => {
				callback(res);
				if (body) {
					res.emit('data', Buffer.from(body));
				}
				res.emit('end');
			});
		};
		return req;
	});
}

describe('buildGithubUrl', () => {
	it('builds a file-level blob URL from all components', () => {
		const url = buildGithubUrl({ owner: '63klabs', repo: 'cache-data', ref: 'v1.3.6', filePath: 'README.md' });
		expect(url).toBe('https://github.com/63klabs/cache-data/blob/v1.3.6/README.md');
	});

	it('uses a default-branch ref the same way as a release tag', () => {
		const url = buildGithubUrl({ owner: '63klabs', repo: 'cache-data', ref: 'main', filePath: 'docs/setup.md' });
		expect(url).toBe('https://github.com/63klabs/cache-data/blob/main/docs/setup.md');
	});

	it('returns null when the ref is missing', () => {
		expect(buildGithubUrl({ owner: 'o', repo: 'r', ref: '', filePath: 'f.md' })).toBeNull();
		expect(buildGithubUrl({ owner: 'o', repo: 'r', filePath: 'f.md' })).toBeNull();
	});

	it('returns null when the filePath is missing', () => {
		expect(buildGithubUrl({ owner: 'o', repo: 'r', ref: 'main' })).toBeNull();
	});

	it('returns null when owner or repo is missing', () => {
		expect(buildGithubUrl({ repo: 'r', ref: 'main', filePath: 'f.md' })).toBeNull();
		expect(buildGithubUrl({ owner: 'o', ref: 'main', filePath: 'f.md' })).toBeNull();
	});

	it('returns null for no arguments', () => {
		expect(buildGithubUrl()).toBeNull();
	});
});

describe('normalizePropertyValue', () => {
	it('returns a trimmed string value', () => {
		expect(normalizePropertyValue('  package  ')).toBe('package');
	});

	it('returns the first element of a multi-select array value', () => {
		expect(normalizePropertyValue(['templates', 'other'])).toBe('templates');
	});

	it('returns null for empty, null, or empty-array values', () => {
		expect(normalizePropertyValue('')).toBeNull();
		expect(normalizePropertyValue('   ')).toBeNull();
		expect(normalizePropertyValue(null)).toBeNull();
		expect(normalizePropertyValue([])).toBeNull();
	});
});

describe('getRepositoryProperties', () => {
	let warnSpy;

	beforeEach(() => {
		clearCache();
		resetRateLimitState();
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('maps atlantis_repository-type to repositoryType and atlantis_namespace to namespace', async () => {
		mockHttpsResponse({
			statusCode: 200,
			body: JSON.stringify([
				{ property_name: 'atlantis_repository-type', value: 'package' },
				{ property_name: 'atlantis_namespace', value: 'core' }
			])
		});

		const props = await getRepositoryProperties('63klabs', 'cache-data', 'secret-token');
		expect(props).toEqual({ repositoryType: 'package', namespace: 'core' });
	});

	it('maps a multi-select repository-type to its first value', async () => {
		mockHttpsResponse({
			statusCode: 200,
			body: JSON.stringify([
				{ property_name: 'atlantis_repository-type', value: ['templates', 'legacy'] }
			])
		});

		const props = await getRepositoryProperties('63klabs', 'atlantis-templates', 'secret-token');
		expect(props.repositoryType).toBe('templates');
		expect(props.namespace).toBeNull();
	});

	it('returns null fields when the properties are absent', async () => {
		mockHttpsResponse({
			statusCode: 200,
			body: JSON.stringify([{ property_name: 'some_other_property', value: 'x' }])
		});

		const props = await getRepositoryProperties('63klabs', 'no-props', 'secret-token');
		expect(props).toEqual({ repositoryType: null, namespace: null });
	});

	it('returns null fields when the repository has no custom properties (404)', async () => {
		mockHttpsResponse({ statusCode: 404 });

		const props = await getRepositoryProperties('63klabs', 'missing', 'secret-token');
		expect(props).toEqual({ repositoryType: null, namespace: null });
	});

	it('tolerates a fetch failure and returns null fields without throwing', async () => {
		mockHttpsResponse({ statusCode: 500, body: 'server error' });

		const props = await getRepositoryProperties('63klabs', 'boom', 'secret-token');
		expect(props).toEqual({ repositoryType: null, namespace: null });
	});

	it('never logs the GitHub token on failure', async () => {
		mockHttpsResponse({ statusCode: 500, body: 'server error' });

		await getRepositoryProperties('63klabs', 'boom', 'super-secret-token');

		for (const call of warnSpy.mock.calls) {
			const logged = JSON.stringify(call);
			expect(logged).not.toContain('super-secret-token');
		}
	});

	it('honors overridden property names', async () => {
		mockHttpsResponse({
			statusCode: 200,
			body: JSON.stringify([
				{ property_name: 'custom-type', value: 'mcp' },
				{ property_name: 'custom-ns', value: 'tools' }
			])
		});

		const props = await getRepositoryProperties('63klabs', 'custom', 'secret-token', {
			repositoryTypeProperty: 'custom-type',
			namespaceProperty: 'custom-ns'
		});
		expect(props).toEqual({ repositoryType: 'mcp', namespace: 'tools' });
	});
});
