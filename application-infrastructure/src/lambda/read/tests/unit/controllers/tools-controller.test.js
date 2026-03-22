/**
 * Unit Tests for Tools Controller and Router 404 Handler
 *
 * Tests the list_tools controller endpoint and router 404 handler:
 * - Successful MCP response with all tool definitions
 * - INTERNAL_ERROR on unexpected exception
 * - Missing/empty body handling
 * - Invalid input rejection
 * - Router 404 includes centralized tool names
 *
 * Requirements: 3.2, 3.3, 3.4, 4.1, 4.2, 6.1, 6.2, 6.5
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

jest.mock('../../../utils/error-handler', () => ({
  createError: jest.fn().mockImplementation((opts) => {
    const err = new Error(opts.message);
    err.code = opts.code;
    err.category = opts.category;
    err.statusCode = opts.statusCode;
    err.details = opts.details;
    err.availableTools = opts.details?.availableTools;
    err.requestId = opts.requestId;
    return err;
  }),
  logError: jest.fn(),
  toUserResponse: jest.fn().mockReturnValue({ error: 'Not found' }),
  getStatusCode: jest.fn().mockReturnValue(404),
  ErrorCode: {
    INVALID_INPUT: 'INVALID_INPUT',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL',
    METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  },
  ErrorCategory: {
    CLIENT_ERROR: 'CLIENT_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    SERVER_ERROR: 'SERVER_ERROR'
  }
}));

const ToolsController = require('../../../controllers/tools');
const SchemaValidator = require('../../../utils/schema-validator');
const settings = require('../../../config/settings');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

describe('Tools Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list()', () => {
    test('should return successful MCP response with all tool definitions', async () => {
      const props = { bodyParameters: { input: {} } };

      const result = await ToolsController.list(props);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.protocol).toBe('mcp');
      expect(result.tool).toBe('list_tools');
      expect(result.data).toBeDefined();
      expect(result.data.tools).toEqual(settings.tools.availableToolsList);
      expect(result.data.tools.length).toBeGreaterThan(0);

      // Verify each tool has required properties
      for (const tool of result.data.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      }
    });

    test('should return INTERNAL_ERROR when unexpected exception occurs', async () => {
      const props = { bodyParameters: { input: {} } };

      // Mock SchemaValidator.validate to throw an unexpected error
      const originalValidate = SchemaValidator.validate;
      SchemaValidator.validate = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected failure');
      });

      try {
        const result = await ToolsController.list(props);

        expect(result).toBeDefined();
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.details).toEqual(
          expect.objectContaining({
            message: 'Failed to list tools',
            error: 'Unexpected failure'
          })
        );
        expect(result.tool).toBe('list_tools');
        expect(DebugAndLog.error).toHaveBeenCalled();
      } finally {
        // Restore original validate
        SchemaValidator.validate = originalValidate;
      }
    });

    test('should handle missing body gracefully', async () => {
      // props with no bodyParameters at all
      const props = {};

      const result = await ToolsController.list(props);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.tool).toBe('list_tools');
      expect(result.data.tools).toEqual(settings.tools.availableToolsList);
    });

    test('should handle empty bodyParameters gracefully', async () => {
      // bodyParameters exists but no input property
      const props = { bodyParameters: {} };

      const result = await ToolsController.list(props);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.tool).toBe('list_tools');
      expect(result.data.tools).toEqual(settings.tools.availableToolsList);
    });

    test('should reject invalid input with unexpected properties', async () => {
      const props = {
        bodyParameters: {
          input: { unexpectedProp: 'value', anotherBadProp: 123 }
        }
      };

      const result = await ToolsController.list(props);

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details).toEqual(
        expect.objectContaining({
          message: 'Input validation failed'
        })
      );
      expect(result.error.details.errors).toBeDefined();
      expect(result.error.details.errors.length).toBeGreaterThan(0);
      expect(result.tool).toBe('list_tools');
    });
  });
});

