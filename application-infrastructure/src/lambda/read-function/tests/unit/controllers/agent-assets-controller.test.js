/**
 * Unit tests for Agent Assets Controller
 *
 * Tests all Agent Assets controller functions:
 * - list() - List agent assets across one or all enabled types
 * - get() - Retrieve one agent asset's full content
 * - listTypes() - List the enabled agent-asset types with per-type asset counts
 *
 * Tests include:
 * - Input validation (JSON Schema)
 * - Defense-in-depth assetType re-check against the real AgentAssetTypes registry (7.8)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (ASSET_NOT_FOUND, INVALID_INPUT, INTERNAL_ERROR)
 *
 * `config/agent-asset-types.js` has no AWS/cache-data dependency, so it is
 * used unmocked here: `skills` really is disabled and `steering`/`hooks`/
 * `agents-md` really are enabled, exercising the controller's real
 * defense-in-depth registry checks.
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  AgentAssets: {
    list: jest.fn(),
    get: jest.fn(),
    listTypes: jest.fn()
  }
}));

jest.mock('../../../utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

const AgentAssetsController = require('../../../controllers/agent-assets');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const AgentAssetTypes = require('../../../config/agent-asset-types');
const { tools } = require('@63klabs/cache-data');

describe('Agent Assets Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list()', () => {
    test('should return INVALID_INPUT when validation fails and never call the service', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 123 } } };
      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'assetType', message: 'must be a string' }]
      });

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_agent_assets', props.bodyParameters.input);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        {
          message: 'Input validation failed',
          errors: [{ field: 'assetType', message: 'must be a string' }]
        },
        'list_agent_assets'
      );
      expect(Services.AgentAssets.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return INVALID_INPUT naming valid types for a disabled assetType (Req 7.8)', async () => {
      // Arrange: schema validation "passes" (simulating a bypassed enum check),
      // exercising the controller's own defense-in-depth re-check
      const props = { bodyParameters: { input: { assetType: 'skills' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      const expectedValidTypes = AgentAssetTypes.getEnabledTypeNames();
      expect(expectedValidTypes).toEqual(['steering', 'hooks', 'agents-md']);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: expect.stringContaining(expectedValidTypes.join(', '))
        }),
        'list_agent_assets'
      );
      expect(Services.AgentAssets.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return INVALID_INPUT naming valid types for an unknown assetType', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'bogus' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: expect.stringContaining('steering, hooks, agents-md')
        }),
        'list_agent_assets'
      );
      expect(Services.AgentAssets.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return a success envelope for a single-type list', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockResult = {
        assets: [{ name: 'guidelines.md', type: 'steering' }],
        partialData: false,
        errors: []
      };
      Services.AgentAssets.list.mockResolvedValue(mockResult);

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(Services.AgentAssets.list).toHaveBeenCalledWith({
        assetType: 'steering',
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_agent_assets', mockResult);
      expect(result.success).toBe(true);
    });

    test('should return a success envelope for an all-types list (no assetType)', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockResult = {
        assets: [
          { name: 'guidelines.md', type: 'steering' },
          { name: 'on-save.kiro.hook', type: 'hooks' }
        ],
        partialData: false,
        errors: []
      };
      Services.AgentAssets.list.mockResolvedValue(mockResult);

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(Services.AgentAssets.list).toHaveBeenCalledWith({
        assetType: undefined,
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_agent_assets', mockResult);
      expect(result.success).toBe(true);
    });

    test('should map a strict-bucket INVALID_INPUT service error to INVALID_INPUT with invalidBuckets', async () => {
      // Arrange
      const props = { bodyParameters: { input: { s3Buckets: ['unconfigured-bucket'] } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const bucketError = new Error('Unconfigured bucket(s): unconfigured-bucket');
      bucketError.code = 'INVALID_INPUT';
      bucketError.invalidBuckets = ['unconfigured-bucket'];
      Services.AgentAssets.list.mockRejectedValue(bucketError);

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        {
          message: 'Unconfigured bucket(s): unconfigured-bucket',
          invalidBuckets: ['unconfigured-bucket']
        },
        'list_agent_assets'
      );
      expect(result.success).toBe(false);
    });

    test('should return INTERNAL_ERROR for an unexpected service error', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 connection failed');
      Services.AgentAssets.list.mockRejectedValue(serviceError);

      // Act
      const result = await AgentAssetsController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list agent assets',
          error: 'S3 connection failed'
        }),
        'list_agent_assets'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('get()', () => {
    test('should return INVALID_INPUT when validation fails and never call the service', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering' } } };
      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'name', message: 'Required field missing' }]
      });

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('get_agent_asset', props.bodyParameters.input);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        {
          message: 'Input validation failed',
          errors: [{ field: 'name', message: 'Required field missing' }]
        },
        'get_agent_asset'
      );
      expect(Services.AgentAssets.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return INVALID_INPUT naming valid types for an unknown assetType (Req 7.8)', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'bogus', name: 'x.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: expect.stringContaining('steering, hooks, agents-md')
        }),
        'get_agent_asset'
      );
      expect(Services.AgentAssets.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return INVALID_INPUT naming valid types for a disabled assetType', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'skills', name: 'x.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: expect.stringContaining(AgentAssetTypes.getEnabledTypeNames().join(', '))
        }),
        'get_agent_asset'
      );
      expect(Services.AgentAssets.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return a success envelope with the retrieved asset', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering', name: 'guidelines.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockAsset = {
        name: 'guidelines.md',
        type: 'steering',
        namespace: 'atlantis',
        bucket: 'test-bucket',
        content: '# Guidelines'
      };
      Services.AgentAssets.get.mockResolvedValue(mockAsset);

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(Services.AgentAssets.get).toHaveBeenCalledWith({
        assetType: 'steering',
        name: 'guidelines.md',
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_agent_asset', mockAsset);
      expect(result.success).toBe(true);
    });

    test('should map ASSET_NOT_FOUND with availableAssets (Req 2.4)', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering', name: 'missing.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Asset not found: missing.md');
      notFoundError.code = 'ASSET_NOT_FOUND';
      notFoundError.availableAssets = ['a.md', 'b.md'];
      Services.AgentAssets.get.mockRejectedValue(notFoundError);

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'ASSET_NOT_FOUND',
        {
          message: 'Asset not found: missing.md',
          availableAssets: ['a.md', 'b.md']
        },
        'get_agent_asset'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should map ASSET_NOT_FOUND with an empty availableAssets when none are provided', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering', name: 'missing.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Asset not found: missing.md');
      notFoundError.code = 'ASSET_NOT_FOUND';
      // availableAssets intentionally undefined
      Services.AgentAssets.get.mockRejectedValue(notFoundError);

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'ASSET_NOT_FOUND',
        {
          message: 'Asset not found: missing.md',
          availableAssets: []
        },
        'get_agent_asset'
      );
      expect(result.success).toBe(false);
    });

    test('should map a strict-bucket INVALID_INPUT service error to INVALID_INPUT with invalidBuckets', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: { assetType: 'steering', name: 'guidelines.md', s3Buckets: ['unconfigured-bucket'] }
        }
      };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const bucketError = new Error('Unconfigured bucket(s): unconfigured-bucket');
      bucketError.code = 'INVALID_INPUT';
      bucketError.invalidBuckets = ['unconfigured-bucket'];
      Services.AgentAssets.get.mockRejectedValue(bucketError);

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        {
          message: 'Unconfigured bucket(s): unconfigured-bucket',
          invalidBuckets: ['unconfigured-bucket']
        },
        'get_agent_asset'
      );
      expect(result.success).toBe(false);
    });

    test('should return INTERNAL_ERROR for an unexpected service error', async () => {
      // Arrange
      const props = { bodyParameters: { input: { assetType: 'steering', name: 'guidelines.md' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('Network timeout');
      Services.AgentAssets.get.mockRejectedValue(serviceError);

      // Act
      const result = await AgentAssetsController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to retrieve agent asset',
          error: 'Network timeout'
        }),
        'get_agent_asset'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('listTypes()', () => {
    test('should return INVALID_INPUT when validation fails and never call the service', async () => {
      // Arrange
      const props = { bodyParameters: { input: { unexpected: true } } };
      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'unexpected', message: 'Unknown property' }]
      });

      // Act
      const result = await AgentAssetsController.listTypes(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_agent_asset_types', props.bodyParameters.input);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({ message: 'Input validation failed' }),
        'list_agent_asset_types'
      );
      expect(Services.AgentAssets.listTypes).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should return a success envelope wrapping the service result as { types }', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockTypes = [
        { name: 'steering', folder: 'steering', description: 'Steering docs', assetCount: 3 },
        { name: 'hooks', folder: 'hooks', description: 'Agent hooks', assetCount: 1 },
        { name: 'agents-md', folder: 'agents_md', description: 'AGENTS.md files', assetCount: 0 }
      ];
      Services.AgentAssets.listTypes.mockResolvedValue(mockTypes);

      // Act
      const result = await AgentAssetsController.listTypes(props);

      // Assert
      expect(Services.AgentAssets.listTypes).toHaveBeenCalled();
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_agent_asset_types', {
        types: mockTypes
      });
      expect(result.success).toBe(true);
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.AgentAssets.listTypes.mockResolvedValue([]);

      // Act
      const result = await AgentAssetsController.listTypes(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_agent_asset_types', {});
      expect(result.success).toBe(true);
    });

    test('should return INTERNAL_ERROR for an unexpected service error', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('Configuration error');
      Services.AgentAssets.listTypes.mockRejectedValue(serviceError);

      // Act
      const result = await AgentAssetsController.listTypes(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list agent asset types',
          error: 'Configuration error'
        }),
        'list_agent_asset_types'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
