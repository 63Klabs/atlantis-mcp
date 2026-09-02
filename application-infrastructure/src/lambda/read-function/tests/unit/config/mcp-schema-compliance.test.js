'use strict';

/**
 * MCP Schema Compliance Tests
 *
 * Verifies that no tool schemas in config/settings.js use `oneOf`, `allOf`, or
 * `anyOf` at the top level of `inputSchema`. The MCP protocol does not support
 * these JSON Schema composition keywords at the schema root, so violating this
 * constraint causes the MCP server to fail at startup.
 *
 * The "exactly one lookup key" constraint for get_document and get_document_chunk
 * is now enforced programmatically in the controller layer (validateLookupKey),
 * not via `oneOf` in the schema.
 *
 * Coverage:
 * - No tool schema uses oneOf/allOf/anyOf at the top level (all tools)
 * - get_document schema is well-formed: type, properties, additionalProperties,
 *   no composition keywords
 * - get_document_chunk schema is well-formed: same checks plus required: ['chunkIndex']
 *
 * Spec: 0-0-6-fix-mcp-schema-oneof / Task 8
 */

// >! Mock @63klabs/cache-data so settings load performs no real SSM access.
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

// Set the minimum required env var so settings loads without warnings that
// would interfere with test output.
beforeAll(() => {
  process.env.PARAM_STORE_PATH = '/test/';
});

const settings = require('../../../config/settings');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the tool definition for the given name, or undefined if not found.
 *
 * @param {string} name - MCP tool name
 * @returns {Object|undefined}
 */
function getTool(name) {
  return settings.tools.availableToolsList.find((t) => t.name === name);
}

// ---------------------------------------------------------------------------
// Suite 1: All tools — no composition keywords at root
// ---------------------------------------------------------------------------

describe('MCP Schema Compliance — no oneOf/allOf/anyOf at top level', () => {
  const tools = settings.tools.availableToolsList;

  test('availableToolsList is a non-empty array', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('no tool schema uses oneOf at the top level', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.oneOf).toBeUndefined();
    }
  });

  test('no tool schema uses allOf at the top level', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.allOf).toBeUndefined();
    }
  });

  test('no tool schema uses anyOf at the top level', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.anyOf).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2: get_document — specific schema validation
// ---------------------------------------------------------------------------

describe('MCP Schema Compliance — get_document inputSchema', () => {
  let tool;

  beforeAll(() => {
    tool = getTool('get_document');
  });

  test('get_document is registered in availableToolsList', () => {
    expect(tool).toBeDefined();
  });

  test('inputSchema.type is "object"', () => {
    expect(tool.inputSchema.type).toBe('object');
  });

  test('inputSchema.properties contains filePath and hash', () => {
    expect(tool.inputSchema.properties).toHaveProperty('filePath');
    expect(tool.inputSchema.properties).toHaveProperty('hash');
  });

  test('inputSchema.additionalProperties is false', () => {
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  test('inputSchema has no oneOf', () => {
    expect(tool.inputSchema.oneOf).toBeUndefined();
  });

  test('inputSchema has no allOf', () => {
    expect(tool.inputSchema.allOf).toBeUndefined();
  });

  test('inputSchema has no anyOf', () => {
    expect(tool.inputSchema.anyOf).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: get_document_chunk — specific schema validation
// ---------------------------------------------------------------------------

describe('MCP Schema Compliance — get_document_chunk inputSchema', () => {
  let tool;

  beforeAll(() => {
    tool = getTool('get_document_chunk');
  });

  test('get_document_chunk is registered in availableToolsList', () => {
    expect(tool).toBeDefined();
  });

  test('inputSchema.type is "object"', () => {
    expect(tool.inputSchema.type).toBe('object');
  });

  test('inputSchema.properties contains filePath and hash', () => {
    expect(tool.inputSchema.properties).toHaveProperty('filePath');
    expect(tool.inputSchema.properties).toHaveProperty('hash');
  });

  test('inputSchema.properties contains chunkIndex', () => {
    expect(tool.inputSchema.properties).toHaveProperty('chunkIndex');
  });

  test('inputSchema.required contains chunkIndex', () => {
    expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    expect(tool.inputSchema.required).toContain('chunkIndex');
  });

  test('inputSchema.additionalProperties is false', () => {
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  test('inputSchema has no oneOf', () => {
    expect(tool.inputSchema.oneOf).toBeUndefined();
  });

  test('inputSchema has no allOf', () => {
    expect(tool.inputSchema.allOf).toBeUndefined();
  });

  test('inputSchema has no anyOf', () => {
    expect(tool.inputSchema.anyOf).toBeUndefined();
  });
});
