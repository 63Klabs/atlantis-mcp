/**
 * Property-Based Tests for Controller conn.parameters, conn.host, and MCP output
 *
 * Feature: template-chunk-internal-cache
 *
 * Property 3: Controller sets conn.parameters and conn.host correctly
 * For any valid input containing templateName, category, chunkIndex, and
 * optional version, versionId, s3Buckets, and namespace, the controller
 * should set conn.parameters to include all of these fields and set
 * conn.host to the provided s3Buckets array (or the default buckets from
 * settings when s3Buckets is not provided).
 * Validates: Requirements 3.1, 3.2
 *
 * Property 4: Controller output preserves chunk data in MCP format
 * For any cached chunk body containing chunkIndex, totalChunks, templateName,
 * category, and content, the controller should return an MCP success response
 * where data matches the cached body values exactly.
 * Validates: Requirements 4.2
 */

const fc = require('fast-check');

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = '/test/';

// Track the conn object passed to CacheableDataAccess.getData
let capturedConn = null;
let capturedCacheProfile = null;

// Mock CacheableDataAccess.getData to capture conn and return a stub result
const mockGetData = jest.fn(async (cacheProfile, fetchFn, conn, opts) => {
	capturedConn = JSON.parse(JSON.stringify(conn)); // deep copy to capture state
	capturedCacheProfile = cacheProfile;
	return {
		getBody: () => ({
			chunkIndex: conn.parameters.chunkIndex,
			totalChunks: 1,
			templateName: conn.parameters.templateName,
			category: conn.parameters.category,
			content: 'stub-content'
		})
	};
});

// Default buckets returned by Config.settings()
const DEFAULT_BUCKETS = ['default-bucket-1', 'default-bucket-2'];

jest.mock('@63klabs/cache-data', () => ({
	cache: {
		CacheableDataAccess: {
			getData: (...args) => mockGetData(...args)
		}
	},
	tools: {
		DebugAndLog: {
			isProduction: jest.fn().mockReturnValue(false),
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		ApiRequest: {
			success: ({ body }) => ({
				statusCode: 200,
				body,
				getBody: () => body
			}),
			error: ({ body }) => ({
				statusCode: 400,
				body,
				getBody: () => body
			})
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('mock-value')
		}))
	}
}));

// Mock SchemaValidator to always pass
jest.mock('../../utils/schema-validator', () => ({
	validate: jest.fn().mockReturnValue({ valid: true })
}));

// Mock MCPProtocol
jest.mock('../../utils/mcp-protocol', () => ({
	successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
	errorResponse: jest.fn((code, data, tool) => ({ success: false, code, data, tool }))
}));

// Mock Config to return a mutable conn object and track settings calls
const mockConnObj = {
	name: 'template-chunks',
	host: 'internal',
	path: '/chunks',
	parameters: {}
};

jest.mock('../../config', () => ({
	Config: {
		getConnCacheProfile: jest.fn().mockImplementation(() => ({
			conn: { ...mockConnObj, parameters: {} },
			cacheProfile: {
				profile: 'chunk-data',
				hostId: 'template-chunks',
				pathId: 'data'
			}
		})),
		settings: jest.fn().mockReturnValue({
			s3: { buckets: DEFAULT_BUCKETS }
		})
	}
}));

// Mock Services (not exercised since CacheableDataAccess.getData is mocked)
jest.mock('../../services', () => ({
	Templates: {
		get: jest.fn(),
		list: jest.fn(),
		listVersions: jest.fn(),
		listCategories: jest.fn()
	}
}));

// Mock ContentChunker (not exercised since CacheableDataAccess.getData is mocked)
jest.mock('../../utils/content-chunker', () => ({
	chunk: jest.fn().mockReturnValue(['chunk0'])
}));

const Templates = require('../../controllers/templates');

/**
 * Arbitrary generator for non-empty alphanumeric strings.
 *
 * @param {number} [minLen=1] - Minimum length
 * @param {number} [maxLen=30] - Maximum length
 * @returns {fc.Arbitrary<string>} A fast-check arbitrary producing strings
 */
function alphaStringArb(minLen = 1, maxLen = 30) {
	return fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: minLen, maxLength: maxLen });
}

/**
 * Arbitrary generator for S3 bucket name arrays.
 *
 * @returns {fc.Arbitrary<Array<string>>} A fast-check arbitrary producing bucket arrays
 */
function s3BucketsArb() {
	return fc.array(
		fc.stringMatching(/^[a-z0-9][a-z0-9.-]{1,20}$/, { minLength: 3, maxLength: 22 }),
		{ minLength: 1, maxLength: 3 }
	);
}

describe('Feature: template-chunk-internal-cache, Property 3: Controller sets conn.parameters and conn.host correctly', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		capturedConn = null;
		capturedCacheProfile = null;
	});

	/**
	 * **Validates: Requirements 3.1, 3.2**
	 *
	 * For any valid input with s3Buckets provided, the controller should:
	 * - Set conn.parameters to include all fields (templateName, category,
	 *   chunkIndex, version, versionId, s3Buckets, namespace)
	 * - Set conn.host to the provided s3Buckets array
	 */
	test('conn.parameters contains all fields and conn.host uses provided s3Buckets', async () => {
		await fc.assert(
			fc.asyncProperty(
				alphaStringArb(),                          // templateName
				alphaStringArb(),                          // category
				fc.nat({ max: 100 }),                      // chunkIndex
				fc.option(alphaStringArb(), { nil: undefined }), // version (optional)
				fc.option(alphaStringArb(), { nil: undefined }), // versionId (optional)
				s3BucketsArb(),                            // s3Buckets (provided)
				fc.option(alphaStringArb(), { nil: undefined }), // namespace (optional)
				async (templateName, category, chunkIndex, version, versionId, s3Buckets, namespace) => {
					const input = { templateName, category, chunkIndex };
					if (version !== undefined) input.version = version;
					if (versionId !== undefined) input.versionId = versionId;
					input.s3Buckets = s3Buckets;
					if (namespace !== undefined) input.namespace = namespace;

					await Templates.getChunk({
						bodyParameters: { input }
					});

					// Verify CacheableDataAccess.getData was called
					expect(mockGetData).toHaveBeenCalled();

					// Verify conn.parameters contains all expected fields
					expect(capturedConn.parameters).toBeDefined();
					expect(capturedConn.parameters.templateName).toBe(templateName);
					expect(capturedConn.parameters.category).toBe(category);
					expect(capturedConn.parameters.chunkIndex).toBe(chunkIndex);
					expect(capturedConn.parameters.version).toBe(version);
					expect(capturedConn.parameters.versionId).toBe(versionId);
					expect(capturedConn.parameters.s3Buckets).toEqual(s3Buckets);
					expect(capturedConn.parameters.namespace).toBe(namespace);

					// Verify conn.host is set to the provided s3Buckets
					expect(capturedConn.host).toEqual(s3Buckets);
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * **Validates: Requirements 3.1, 3.2**
	 *
	 * When s3Buckets is not provided (undefined) or is an empty array,
	 * the controller should set conn.host to the default buckets from
	 * Config.settings().s3.buckets.
	 */
	test('conn.host falls back to default buckets when s3Buckets is not provided', async () => {
		await fc.assert(
			fc.asyncProperty(
				alphaStringArb(),                          // templateName
				alphaStringArb(),                          // category
				fc.nat({ max: 100 }),                      // chunkIndex
				fc.option(alphaStringArb(), { nil: undefined }), // version
				fc.option(alphaStringArb(), { nil: undefined }), // versionId
				fc.constantFrom(undefined, []),             // s3Buckets absent or empty
				fc.option(alphaStringArb(), { nil: undefined }), // namespace
				async (templateName, category, chunkIndex, version, versionId, s3Buckets, namespace) => {
					const input = { templateName, category, chunkIndex };
					if (version !== undefined) input.version = version;
					if (versionId !== undefined) input.versionId = versionId;
					if (s3Buckets !== undefined) input.s3Buckets = s3Buckets;
					if (namespace !== undefined) input.namespace = namespace;

					await Templates.getChunk({
						bodyParameters: { input }
					});

					expect(mockGetData).toHaveBeenCalled();

					// Verify conn.parameters still contains all fields
					expect(capturedConn.parameters).toBeDefined();
					expect(capturedConn.parameters.templateName).toBe(templateName);
					expect(capturedConn.parameters.category).toBe(category);
					expect(capturedConn.parameters.chunkIndex).toBe(chunkIndex);

					// Verify conn.host falls back to default buckets
					expect(capturedConn.host).toEqual(DEFAULT_BUCKETS);
				}
			),
			{ numRuns: 100 }
		);
	});
});


describe('Feature: template-chunk-internal-cache, Property 4: Controller output preserves chunk data in MCP format', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		capturedConn = null;
		capturedCacheProfile = null;
	});

	/**
	 * **Validates: Requirements 4.2**
	 *
	 * For any cached chunk body containing chunkIndex, totalChunks,
	 * templateName, category, and content, the controller should return
	 * an MCP success response where data matches the cached body exactly.
	 */
	test('MCP success response data matches the cached chunk body', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.nat({ max: 100 }),                      // chunkIndex
				fc.integer({ min: 1, max: 200 }),          // totalChunks
				alphaStringArb(),                          // templateName
				alphaStringArb(),                          // category
				fc.string({ minLength: 1, maxLength: 500 }), // content
				async (chunkIndex, totalChunks, templateName, category, content) => {
					const generatedBody = {
						chunkIndex,
						totalChunks,
						templateName,
						category,
						content
					};

					// Override mockGetData to return a cacheObj with the generated body
					mockGetData.mockResolvedValueOnce({
						getBody: () => generatedBody
					});

					const response = await Templates.getChunk({
						bodyParameters: {
							input: {
								templateName,
								category,
								chunkIndex
							}
						}
					});

					// Verify MCP success response
					expect(response.success).toBe(true);
					expect(response.tool).toBe('get_template_chunk');

					// Verify data preserves all chunk body fields exactly
					expect(response.data.chunkIndex).toBe(chunkIndex);
					expect(response.data.totalChunks).toBe(totalChunks);
					expect(response.data.templateName).toBe(templateName);
					expect(response.data.category).toBe(category);
					expect(response.data.content).toBe(content);

					// Verify the entire data object matches
					expect(response.data).toEqual(generatedBody);
				}
			),
			{ numRuns: 100 }
		);
	});
});
