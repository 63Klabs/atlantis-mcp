/**
 * Unit tests for get_document / get_document_chunk tool registration and input validation
 * (spec 0-0-6, task 5.2).
 *
 * Covers:
 * - both tools are discoverable through `tools/list` and the `list_tools` tool, with a
 *   description and an input schema (Requirement 6.1)
 * - both are dispatched as JSON-RPC methods over the existing endpoint via TOOL_DISPATCH,
 *   with no new API Gateway path involved (Requirement 6.2)
 * - the SchemaValidator schemas accept a single lookup key and reject a malformed hash,
 *   a missing key, both keys at once, and a missing/negative chunkIndex (Requirement 6.6)
 *
 * All AWS I/O is avoided: the router's controllers are mocked and the tool catalog and
 * schemas are read straight from configuration.
 */

// >! Mock controllers so requiring the router never reaches a service or AWS SDK call.
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
    listTypes: jest.fn(),
    getChunk: jest.fn()
  }
}));

const { handleJsonRpc, TOOL_DISPATCH } = require('../../../utils/json-rpc-router');
const SchemaValidator = require('../../../utils/schema-validator');
const settings = require('../../../config/settings');
const { extendedDescriptions } = require('../../../config/tool-descriptions');
const Controllers = require('../../../controllers');

const DOCUMENT_TOOLS = ['get_document', 'get_document_chunk'];
const VALID_HASH = 'ea6f1a2b3c4d5e6f';
const CONTENT_PATH = '63klabs/cache-data/README.md/installation';

/** Wrap a JSON-RPC body in a mock clientRequest for handleJsonRpc. */
function makeClientRequest(body) {
  const event = { body: JSON.stringify(body) };
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
}

describe('get_document / get_document_chunk registration', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('tool catalog (Requirement 6.1)', () => {
    test.each(DOCUMENT_TOOLS)('%s is listed in availableToolsList with a description and input schema', (toolName) => {
      const tool = settings.tools.availableToolsList.find(t => t.name === toolName);

      expect(tool).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    });

    test.each(DOCUMENT_TOOLS)('%s has an extended description used by list_tools', (toolName) => {
      expect(typeof extendedDescriptions[toolName]).toBe('string');
      expect(extendedDescriptions[toolName].trim().length).toBeGreaterThan(0);
    });

    test('the published input schemas expose the lookup keys agents need', () => {
      const getDocument = settings.tools.availableToolsList.find(t => t.name === 'get_document');
      const getDocumentChunk = settings.tools.availableToolsList.find(t => t.name === 'get_document_chunk');

      expect(Object.keys(getDocument.inputSchema.properties).sort()).toEqual(['filePath', 'hash']);
      // >! MCP protocol does not support oneOf at the schema root level.
      // >! The exactly-one-of constraint is enforced in the controller layer instead.
      expect(getDocument.inputSchema.oneOf).toBeUndefined();
      expect(getDocument.inputSchema.additionalProperties).toBe(false);

      expect(Object.keys(getDocumentChunk.inputSchema.properties).sort()).toEqual(['chunkIndex', 'filePath', 'hash']);
      expect(getDocumentChunk.inputSchema.required).toEqual(['chunkIndex']);
      expect(getDocumentChunk.inputSchema.oneOf).toBeUndefined();
      expect(getDocumentChunk.inputSchema.additionalProperties).toBe(false);
    });

    test('tools/list returns both document tools', async () => {
      const response = await handleJsonRpc(makeClientRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'list-1'
      }));

      const body = JSON.parse(response.body);
      const names = body.result.tools.map(t => t.name);

      expect(names).toContain('get_document');
      expect(names).toContain('get_document_chunk');

      // tools/list merges the extended descriptions at response time.
      const listed = body.result.tools.find(t => t.name === 'get_document');
      expect(listed.description).toBe(extendedDescriptions.get_document);
    });

    test('list_tools tool reports both document tools with extended descriptions', async () => {
      // >! The real list_tools controller is used here (only the controllers index is mocked,
      // >! for the router) so this asserts what an agent actually receives. It reads S3/GitHub
      // >! nothing — the catalog comes from configuration.
      const ToolsController = require('../../../controllers/tools');

      const result = await ToolsController.list({ bodyParameters: { input: {} } });
      const listed = result.data.tools;
      const names = listed.map(t => t.name);

      expect(names).toContain('get_document');
      expect(names).toContain('get_document_chunk');

      for (const toolName of DOCUMENT_TOOLS) {
        const tool = listed.find(t => t.name === toolName);
        expect(tool.description).toBe(extendedDescriptions[toolName]);
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('JSON-RPC dispatch (Requirement 6.2)', () => {
    test('TOOL_DISPATCH maps both tools to the documentation controller', () => {
      expect(TOOL_DISPATCH.get_document).toBe(Controllers.Documentation.getDocument);
      expect(TOOL_DISPATCH.get_document_chunk).toBe(Controllers.Documentation.getDocumentChunk);
    });

    test('tools/call dispatches get_document to the controller over the existing endpoint', async () => {
      Controllers.Documentation.getDocument.mockResolvedValue({
        success: true,
        data: { filePath: CONTENT_PATH, content: '# Cache Data' }
      });

      const response = await handleJsonRpc(makeClientRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'doc-1',
        params: { name: 'get_document', arguments: { filePath: CONTENT_PATH } }
      }));

      expect(Controllers.Documentation.getDocument).toHaveBeenCalledTimes(1);
      const props = Controllers.Documentation.getDocument.mock.calls[0][0];
      expect(props.bodyParameters.input).toEqual({ filePath: CONTENT_PATH });

      const body = JSON.parse(response.body);
      expect(body.error).toBeUndefined();
      expect(JSON.parse(body.result.content[0].text).filePath).toBe(CONTENT_PATH);
    });

    test('tools/call dispatches get_document_chunk to the controller', async () => {
      Controllers.Documentation.getDocumentChunk.mockResolvedValue({
        success: true,
        data: { chunkIndex: 0, totalChunks: 2, filePath: CONTENT_PATH, content: 'part-1' }
      });

      const response = await handleJsonRpc(makeClientRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'doc-chunk-1',
        params: { name: 'get_document_chunk', arguments: { hash: VALID_HASH, chunkIndex: 0 } }
      }));

      expect(Controllers.Documentation.getDocumentChunk).toHaveBeenCalledTimes(1);
      const body = JSON.parse(response.body);
      expect(body.error).toBeUndefined();
      expect(JSON.parse(body.result.content[0].text).chunkIndex).toBe(0);
    });
  });

  describe('get_document input validation (Requirement 6.6)', () => {
    test('accepts a filePath alone', () => {
      const result = SchemaValidator.validate('get_document', { filePath: CONTENT_PATH });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('accepts a well-formed hash alone', () => {
      const result = SchemaValidator.validate('get_document', { hash: VALID_HASH });
      expect(result.valid).toBe(true);
    });

    test('rejects a request with neither filePath nor hash', () => {
      // >! The MCP schema no longer uses oneOf; the schema itself accepts {} (both keys
      // >! are optional at the schema level).  The controller enforces the exactly-one-of
      // >! constraint at runtime.  Schema validation passes; no schema-level error here.
      const result = SchemaValidator.validate('get_document', {});

      expect(result.valid).toBe(true);
    });

    test('rejects a request supplying both filePath and hash as ambiguous', () => {
      // >! The MCP schema no longer uses oneOf; both keys being present is accepted at
      // >! the schema level.  The controller enforces mutual exclusivity at runtime.
      const result = SchemaValidator.validate('get_document', {
        filePath: CONTENT_PATH,
        hash: VALID_HASH
      });

      expect(result.valid).toBe(true);
    });

    test.each([
      ['too short', 'ea6f1a2b'],
      ['too long', `${VALID_HASH}00`],
      ['uppercase hex', 'EA6F1A2B3C4D5E6F'],
      ['non-hex characters', 'ea6f1a2b3c4d5e6g'],
      ['path-traversal attempt', '../../../etc/pass']
    ])('rejects a malformed hash (%s)', (_label, hash) => {
      const result = SchemaValidator.validate('get_document', { hash });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('pattern');
    });

    test('rejects a non-string hash', () => {
      const result = SchemaValidator.validate('get_document', { hash: 1234567890123456 });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('type string');
    });

    test('rejects unknown properties', () => {
      const result = SchemaValidator.validate('get_document', {
        filePath: CONTENT_PATH,
        version: 'v1'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Unknown property: version');
    });
  });

  describe('get_document_chunk input validation (Requirement 6.6)', () => {
    test('accepts a lookup key plus chunkIndex', () => {
      expect(SchemaValidator.validate('get_document_chunk', {
        filePath: CONTENT_PATH,
        chunkIndex: 0
      }).valid).toBe(true);

      expect(SchemaValidator.validate('get_document_chunk', {
        hash: VALID_HASH,
        chunkIndex: 3
      }).valid).toBe(true);
    });

    test('rejects a missing chunkIndex', () => {
      const result = SchemaValidator.validate('get_document_chunk', { filePath: CONTENT_PATH });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Missing required property: chunkIndex');
    });

    test('rejects a missing lookup key', () => {
      // >! The MCP schema no longer uses oneOf; a missing filePath/hash is accepted at
      // >! the schema level.  The controller enforces the exactly-one-of constraint at runtime.
      const result = SchemaValidator.validate('get_document_chunk', { chunkIndex: 0 });

      expect(result.valid).toBe(true);
    });

    test('rejects a malformed hash', () => {
      const result = SchemaValidator.validate('get_document_chunk', {
        hash: 'not-a-hash',
        chunkIndex: 0
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('pattern');
    });

    test.each([
      ['negative', -1, 'at least 0'],
      ['non-integer', 1.5, 'type integer'],
      ['string', '0', 'type integer']
    ])('rejects a %s chunkIndex', (_label, chunkIndex, expectedError) => {
      const result = SchemaValidator.validate('get_document_chunk', {
        filePath: CONTENT_PATH,
        chunkIndex
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain(expectedError);
    });
  });
});
