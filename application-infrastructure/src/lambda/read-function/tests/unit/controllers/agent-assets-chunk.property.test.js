/**
 * Property test for chunk round-trip and index bounds (Task 10.4)
 *
 * Exercises `Controllers.AgentAssets.getChunk` directly, mocking only
 * `Services.AgentAssets.getChunk` and `utils/mcp-protocol` (mirroring the
 * mocking convention in `agent-assets-controller.test.js`). `utils/schema-validator`
 * and `config/agent-asset-types` are left UNMOCKED so the real
 * `get_agent_asset_chunk` schema (registered by task 10.3) and the real
 * enabled-type registry enforce input validation exactly as they would in
 * production.
 *
 * For every generated content string, the REAL `ContentChunker.chunk()` is
 * used to compute the ground-truth `chunks` array. The service mock then
 * serves those exact chunks (and the exact `INVALID_CHUNK_INDEX` shape used
 * by `services/agent-assets.js`) back through the controller, so the
 * property is checking real chunking behavior end-to-end through the
 * controller layer rather than a synthetic stand-in.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */

// >! Mock only the service boundary; schema-validator and agent-asset-types
// >! stay real so input validation (Requirement 7.1/7.2-style enforcement,
// >! and Property 11's "no S3 read on invalid input") is genuinely exercised
jest.mock('../../../services', () => ({
  AgentAssets: {
    getChunk: jest.fn()
  }
}));

jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

// >! NOTE: '@63klabs/cache-data' is intentionally left UNMOCKED here (unlike
// >! agent-assets-controller.test.js, which mocks BOTH schema-validator and
// >! mcp-protocol away). schema-validator.js loads config/settings.js at
// >! require time, which constructs a real CachedSsmParameter from
// >! cache-data.tools; mocking cache-data away breaks that construction.
// >! Leaving cache-data real lets the real, task-10.3-registered
// >! get_agent_asset_chunk schema (and the real AgentAssetTypes registry)
// >! genuinely enforce input validation.
const fc = require('fast-check');
const Controller = require('../../../controllers/agent-assets');
const Services = require('../../../services');
const ContentChunker = require('../../../utils/content-chunker');

/**
 * Deliberately small chunk size so multi-chunk content is exercised without
 * generating huge strings.
 * @constant {number}
 */
const MAX_CHUNK_SIZE = 100;

/**
 * Generates individual "lines" bounded well under `MAX_CHUNK_SIZE` bytes
 * (at most 8 UTF-16 code units, so at most ~32 UTF-8 bytes even in the
 * worst-case all-surrogate-pair scenario) and free of embedded newlines, so
 * `ContentChunker.chunk()` never needs to fall back to its byte-boundary
 * sub-split path for an oversized single line. This keeps `chunks.join('\n')`
 * a valid, always-correct reconstruction strategy for every generated
 * sample (the documented common-case round-trip guarantee in
 * `utils/content-chunker.js`).
 */
const lineArb = fc.string({ minLength: 0, maxLength: 8 }).filter((line) => !line.includes('\n'));

/**
 * Generates content strings by joining 1-30 generated lines with '\n',
 * producing both content that fits in a single chunk and content large
 * enough to require several chunks under `MAX_CHUNK_SIZE`.
 */
const contentArb = fc
  .array(lineArb, { minLength: 1, maxLength: 30 })
  .map((lines) => lines.join('\n'));

describe('Feature: agent-asset-tools, Property 15: Chunk round-trip and index bounds', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('every valid chunkIndex reconstructs the full content; out-of-range indices are rejected', async () => {
    await fc.assert(
      fc.asyncProperty(contentArb, async (content) => {
        const assetType = 'steering';
        const name = 'test.md';

        // >! Ground truth: derive the real chunk boundaries from the actual
        // >! chunker implementation, not a synthetic stand-in
        const chunks = ContentChunker.chunk(content, MAX_CHUNK_SIZE);
        const totalChunks = chunks.length;

        // >! Serve real chunk data for in-range indices, and the exact
        // >! INVALID_CHUNK_INDEX shape produced by services/agent-assets.js
        // >! for out-of-range indices
        Services.AgentAssets.getChunk.mockImplementation(async ({ chunkIndex }) => {
          if (chunkIndex < 0 || chunkIndex >= totalChunks) {
            return {
              code: 'INVALID_CHUNK_INDEX',
              message: `chunkIndex ${chunkIndex} is out of range. Valid range: 0-${totalChunks - 1}`,
              validRange: { min: 0, max: totalChunks - 1 }
            };
          }
          return { chunkIndex, totalChunks, assetType, name, content: chunks[chunkIndex] };
        });

        // --- Round-trip: every index 0..totalChunks-1 reconstructs content ---
        const collected = [];
        for (let i = 0; i < totalChunks; i++) {
          const result = await Controller.getChunk({
            bodyParameters: { input: { assetType, name, chunkIndex: i } }
          });
          if (!result.success) {
            return false; // a valid index must always succeed
          }
          collected.push(result.data.content);
        }
        if (collected.join('\n') !== content) {
          return false;
        }

        // --- Out-of-range (above max): chunkIndex === totalChunks ---
        const aboveMax = await Controller.getChunk({
          bodyParameters: { input: { assetType, name, chunkIndex: totalChunks } }
        });
        if (aboveMax.success) return false;
        if (aboveMax.code !== 'INVALID_CHUNK_INDEX') return false;
        if (
          aboveMax.details.validRange.min !== 0 ||
          aboveMax.details.validRange.max !== totalChunks - 1
        ) {
          return false;
        }

        // --- Out-of-range (below min): chunkIndex === -1 ---
        // NOTE ON REAL BEHAVIOR: the generated `get_agent_asset_chunk` schema
        // enforces `chunkIndex: { type: 'integer', minimum: 0 }`, so a negative
        // index is rejected by SchemaValidator BEFORE Services.AgentAssets.getChunk
        // is ever invoked (verified directly against the real, unmocked
        // schema-validator). The controller therefore returns INVALID_INPUT for
        // chunkIndex = -1, not INVALID_CHUNK_INDEX - the range check that
        // produces INVALID_CHUNK_INDEX only runs once totalChunks is known
        // (post-fetch), and negative values never reach it. This is consistent
        // with Property 11's "input validation before any S3 read" guarantee:
        // the negative case is caught at the input layer.
        const belowMin = await Controller.getChunk({
          bodyParameters: { input: { assetType, name, chunkIndex: -1 } }
        });
        if (belowMin.success) return false;
        if (belowMin.code !== 'INVALID_INPUT') return false;

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
