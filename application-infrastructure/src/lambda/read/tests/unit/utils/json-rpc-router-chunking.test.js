/**
 * Unit Tests for JSON-RPC Router Chunking Behavior
 *
 * Tests the size-aware response handling in handleToolsCall() for
 * get_template responses. Verifies that oversized responses return
 * a Template_Summary, under-threshold responses pass through unchanged,
 * non-get_template tools are unaffected, and graceful fallback on error.
 *
 * Validates: Requirements 2.1, 2.2, 2.6, 2.7, 5.1, 5.2
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
    search: jest.fn()
  },
  Validation: {
    validate: jest.fn()
  },
  Updates: {
    check: jest.fn()
  },
  Tools: {
    list: jest.fn()
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
 * Helper: build a JSON-RPC 2.0 tools/call event
 *
 * @param {string} toolName - Tool name to call
 * @param {Object} [args={}] - Tool arguments
 * @param {string} [id='test-1'] - JSON-RPC request id
 * @returns {Object} API Gateway event object
 */
function makeToolCallEvent(toolName, args = {}, id = 'test-1') {
  return {
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id,
      params: {
        name: toolName,
        arguments: args
      }
    })
  };
}

/**
 * Helper: parse the response body JSON
 *
 * @param {Object} response - API Gateway response
 * @returns {Object} Parsed body
 */
function parseBody(response) {
  return JSON.parse(response.body);
}

/**
 * Build a mock controller result in the legacy MCP format
 *
 * @param {Object} data - The data payload
 * @returns {Object} Controller result with protocol envelope
 */
function mockControllerResult(data) {
  return {
    protocol: 'mcp',
    version: '1.0',
    tool: 'get_template',
    success: true,
    data,
    timestamp: new Date().toISOString()
  };
}

describe('JSON-RPC Router Chunking Behavior', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // get_template oversized response → summary
  // Validates: Requirements 2.1, 2.2, 2.6, 2.7
  // ---------------------------------------------------------------
  describe('get_template oversized response returns summary', () => {
    test('returns Template_Summary with contentTruncated and totalChunks when payload exceeds threshold', async () => {
      const templateData = {
        name: 'template-storage-s3',
        version: 'v1.2.3/2024-01-15',
        versionId: 'abc123',
        description: 'S3 storage template',
        category: 'storage',
        namespace: 'templates',
        bucket: 'my-bucket',
        s3Path: 'templates/storage/template-storage-s3.yml',
        parameters: { BucketName: { Type: 'String', Default: 'my-bucket' } },
        outputs: { BucketArn: { Description: 'Bucket ARN', Value: { 'Fn::GetAtt': ['Bucket', 'Arn'] } } },
        content: { Resources: { Bucket: { Type: 'AWS::S3::Bucket' } } }
      };

      Controllers.Templates.get.mockResolvedValue(mockControllerResult(templateData));

      // ContentSizer reports payload exceeds threshold
      ContentSizer.measure.mockReturnValue({
        byteLength: 60000,
        exceedsThreshold: true
      });

      // ContentChunker returns 3 chunks
      ContentChunker.chunk.mockReturnValue(['chunk-0', 'chunk-1', 'chunk-2']);

      const event = makeToolCallEvent('get_template', {
        templateName: 'template-storage-s3',
        category: 'storage'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-1');
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();
      expect(body.result.content[0].type).toBe('text');

      // Parse the inner text to get the summary
      const summary = JSON.parse(body.result.content[0].text);

      expect(summary.contentTruncated).toBe(true);
      expect(summary.totalChunks).toBe(3);
      expect(summary.name).toBe('template-storage-s3');
      expect(summary.version).toBe('v1.2.3/2024-01-15');
      expect(summary.versionId).toBe('abc123');
      expect(summary.description).toBe('S3 storage template');
      expect(summary.category).toBe('storage');
      expect(summary.namespace).toBe('templates');
      expect(summary.bucket).toBe('my-bucket');
      expect(summary.s3Path).toBe('templates/storage/template-storage-s3.yml');
      expect(summary.parameters).toEqual(templateData.parameters);
      expect(summary.outputs).toEqual(templateData.outputs);
      expect(summary.retrievalHint).toContain('get_template_chunk');
      expect(Array.isArray(summary.resources)).toBe(true);
      expect(summary.resources).toEqual([
        { logicalId: 'Bucket', type: 'AWS::S3::Bucket' }
      ]);
    });
  });

  // ---------------------------------------------------------------
  // get_template under threshold → unchanged response
  // Validates: Requirements 5.1
  // ---------------------------------------------------------------
  describe('get_template under threshold returns unchanged response', () => {
    test('returns full content when payload does not exceed threshold', async () => {
      const templateData = {
        name: 'small-template',
        version: 'v1.0.0/2024-01-01',
        description: 'A small template',
        category: 'storage',
        content: 'AWSTemplateFormatVersion: 2010-09-09'
      };

      Controllers.Templates.get.mockResolvedValue(mockControllerResult(templateData));

      // ContentSizer reports payload is under threshold
      ContentSizer.measure.mockReturnValue({
        byteLength: 500,
        exceedsThreshold: false
      });

      const event = makeToolCallEvent('get_template', {
        templateName: 'small-template',
        category: 'storage'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-1');
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();

      // Parse the inner text — should be the full template data, not a summary
      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData.name).toBe('small-template');
      expect(resultData.content).toBe('AWSTemplateFormatVersion: 2010-09-09');
      expect(resultData.contentTruncated).toBeUndefined();
      expect(resultData.totalChunks).toBeUndefined();

      // ContentChunker should not have been called
      expect(ContentChunker.chunk).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Non-get_template tool → unchanged response regardless of size
  // Validates: Requirements 5.2
  // ---------------------------------------------------------------
  describe('non-get_template tool returns unchanged response', () => {
    test('list_templates response is unchanged regardless of payload size', async () => {
      const listData = [
        { name: 'template-1', category: 'storage' },
        { name: 'template-2', category: 'network' }
      ];

      Controllers.Templates.list.mockResolvedValue({
        protocol: 'mcp',
        version: '1.0',
        tool: 'list_templates',
        success: true,
        data: listData,
        timestamp: new Date().toISOString()
      });

      const event = makeToolCallEvent('list_templates', { category: 'storage' });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();

      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData).toEqual(listData);
      expect(resultData.contentTruncated).toBeUndefined();

      // ContentSizer should not have been called for non-get_template tools
      expect(ContentSizer.measure).not.toHaveBeenCalled();
      expect(ContentChunker.chunk).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Graceful fallback when summary generation fails
  // Validates: Requirements 2.1 (error handling)
  // ---------------------------------------------------------------
  describe('graceful fallback when summary generation fails', () => {
    test('returns original full response when ContentChunker.chunk throws', async () => {
      const templateData = {
        name: 'error-template',
        version: 'v2.0.0/2024-06-01',
        description: 'Template that triggers error',
        category: 'network',
        content: { Resources: { Vpc: { Type: 'AWS::EC2::VPC' } } }
      };

      Controllers.Templates.get.mockResolvedValue(mockControllerResult(templateData));

      // ContentSizer reports payload exceeds threshold
      ContentSizer.measure.mockReturnValue({
        byteLength: 80000,
        exceedsThreshold: true
      });

      // ContentChunker throws an error during summary generation
      ContentChunker.chunk.mockImplementation(() => {
        throw new Error('Chunking failed unexpectedly');
      });

      const event = makeToolCallEvent('get_template', {
        templateName: 'error-template',
        category: 'network'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-1');
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();

      // Should fall back to the original full response
      const resultData = JSON.parse(body.result.content[0].text);

      expect(resultData.name).toBe('error-template');
      expect(resultData.content).toEqual({ Resources: { Vpc: { Type: 'AWS::EC2::VPC' } } });
      // Should NOT have contentTruncated since fallback returns original
      expect(resultData.contentTruncated).toBeUndefined();
      expect(resultData.totalChunks).toBeUndefined();
    });
  });
});
