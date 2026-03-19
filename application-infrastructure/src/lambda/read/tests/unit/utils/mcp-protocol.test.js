/**
 * Unit Tests for MCP Protocol Utilities
 *
 * Tests the MCP protocol utility functions including response formatting,
 * protocol negotiation, and capability discovery.
 */

const {
  MCP_VERSION,
  MCP_CAPABILITIES,
  MCP_TOOLS,
  successResponse,
  errorResponse,
  negotiateProtocol,
  getCapabilities,
  listTools,
  getTool,
  isValidTool
} = require('../../../utils/mcp-protocol');

describe('MCP Protocol Utilities', () => {
  describe('Constants', () => {
    test('MCP_VERSION should be defined', () => {
      expect(MCP_VERSION).toBe('1.0');
    });

    test('MCP_CAPABILITIES should have expected structure', () => {
      expect(MCP_CAPABILITIES).toEqual({
        tools: true,
        resources: false,
        prompts: false,
        sampling: false
      });
    });

    test('MCP_TOOLS should be an array', () => {
      expect(Array.isArray(MCP_TOOLS)).toBe(true);
      expect(MCP_TOOLS.length).toBeGreaterThan(0);
    });

    test('Each MCP_TOOL should have required properties', () => {
      MCP_TOOLS.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('successResponse()', () => {
    test('should create valid success response with data', () => {
      const toolName = 'list_templates';
      const data = [{ name: 'template1' }, { name: 'template2' }];

      const response = successResponse(toolName, data);

      expect(response).toHaveProperty('protocol', 'mcp');
      expect(response).toHaveProperty('version', MCP_VERSION);
      expect(response).toHaveProperty('tool', toolName);
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('data', data);
      expect(response).toHaveProperty('timestamp');
      expect(typeof response.timestamp).toBe('string');
    });

    test('should create success response with empty data', () => {
      const response = successResponse('list_categories', []);

      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
    });

    test('should create success response with object data', () => {
      const data = { name: 'template1', version: 'v1.0.0' };
      const response = successResponse('get_template', data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
    });

    test('should include valid ISO timestamp', () => {
      const response = successResponse('list_templates', []);

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(response.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('errorResponse()', () => {
    test('should create error response with string message', () => {
      const errorCode = 'TEMPLATE_NOT_FOUND';
      const errorMessage = 'Template not found';
      const toolName = 'get_template';

      const response = errorResponse(errorCode, errorMessage, toolName);

      expect(response).toHaveProperty('protocol', 'mcp');
      expect(response).toHaveProperty('version', MCP_VERSION);
      expect(response).toHaveProperty('tool', toolName);
      expect(response).toHaveProperty('success', false);
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code', errorCode);
      expect(response.error).toHaveProperty('details');
      expect(response.error.details).toHaveProperty('message', errorMessage);
      expect(response).toHaveProperty('timestamp');
    });

    test('should create error response with object details', () => {
      const errorCode = 'INVALID_INPUT';
      const errorDetails = {
        message: 'Validation failed',
        errors: ['Missing required field: templateName']
      };

      const response = errorResponse(errorCode, errorDetails);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe(errorCode);
      expect(response.error.details).toEqual(errorDetails);
    });

    test('should create error response without tool name', () => {
      const response = errorResponse('INTERNAL_ERROR', 'Something went wrong');

      expect(response.success).toBe(false);
      expect(response).not.toHaveProperty('tool');
    });

    test('should include valid ISO timestamp', () => {
      const response = errorResponse('ERROR', 'Test error');

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(response.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('negotiateProtocol()', () => {
    test('should accept supported version 1.0', () => {
      const result = negotiateProtocol('1.0');

      expect(result).toHaveProperty('protocol', 'mcp');
      expect(result).toHaveProperty('accepted', true);
      expect(result).toHaveProperty('version', '1.0');
      expect(result).toHaveProperty('supportedVersions');
      expect(result.supportedVersions).toContain('1.0');
      expect(result).toHaveProperty('capabilities', MCP_CAPABILITIES);
      expect(result.message).toContain('accepted');
    });

    test('should reject unsupported version', () => {
      const result = negotiateProtocol('2.0');

      expect(result.accepted).toBe(false);
      expect(result.version).toBe(MCP_VERSION);
      expect(result.capabilities).toBeNull();
      expect(result.message).toContain('not supported');
    });

    test('should include list of supported versions', () => {
      const result = negotiateProtocol('1.0');

      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(result.supportedVersions.length).toBeGreaterThan(0);
    });
  });

  describe('getCapabilities()', () => {
    test('should return complete capabilities object', () => {
      const capabilities = getCapabilities();

      expect(capabilities).toHaveProperty('protocol', 'mcp');
      expect(capabilities).toHaveProperty('version', MCP_VERSION);
      expect(capabilities).toHaveProperty('capabilities', MCP_CAPABILITIES);
      expect(capabilities).toHaveProperty('tools');
      expect(capabilities).toHaveProperty('description');
      expect(capabilities).toHaveProperty('vendor', '63Klabs');
      expect(capabilities).toHaveProperty('serverInfo');
    });

    test('should include server information', () => {
      const capabilities = getCapabilities();

      expect(capabilities.serverInfo).toHaveProperty('name');
      expect(capabilities.serverInfo).toHaveProperty('version');
      expect(capabilities.serverInfo).toHaveProperty('phase');
    });

    test('should include all tools', () => {
      const capabilities = getCapabilities();

      expect(Array.isArray(capabilities.tools)).toBe(true);
      expect(capabilities.tools.length).toBe(MCP_TOOLS.length);
    });
  });

  describe('listTools()', () => {
    test('should return array of all tools', () => {
      const tools = listTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('should return tools with complete definitions', () => {
      const tools = listTools();

      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });

    test('should include expected tool names', () => {
      const tools = listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('list_templates');
      expect(toolNames).toContain('get_template');
      expect(toolNames).toContain('list_starters');
      expect(toolNames).toContain('search_documentation');
      expect(toolNames).toContain('validate_naming');
    });
  });

  describe('getTool()', () => {
    test('should return tool definition for valid tool name', () => {
      const tool = getTool('list_templates');

      expect(tool).not.toBeNull();
      expect(tool).toHaveProperty('name', 'list_templates');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    });

    test('should return null for invalid tool name', () => {
      const tool = getTool('nonexistent_tool');

      expect(tool).toBeNull();
    });

    test('should return correct tool for each known tool', () => {
      const toolNames = [
        'list_templates',
        'get_template',
        'list_template_versions',
        'list_categories',
        'list_starters',
        'get_starter_info',
        'search_documentation',
        'validate_naming',
        'check_template_updates'
      ];

      toolNames.forEach(toolName => {
        const tool = getTool(toolName);
        expect(tool).not.toBeNull();
        expect(tool.name).toBe(toolName);
      });
    });
  });

  describe('isValidTool()', () => {
    test('should return true for valid tool names', () => {
      expect(isValidTool('list_templates')).toBe(true);
      expect(isValidTool('get_template')).toBe(true);
      expect(isValidTool('validate_naming')).toBe(true);
    });

    test('should return false for invalid tool names', () => {
      expect(isValidTool('invalid_tool')).toBe(false);
      expect(isValidTool('nonexistent')).toBe(false);
      expect(isValidTool('')).toBe(false);
    });

    test('should be case-sensitive', () => {
      expect(isValidTool('LIST_TEMPLATES')).toBe(false);
      expect(isValidTool('List_Templates')).toBe(false);
    });
  });

  describe('Response Format Consistency', () => {
    test('success and error responses should have consistent base structure', () => {
      const success = successResponse('test_tool', {});
      const error = errorResponse('ERROR', 'Test error', 'test_tool');

      expect(success).toHaveProperty('protocol');
      expect(error).toHaveProperty('protocol');
      expect(success.protocol).toBe(error.protocol);

      expect(success).toHaveProperty('version');
      expect(error).toHaveProperty('version');
      expect(success.version).toBe(error.version);

      expect(success).toHaveProperty('timestamp');
      expect(error).toHaveProperty('timestamp');
    });

    test('all responses should include MCP protocol identifier', () => {
      const success = successResponse('test', {});
      const error = errorResponse('ERROR', 'Test');
      const capabilities = getCapabilities();
      const negotiation = negotiateProtocol('1.0');

      expect(success.protocol).toBe('mcp');
      expect(error.protocol).toBe('mcp');
      expect(capabilities.protocol).toBe('mcp');
      expect(negotiation.protocol).toBe('mcp');
    });
  });
});
