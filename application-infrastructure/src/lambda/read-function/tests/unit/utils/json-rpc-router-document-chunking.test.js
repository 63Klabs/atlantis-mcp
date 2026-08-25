/**
 * Unit Tests for JSON-RPC Router Chunking Behavior — get_document (spec 0-0-6, task 5.4)
 *
 * Mirrors `json-rpc-router-chunking.test.js` (the `get_template` size-aware branch) for the
 * new `get_document` branch in `handleToolsCall()`: an over-threshold `get_document` result
 * returns a `Document_Summary` (`contentTruncated`, `totalChunks`, `retrievalHint`) instead
 * of the full content, an under-threshold result passes through unchanged, and summary
 * generation failures gracefully fall back to the full response.
 *
 * Validates: Requirement 6.7
 */

// Mock controllers to avoid real service calls
jest.mock('../../../controllers', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    getChunk: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
  },
  Starters: {
    list: jest.fn(),
    get: jest.fn()
  },
  Documentation: {
    search: jest.fn(),
    getDocument: jest.fn(),
    getDocumentChunk: jest.fn()
  },
  Validation: {
    validate: jest.fn()
  },
  Updates: {
    check: jest.fn()
  },
  Tools: {
    list: jest.fn()
  },
  AgentAssets: {
    list: jest.fn(),
    get: jest.fn(),
    listTypes: jest.fn()
  }
}));

// Mock ContentSizer to control threshold behavior
jest.mock('../../../utils/content-sizer', () => ({
  measure: jest.fn(),
  DEFAULT_SIZE_THRESHOLD: 50000
}));

// Mock ContentChunker to control chunk count
jest.mock('../../../utils/content-chunker', () => ({
  chunk: jest.fn(),
  DEFAULT_CHUNK_SIZE: 40000
}));

const { handleJsonRpc } = require('../../../utils/json-rpc-router');
const Controllers = require('../../../controllers');
const ContentSizer = require('../../../utils/content-sizer');
const ContentChunker = require('../../../utils/content-chunker');

/**
 * Helper: build a JSON-RPC 2.0 tools/call event.
 *
 * @param {string} toolName - Tool name to call.
 * @param {Object} [args={}] - Tool arguments.
 * @param {string} [id='test-1'] - JSON-RPC request id.
 * @returns {Object} Mock clientRequest.
 */
function makeToolCallEvent(toolName, args = {}, id = 'test-1') {
  const event = {
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id,
      params: { name: toolName, arguments: args }
    })
  };
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
}

/**
 * Helper: parse the response body JSON.
 *
 * @param {Object} response - API Gateway response.
 * @returns {Object} Parsed body.
 */
function parseBody(response) {
  return JSON.parse(response.body);
}

/**
 * Build a mock controller result in the legacy MCP format.
 *
 * @param {Object} data - The data payload.
 * @returns {Object} Controller result with protocol envelope.
 */
function mockControllerResult(data) {
  return {
    protocol: 'mcp',
    version: '1.0',
    tool: 'get_document',
    success: true,
    data,
    timestamp: new Date().toISOString()
  };
}

describe('JSON-RPC Router Chunking Behavior — get_document', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('get_document oversized response returns summary', () => {
    test('returns Document_Summary with contentTruncated and totalChunks when payload exceeds threshold', async () => {
      const documentData = {
        filePath: '63Klabs/atlantis-sam-templates/docs/README.md',
        githubUrl: 'https://github.com/63Klabs/atlantis-sam-templates/blob/main/docs/README.md',
        repository: 'atlantis-sam-templates',
        repositoryType: 'documentation',
        namespace: null,
        content: '# Large document body...'
      };

      Controllers.Documentation.getDocument.mockResolvedValue(mockControllerResult(documentData));

      ContentSizer.measure.mockReturnValue({ byteLength: 60000, exceedsThreshold: true });
      ContentChunker.chunk.mockReturnValue(['chunk-0', 'chunk-1', 'chunk-2']);

      const clientRequest = makeToolCallEvent('get_document', { filePath: documentData.filePath });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.result.content[0].type).toBe('text');

      const summary = JSON.parse(body.result.content[0].text);

      expect(summary.contentTruncated).toBe(true);
      expect(summary.totalChunks).toBe(3);
      expect(summary.filePath).toBe(documentData.filePath);
      expect(summary.githubUrl).toBe(documentData.githubUrl);
      expect(summary.repository).toBe(documentData.repository);
      expect(summary.repositoryType).toBe(documentData.repositoryType);
      expect(summary.namespace).toBeNull();
      expect(summary.retrievalHint).toContain('get_document_chunk');
      // >! The point of truncation: content must never be included in the summary.
      expect(summary.content).toBeUndefined();
    });
  });

  describe('get_document under threshold returns unchanged response', () => {
    test('returns full content when payload does not exceed threshold', async () => {
      const documentData = {
        filePath: '63Klabs/atlantis-sam-templates/docs/README.md',
        githubUrl: 'https://github.com/63Klabs/atlantis-sam-templates/blob/main/docs/README.md',
        repository: 'atlantis-sam-templates',
        repositoryType: 'documentation',
        namespace: null,
        content: '# Small document body'
      };

      Controllers.Documentation.getDocument.mockResolvedValue(mockControllerResult(documentData));

      ContentSizer.measure.mockReturnValue({ byteLength: 500, exceedsThreshold: false });

      const clientRequest = makeToolCallEvent('get_document', { filePath: documentData.filePath });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData.content).toBe('# Small document body');
      expect(resultData.contentTruncated).toBeUndefined();
      expect(resultData.totalChunks).toBeUndefined();
      expect(ContentChunker.chunk).not.toHaveBeenCalled();
    });
  });

  describe('graceful fallback when summary generation fails', () => {
    test('returns original full response when ContentChunker.chunk throws', async () => {
      const documentData = {
        filePath: '63Klabs/atlantis-sam-templates/docs/README.md',
        githubUrl: null,
        repository: 'atlantis-sam-templates',
        repositoryType: 'documentation',
        namespace: null,
        content: '# Document that triggers a chunking error'
      };

      Controllers.Documentation.getDocument.mockResolvedValue(mockControllerResult(documentData));

      ContentSizer.measure.mockReturnValue({ byteLength: 80000, exceedsThreshold: true });
      ContentChunker.chunk.mockImplementation(() => {
        throw new Error('Chunking failed unexpectedly');
      });

      const clientRequest = makeToolCallEvent('get_document', { filePath: documentData.filePath });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData.filePath).toBe(documentData.filePath);
      expect(resultData.content).toBe(documentData.content);
      expect(resultData.contentTruncated).toBeUndefined();
      expect(resultData.totalChunks).toBeUndefined();
    });
  });

  describe('non-get_document tool returns unchanged response', () => {
    test('get_document_chunk response is unchanged regardless of payload size', async () => {
      const chunkData = { chunkIndex: 0, totalChunks: 2, filePath: 'a/b/README.md', content: 'part-1' };

      Controllers.Documentation.getDocumentChunk.mockResolvedValue({
        protocol: 'mcp',
        version: '1.0',
        tool: 'get_document_chunk',
        success: true,
        data: chunkData,
        timestamp: new Date().toISOString()
      });

      const clientRequest = makeToolCallEvent('get_document_chunk', { filePath: 'a/b/README.md', chunkIndex: 0 });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData).toEqual(chunkData);
      expect(ContentSizer.measure).not.toHaveBeenCalled();
      expect(ContentChunker.chunk).not.toHaveBeenCalled();
    });
  });
});
