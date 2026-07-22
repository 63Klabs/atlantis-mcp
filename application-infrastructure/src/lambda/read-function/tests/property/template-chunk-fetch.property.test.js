/**
 * Property-Based Tests for Fetch Function Correctness
 *
 * Feature: template-chunk-internal-cache
 *
 * Property 1: Fetch function produces correct chunk content
 * For any valid template object and for any valid chunkIndex
 * (0 ≤ chunkIndex < totalChunks), the fetch function should return an
 * ApiRequest.success() response whose body contains `content` equal to
 * ContentChunker.chunk(JSON.stringify(template))[chunkIndex], `totalChunks`
 * equal to the length of the chunks array, and `chunkIndex` equal to the
 * requested index.
 * Validates: Requirements 2.1, 2.2
 *
 * Property 2: Out-of-range chunkIndex produces error with valid range
 * For any valid template object and for any chunkIndex that is negative or
 * ≥ the number of chunks produced by ContentChunker.chunk(JSON.stringify(template)),
 * the fetch function should return an ApiRequest.error() response whose body
 * includes the valid range { min: 0, max: totalChunks - 1 }.
 * Validates: Requirements 2.4
 */

const fc = require('fast-check');
const ContentChunker = require('../../utils/content-chunker');

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = '/test/';

// Track the captured fetch function
let capturedFetchFn = null;

// Mock Services.Templates.get to return whatever template we provide
const mockTemplatesGet = jest.fn();

jest.mock('../../services', () => ({
	Templates: {
		get: (...args) => mockTemplatesGet(...args),
		list: jest.fn(),
		listVersions: jest.fn(),
		listCategories: jest.fn()
	}
}));

// Mock CacheableDataAccess.getData to capture the fetch function and call it
jest.mock('@63klabs/cache-data', () => ({
	cache: {
		CacheableDataAccess: {
			getData: jest.fn(async (cacheProfile, fetchFn, conn, opts) => {
				capturedFetchFn = fetchFn;
				const result = await fetchFn(conn, opts);
				return {
					getBody: (parse) => {
						if (result && typeof result.getBody === 'function') {
							return result.getBody(parse);
						}
						return result && result.body ? result.body : result;
					}
				};
			})
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

// Mock Config
jest.mock('../../config', () => ({
	Config: {
		getConnCacheProfile: jest.fn().mockReturnValue({
			conn: {
				name: 'template-chunks',
				host: 'internal',
				path: '/chunks',
				parameters: {}
			},
			cacheProfile: {
				profile: 'chunk-data',
				hostId: 'template-chunks',
				pathId: 'data'
			}
		}),
		settings: jest.fn().mockReturnValue({
			s3: { buckets: ['default-bucket'] }
		})
	}
}));

const Templates = require('../../controllers/templates');

/**
 * Arbitrary generator for template-like objects with varied structure.
 * Produces objects with string, number, boolean, array, and nested fields
 * to simulate realistic CloudFormation template data.
 *
 * @returns {fc.Arbitrary<Object>} A fast-check arbitrary producing template objects
 */
function templateArb() {
	return fc.record({
		name: fc.string({ minLength: 1, maxLength: 50 }),
		category: fc.string({ minLength: 1, maxLength: 30 }),
		version: fc.string({ minLength: 1, maxLength: 10 }),
		description: fc.string({ minLength: 0, maxLength: 200 }),
		parameters: fc.dictionary(
			fc.string({ minLength: 1, maxLength: 20 }),
			fc.oneof(
				fc.string({ minLength: 0, maxLength: 50 }),
				fc.integer(),
				fc.boolean()
			),
			{ minKeys: 0, maxKeys: 5 }
		),
		resources: fc.dictionary(
			fc.string({ minLength: 1, maxLength: 20 }),
			fc.record({
				type: fc.string({ minLength: 1, maxLength: 30 }),
				properties: fc.dictionary(
					fc.string({ minLength: 1, maxLength: 15 }),
					fc.string({ minLength: 0, maxLength: 40 }),
					{ minKeys: 0, maxKeys: 3 }
				)
			}),
			{ minKeys: 0, maxKeys: 5 }
		)
	});
}

describe('Feature: template-chunk-internal-cache, Property 1: Fetch function produces correct chunk content', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		capturedFetchFn = null;
	});

	/**
	 * **Validates: Requirements 2.1, 2.2**
	 *
	 * For any valid template object and any valid chunkIndex, the fetch
	 * function returns content equal to
	 * ContentChunker.chunk(JSON.stringify(template))[chunkIndex],
	 * totalChunks equal to the chunks array length, and chunkIndex equal
	 * to the requested index.
	 */
	test('fetch function produces correct chunk content for any template and valid chunkIndex', async () => {
		await fc.assert(
			fc.asyncProperty(templateArb(), async (template) => {
				// Compute expected chunks directly
				const serialized = JSON.stringify(template);
				const expectedChunks = ContentChunker.chunk(serialized);
				const totalChunks = expectedChunks.length;

				// Test every valid chunkIndex for this template
				for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
					// Configure mock to return the generated template
					mockTemplatesGet.mockResolvedValue(template);

					// Call getChunk controller which invokes the fetch function
					const result = await Templates.getChunk({
						bodyParameters: {
							input: {
								templateName: template.name || 'test-template',
								category: template.category || 'test',
								chunkIndex
							}
						}
					});

					// Verify the result contains correct chunk data
					expect(result.success).toBe(true);
					expect(result.data).toBeDefined();
					expect(result.data.content).toBe(expectedChunks[chunkIndex]);
					expect(result.data.totalChunks).toBe(totalChunks);
					expect(result.data.chunkIndex).toBe(chunkIndex);
				}
			}),
			{ numRuns: 100 }
		);
	});
});


describe('Feature: template-chunk-internal-cache, Property 2: Out-of-range chunkIndex produces error with valid range', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		capturedFetchFn = null;
	});

	/**
	 * **Validates: Requirements 2.4**
	 *
	 * For any valid template object and any chunkIndex that is negative,
	 * the controller returns an MCP error response with code
	 * 'INVALID_CHUNK_INDEX' and a validRange of { min: 0, max: totalChunks - 1 }.
	 */
	test('negative chunkIndex produces INVALID_CHUNK_INDEX error with correct valid range', async () => {
		await fc.assert(
			fc.asyncProperty(
				templateArb(),
				fc.integer({ min: -1000, max: -1 }),
				async (template, negativeIndex) => {
					const serialized = JSON.stringify(template);
					const expectedChunks = ContentChunker.chunk(serialized);
					const totalChunks = expectedChunks.length;

					mockTemplatesGet.mockResolvedValue(template);

					const result = await Templates.getChunk({
						bodyParameters: {
							input: {
								templateName: template.name || 'test-template',
								category: template.category || 'test',
								chunkIndex: negativeIndex
							}
						}
					});

					expect(result.success).toBe(false);
					expect(result.code).toBe('INVALID_CHUNK_INDEX');
					expect(result.data).toBeDefined();
					expect(result.data.validRange).toEqual({
						min: 0,
						max: totalChunks - 1
					});
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * **Validates: Requirements 2.4**
	 *
	 * For any valid template object and any chunkIndex ≥ totalChunks,
	 * the controller returns an MCP error response with code
	 * 'INVALID_CHUNK_INDEX' and a validRange of { min: 0, max: totalChunks - 1 }.
	 */
	test('chunkIndex >= totalChunks produces INVALID_CHUNK_INDEX error with correct valid range', async () => {
		await fc.assert(
			fc.asyncProperty(
				templateArb(),
				fc.nat({ max: 999 }),
				async (template, offset) => {
					const serialized = JSON.stringify(template);
					const expectedChunks = ContentChunker.chunk(serialized);
					const totalChunks = expectedChunks.length;
					const outOfRangeIndex = totalChunks + offset;

					mockTemplatesGet.mockResolvedValue(template);

					const result = await Templates.getChunk({
						bodyParameters: {
							input: {
								templateName: template.name || 'test-template',
								category: template.category || 'test',
								chunkIndex: outOfRangeIndex
							}
						}
					});

					expect(result.success).toBe(false);
					expect(result.code).toBe('INVALID_CHUNK_INDEX');
					expect(result.data).toBeDefined();
					expect(result.data.validRange).toEqual({
						min: 0,
						max: totalChunks - 1
					});
				}
			),
			{ numRuns: 100 }
		);
	});
});
