'use strict';

/**
 * Unit tests for index-builder.processRepository (spec 0-0-6, tasks 1.1, 1.3, 1.4).
 *
 * Verifies the per-entry file-level metadata wiring:
 *   - documentPath = {org}/{repo}/{filePath} and documentHash = hash(documentPath) (1.1)
 *   - fileContent retains the full raw source file body (1.1)
 *   - ref = release tag when a release archive was used, else the default branch, and the
 *     resulting file-level githubUrl (1.3)
 *   - repositoryType / namespace threaded from getRepositoryProperties, null when absent (1.4)
 *
 * The network/archive collaborators are mocked; buildGithubUrl and hashContentPath run for
 * real so the produced URL and hashes are asserted against the real implementations.
 */

// Keep the real buildGithubUrl (and other pure helpers); mock only the network functions.
jest.mock('../../lib/github-client', () => {
	const actual = jest.requireActual('../../lib/github-client');
	return {
		...actual,
		getLatestRelease: jest.fn(),
		downloadArchive: jest.fn(),
		getRepositoryProperties: jest.fn()
	};
});

jest.mock('../../lib/archive-processor', () => ({
	extractArchive: jest.fn()
}));

jest.mock('../../lib/file-filter', () => ({
	isIndexable: jest.fn(() => true)
}));

jest.mock('../../lib/extractors/markdown', () => ({
	extract: jest.fn()
}));

const githubClient = require('../../lib/github-client');
const archiveProcessor = require('../../lib/archive-processor');
const markdownExtractor = require('../../lib/extractors/markdown');
const { hashContentPath } = require('../../lib/hasher');
const { processRepository } = require('../../lib/index-builder');

const REPO = { name: 'cache-data', owner: '63klabs', defaultBranch: 'main' };
const FILE = { path: 'README.md', content: '# Title\nSome body text here.' };
const SECTION = {
	contentPath: '63klabs/cache-data/README.md/title',
	title: 'Title',
	excerpt: 'Some body text here.',
	content: 'Some body text here.',
	type: 'documentation',
	subType: 'guide',
	keywords: ['title']
};

function primePipeline({ release, properties }) {
	githubClient.getLatestRelease.mockResolvedValue(release);
	githubClient.downloadArchive.mockResolvedValue(Buffer.from('zip'));
	githubClient.getRepositoryProperties.mockResolvedValue(properties);
	archiveProcessor.extractArchive.mockReturnValue([FILE]);
	markdownExtractor.extract.mockReturnValue([SECTION]);
}

describe('processRepository file-level metadata', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it('sets ref to the release tag and builds the release githubUrl', async () => {
		primePipeline({
			release: { tagName: 'v2.0.0', zipUrl: 'https://example/zip' },
			properties: { repositoryType: 'documentation', namespace: 'docs' }
		});

		const entries = await processRepository(REPO, 'token');
		expect(entries).toHaveLength(1);
		const entry = entries[0];

		expect(entry.ref).toBe('v2.0.0');
		expect(entry.githubUrl).toBe('https://github.com/63klabs/cache-data/blob/v2.0.0/README.md');
	});

	it('falls back to the default branch ref and URL when there is no release', async () => {
		primePipeline({
			release: null,
			properties: { repositoryType: 'documentation', namespace: null }
		});

		const entries = await processRepository(REPO, 'token');
		const entry = entries[0];

		expect(entry.ref).toBe('main');
		expect(entry.githubUrl).toBe('https://github.com/63klabs/cache-data/blob/main/README.md');
	});

	it('computes documentPath and documentHash and retains the raw file body', async () => {
		primePipeline({
			release: null,
			properties: { repositoryType: null, namespace: null }
		});

		const entries = await processRepository(REPO, 'token');
		const entry = entries[0];

		expect(entry.documentPath).toBe('63klabs/cache-data/README.md');
		expect(entry.documentHash).toBe(hashContentPath('63klabs/cache-data/README.md'));
		expect(entry.hash).toBe(hashContentPath('63klabs/cache-data/README.md/title'));
		expect(entry.fileContent).toBe('# Title\nSome body text here.');
	});

	it('threads repositoryType and namespace onto entries', async () => {
		primePipeline({
			release: null,
			properties: { repositoryType: 'package', namespace: 'core' }
		});

		const entries = await processRepository(REPO, 'token');
		const entry = entries[0];

		expect(entry.repositoryType).toBe('package');
		expect(entry.namespace).toBe('core');
	});

	it('stores null repositoryType/namespace when properties are absent', async () => {
		primePipeline({
			release: null,
			properties: { repositoryType: null, namespace: null }
		});

		const entries = await processRepository(REPO, 'token');
		const entry = entries[0];

		expect(entry.repositoryType).toBeNull();
		expect(entry.namespace).toBeNull();
	});

	it('preserves the original extractor fields (repository, owner, type)', async () => {
		primePipeline({
			release: null,
			properties: { repositoryType: null, namespace: null }
		});

		const entries = await processRepository(REPO, 'token');
		const entry = entries[0];

		expect(entry.repository).toBe('cache-data');
		expect(entry.owner).toBe('63klabs');
		expect(entry.type).toBe('documentation');
		expect(entry.title).toBe('Title');
	});
});
