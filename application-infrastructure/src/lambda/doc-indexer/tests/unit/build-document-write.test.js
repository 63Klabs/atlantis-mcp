'use strict';

/**
 * Unit test for the build() -> writeDocumentEntries wiring (spec 0-0-6, task 1.5).
 *
 * Drives one repository with a single file through the mocked pipeline and asserts that
 * build() writes the per-file `document:{fileHash}` item alongside the section metadata,
 * carrying the retained raw file body (Requirements 2.1, 2.2, 6.3).
 *
 * All heavy collaborators (DynamoDB writer, GitHub client, archive processor, markdown
 * extractor, file filter) are mocked, so no AWS or network I/O occurs.
 */

jest.mock('../../lib/dynamo-writer', () => {
	const send = jest.fn().mockResolvedValue({});
	return {
		writeContentEntries: jest.fn().mockResolvedValue(undefined),
		writeDocumentEntries: jest.fn().mockResolvedValue(undefined),
		writeSearchKeywords: jest.fn().mockResolvedValue(undefined),
		writeMainIndex: jest.fn().mockResolvedValue(undefined),
		updateVersionPointer: jest.fn().mockResolvedValue(undefined),
		setTtlOnPreviousVersion: jest.fn().mockResolvedValue(undefined),
		getDocClient: jest.fn(() => ({ send })),
		computeTtl: jest.fn(() => 1000000),
		SEVEN_DAYS_SECONDS: 604800
	};
});

jest.mock('../../lib/github-client', () => {
	const actual = jest.requireActual('../../lib/github-client');
	return {
		...actual,
		listRepositories: jest.fn().mockResolvedValue([]),
		getLatestRelease: jest.fn().mockResolvedValue(null),
		downloadArchive: jest.fn().mockResolvedValue(Buffer.from('zip')),
		getRepositoryProperties: jest.fn().mockResolvedValue({ repositoryType: 'package', namespace: 'docs' })
	};
});

jest.mock('../../lib/archive-processor', () => ({
	extractArchive: jest.fn(() => [])
}));

jest.mock('../../lib/file-filter', () => ({
	isIndexable: jest.fn(() => true)
}));

jest.mock('../../lib/extractors/markdown', () => ({
	extract: jest.fn(() => [])
}));

const dynamoWriter = require('../../lib/dynamo-writer');
const githubClient = require('../../lib/github-client');
const archiveProcessor = require('../../lib/archive-processor');
const markdownExtractor = require('../../lib/extractors/markdown');
const { hashContentPath } = require('../../lib/hasher');
const { build } = require('../../lib/index-builder');

const FILE_BODY = '# Title\n\nIntro prose.\n\n## Usage\n\nUsage prose.\n';

describe('build writes per-file document items', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it('calls writeDocumentEntries with the entries carrying the retained file body', async () => {
		githubClient.listRepositories.mockResolvedValueOnce([
			{ name: 'repo', defaultBranch: 'main', owner: 'org' }
		]);
		archiveProcessor.extractArchive.mockReturnValueOnce([
			{ path: 'README.md', content: FILE_BODY }
		]);
		// Two sections from the same file must collapse to one document item downstream.
		markdownExtractor.extract.mockReturnValueOnce([
			{
				contentPath: 'org/repo/README.md/title',
				title: 'Title',
				excerpt: 'Intro prose.',
				content: 'Intro prose.',
				type: 'documentation',
				subType: 'guide',
				keywords: ['title']
			},
			{
				contentPath: 'org/repo/README.md/usage',
				title: 'Usage',
				excerpt: 'Usage prose.',
				content: 'Usage prose.',
				type: 'documentation',
				subType: 'guide',
				keywords: ['usage']
			}
		]);

		await build({
			orgsEnv: 'org',
			tableName: 't',
			tokenProvider: async () => 'tok',
			docAiSettings: { enabled: false }
		});

		expect(dynamoWriter.writeDocumentEntries).toHaveBeenCalledTimes(1);

		const [tableName, version, entries] = dynamoWriter.writeDocumentEntries.mock.calls[0];
		expect(tableName).toBe('t');
		expect(typeof version).toBe('string');
		expect(entries).toHaveLength(2);

		const expectedDocumentHash = hashContentPath('org/repo/README.md');
		for (const entry of entries) {
			expect(entry.documentPath).toBe('org/repo/README.md');
			expect(entry.documentHash).toBe(expectedDocumentHash);
			expect(entry.fileContent).toBe(FILE_BODY);
			expect(entry.repositoryType).toBe('package');
			expect(entry.namespace).toBe('docs');
		}

		// The same entry set feeds both writers, so section metadata is unaffected.
		expect(dynamoWriter.writeContentEntries).toHaveBeenCalledTimes(1);
		expect(dynamoWriter.writeContentEntries.mock.calls[0][2]).toBe(entries);
	});
});
