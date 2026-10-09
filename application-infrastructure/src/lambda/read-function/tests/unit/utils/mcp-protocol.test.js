/**
 * Unit Tests for MCP Protocol Utilities
 *
 * Tests the MCP protocol utility functions including response formatting,
 * protocol negotiation, and capability discovery.
 */

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = process.env.PARAM_STORE_PATH || '/test/';

const settings = require('../../../config/settings');
const { buildInstructions } = require('../../../config/server-instructions');
const {
  MCP_VERSION,
  MCP_CAPABILITIES_WIRE,
  MCP_TOOLS,
  ALLOWED_REVISIONS,
  SERVER_NAME,
  SERVER_VERSION,
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

    test('MCP_CAPABILITIES_WIRE should have expected on-wire structure (Requirements 3.1, 3.2)', () => {
      expect(MCP_CAPABILITIES_WIRE).toEqual({
        tools: { listChanged: false }
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
    test('should accept supported revision 2024-11-05', () => {
      const result = negotiateProtocol('2024-11-05');

      expect(result).toHaveProperty('accepted', true);
      expect(result).toHaveProperty('negotiatedRevision', '2024-11-05');
      expect(result).toHaveProperty('supportedVersions');
      expect(result.supportedVersions).toContain('2024-11-05');
      expect(result).not.toHaveProperty('capabilities');
      expect(result).not.toHaveProperty('protocol');
      expect(result).not.toHaveProperty('version');
      expect(result.message).toBe('Protocol version 2024-11-05 accepted');
    });

    test('should reject unsupported revision', () => {
      const result = negotiateProtocol('2099-01-01');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result).not.toHaveProperty('capabilities');
      // Phase 3: Message now includes both supported versions
      expect(result.message).toBe('Protocol version 2099-01-01 not supported. Supported versions: 2024-11-05, 2025-11-25');
    });

    test('should include list of supported versions', () => {
      const result = negotiateProtocol('2024-11-05');

      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(result.supportedVersions.length).toBeGreaterThan(0);
      expect(result.supportedVersions).toContain('2024-11-05');
    });
  });

  describe('getCapabilities()', () => {
    test('should return supportedVersions as ALLOWED_REVISIONS (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();

      expect(capabilities.supportedVersions).toBe(ALLOWED_REVISIONS);
      expect(Array.isArray(capabilities.supportedVersions)).toBe(true);
      expect(capabilities.supportedVersions).toContain('2024-11-05');
      expect(capabilities.supportedVersions).toContain('2025-11-25');
    });

    test('should return capabilities as MCP_CAPABILITIES_WIRE (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();

      expect(capabilities.capabilities).toBe(MCP_CAPABILITIES_WIRE);
      expect(capabilities.capabilities).toEqual({
        tools: { listChanged: false }
      });
    });

    test('should return serverInfo.name as SERVER_NAME and serverInfo.version as SERVER_VERSION (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();

      expect(capabilities.serverInfo.name).toBe(SERVER_NAME);
      expect(capabilities.serverInfo.name).toBe('atlantis-mcp-server');
      expect(capabilities.serverInfo.version).toBe(SERVER_VERSION);
      expect(typeof capabilities.serverInfo.version).toBe('string');
    });

    test('should return instructions byte-identical to buildInstructions() (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();
      const directInstructions = buildInstructions();

      expect(capabilities.instructions).toBe(directInstructions);
      expect(typeof capabilities.instructions).toBe('string');
      expect(capabilities.instructions.length).toBeGreaterThan(0);
    });

    test('should not include dead fields (protocol, version, tools) (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();

      // These fields should NOT be present in getCapabilities() return value
      expect(capabilities).not.toHaveProperty('protocol');
      expect(capabilities).not.toHaveProperty('version');
      expect(capabilities).not.toHaveProperty('tools');
      expect(capabilities).not.toHaveProperty('description');
      expect(capabilities).not.toHaveProperty('vendor');
    });

    test('should return only the four expected properties (Requirements 3.1, 15.4)', () => {
      const capabilities = getCapabilities();
      const keys = Object.keys(capabilities);

      expect(keys).toHaveLength(4);
      expect(keys).toContain('supportedVersions');
      expect(keys).toContain('capabilities');
      expect(keys).toContain('serverInfo');
      expect(keys).toContain('instructions');
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

  describe('Settings Integration (Requirements 2.2, 2.3, 2.4, 6.3)', () => {
    test('listTools() returns availableToolsList from settings (reference identity)', () => {
      const tools = listTools();
      expect(tools).toBe(settings.tools.availableToolsList);
    });

    test('MCP_TOOLS constant returns availableToolsList from settings (reference identity)', () => {
      expect(MCP_TOOLS).toBe(settings.tools.availableToolsList);
    });

    test('isValidTool("list_tools") returns true', () => {
      expect(isValidTool('list_tools')).toBe(true);
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

    test('legacy response formatters should include MCP protocol identifier', () => {
      const success = successResponse('test', {});
      const error = errorResponse('ERROR', 'Test');

      expect(success.protocol).toBe('mcp');
      expect(error.protocol).toBe('mcp');
      
      // getCapabilities() no longer returns protocol field (Requirements 3.1, 3.2, 3.3)
      // It returns era-neutral capability information instead
    });
  });
});
