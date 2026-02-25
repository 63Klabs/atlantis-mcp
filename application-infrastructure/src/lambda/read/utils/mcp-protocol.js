/**
 * MCP Protocol Utilities
 * 
 * Provides utilities for implementing the Model Context Protocol (MCP) v1.0 specification.
 * Includes functions for creating protocol-compliant responses, error handling, protocol
 * negotiation, and capability discovery.
 * 
 * @module mcp-protocol
 */

/**
 * MCP Protocol Version
 * @constant {string}
 */
const MCP_VERSION = '1.0';

/**
 * MCP Protocol Capabilities
 * @constant {Object}
 */
const MCP_CAPABILITIES = {
  tools: true,
  resources: false,
  prompts: false,
  sampling: false
};

/**
 * MCP Tool Definitions
 * @constant {Array<Object>}
 */
const MCP_TOOLS = [
  {
    name: 'list_templates',
    description: 'List all available CloudFormation templates from configured S3 buckets. Returns template metadata including name, version, category, description, namespace, and S3 location.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by template category (Storage, Network, Pipeline, Service Role, Modules)',
          enum: ['Storage', 'Network', 'Pipeline', 'Service Role', 'Modules']
        },
        version: {
          type: 'string',
          description: 'Filter by Human_Readable_Version (e.g., v1.2.3/2024-01-15)'
        },
        versionId: {
          type: 'string',
          description: 'Filter by S3_VersionId'
        },
        s3Buckets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific S3 buckets from configured list'
        }
      }
    }
  },
  {
    name: 'get_template',
    description: 'Retrieve a specific CloudFormation template with full content and metadata. Returns template content, parameters, outputs, version information, and S3 location.',
    inputSchema: {
      type: 'object',
      properties: {
        templateName: {
          type: 'string',
          description: 'Name of the template to retrieve'
        },
        category: {
          type: 'string',
          description: 'Template category',
          enum: ['Storage', 'Network', 'Pipeline', 'Service Role', 'Modules']
        },
        version: {
          type: 'string',
          description: 'Human_Readable_Version (e.g., v1.2.3/2024-01-15)'
        },
        versionId: {
          type: 'string',
          description: 'S3_VersionId for specific version'
        },
        s3Buckets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific S3 buckets from configured list'
        }
      },
      required: ['templateName', 'category']
    }
  },
  {
    name: 'list_template_versions',
    description: 'List all versions of a specific CloudFormation template. Returns version history with Human_Readable_Version, S3_VersionId, last modified date, and size.',
    inputSchema: {
      type: 'object',
      properties: {
        templateName: {
          type: 'string',
          description: 'Name of the template'
        },
        category: {
          type: 'string',
          description: 'Template category',
          enum: ['Storage', 'Network', 'Pipeline', 'Service Role', 'Modules']
        },
        s3Buckets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific S3 buckets from configured list'
        }
      },
      required: ['templateName', 'category']
    }
  },
  {
    name: 'list_categories',
    description: 'List all available template categories with descriptions and template counts. Returns category names, descriptions, and number of templates in each category.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_starters',
    description: 'List all available starter code repositories. Returns starter metadata including name, description, language, framework, features, and GitHub URL.',
    inputSchema: {
      type: 'object',
      properties: {
        ghusers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific GitHub users/orgs from configured list'
        }
      }
    }
  },
  {
    name: 'get_starter_info',
    description: 'Retrieve detailed information about a specific starter code repository. Returns comprehensive metadata, example code snippets, and setup instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        starterName: {
          type: 'string',
          description: 'Name of the starter repository'
        },
        ghusers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific GitHub users/orgs from configured list'
        }
      },
      required: ['starterName']
    }
  },
  {
    name: 'search_documentation',
    description: 'Search Atlantis documentation, tutorials, and code patterns. Returns search results with title, excerpt, file path, GitHub URL, and result type (documentation or code example).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query keywords'
        },
        type: {
          type: 'string',
          description: 'Filter by result type',
          enum: ['guide', 'tutorial', 'reference', 'troubleshooting', 'template pattern', 'code example']
        },
        ghusers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific GitHub users/orgs from configured list'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'validate_naming',
    description: 'Validate resource names against Atlantis naming conventions. Returns validation result with specific error messages and suggestions for invalid names.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceName: {
          type: 'string',
          description: 'Resource name to validate'
        },
        resourceType: {
          type: 'string',
          description: 'Type of AWS resource',
          enum: ['application', 's3', 'dynamodb', 'lambda', 'cloudformation']
        }
      },
      required: ['resourceName']
    }
  },
  {
    name: 'check_template_updates',
    description: 'Check if CloudFormation templates have newer versions available. Returns update information including version, release date, changelog, and migration guide links for breaking changes.',
    inputSchema: {
      type: 'object',
      properties: {
        templateName: {
          type: 'string',
          description: 'Name of the template to check'
        },
        category: {
          type: 'string',
          description: 'Template category',
          enum: ['Storage', 'Network', 'Pipeline', 'Service Role', 'Modules']
        },
        currentVersion: {
          type: 'string',
          description: 'Current Human_Readable_Version (e.g., v1.2.3/2024-01-15)'
        },
        s3Buckets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific S3 buckets from configured list'
        }
      },
      required: ['templateName', 'category', 'currentVersion']
    }
  }
];

/**
 * Create a successful MCP protocol response
 * 
 * @param {string} toolName - Name of the MCP tool that was invoked
 * @param {*} data - Response data (will be serialized to JSON)
 * @returns {Object} MCP-compliant success response
 * @example
 * const response = successResponse('list_templates', [
 *   { name: 'template-storage-s3.yml', version: 'v1.2.3/2024-01-15' }
 * ]);
 */
function successResponse(toolName, data) {
  return {
    protocol: 'mcp',
    version: MCP_VERSION,
    tool: toolName,
    success: true,
    data: data,
    timestamp: new Date().toISOString()
  };
}

/**
 * Create an error MCP protocol response
 * 
 * @param {string} errorCode - Error code (e.g., 'INVALID_INPUT', 'TEMPLATE_NOT_FOUND')
 * @param {string|Object} errorDetails - Error message or detailed error object
 * @param {string} [toolName] - Name of the MCP tool that was invoked (optional)
 * @returns {Object} MCP-compliant error response
 * @example
 * const response = errorResponse('TEMPLATE_NOT_FOUND', {
 *   message: 'Template not found: template-storage-s3.yml',
 *   availableTemplates: ['template-storage-s3-v2.yml', 'template-network.yml']
 * }, 'get_template');
 */
function errorResponse(errorCode, errorDetails, toolName = null) {
  const response = {
    protocol: 'mcp',
    version: MCP_VERSION,
    success: false,
    error: {
      code: errorCode,
      details: typeof errorDetails === 'string' ? { message: errorDetails } : errorDetails
    },
    timestamp: new Date().toISOString()
  };

  if (toolName) {
    response.tool = toolName;
  }

  return response;
}

/**
 * Negotiate MCP protocol version with client
 * 
 * @param {string} clientVersion - Version requested by client
 * @returns {Object} Protocol negotiation response
 * @example
 * const negotiation = negotiateProtocol('1.0');
 * // Returns: { accepted: true, version: '1.0', capabilities: {...} }
 */
function negotiateProtocol(clientVersion) {
  // Currently only support version 1.0
  const supportedVersions = ['1.0'];
  const accepted = supportedVersions.includes(clientVersion);

  return {
    protocol: 'mcp',
    accepted: accepted,
    version: accepted ? clientVersion : MCP_VERSION,
    supportedVersions: supportedVersions,
    capabilities: accepted ? MCP_CAPABILITIES : null,
    message: accepted 
      ? `Protocol version ${clientVersion} accepted`
      : `Protocol version ${clientVersion} not supported. Supported versions: ${supportedVersions.join(', ')}`
  };
}

/**
 * Get MCP server capabilities
 * 
 * @returns {Object} Server capabilities and available tools
 * @example
 * const capabilities = getCapabilities();
 * // Returns: { protocol: 'mcp', version: '1.0', capabilities: {...}, tools: [...] }
 */
function getCapabilities() {
  return {
    protocol: 'mcp',
    version: MCP_VERSION,
    capabilities: MCP_CAPABILITIES,
    tools: MCP_TOOLS,
    description: 'Atlantis MCP Server - Phase 1 (Core Read-Only)',
    vendor: '63Klabs',
    serverInfo: {
      name: 'atlantis-mcp-server',
      version: '0.0.1',
      phase: 'Phase 1 - Read-Only Operations'
    }
  };
}

/**
 * Get list of available MCP tools
 * 
 * @returns {Array<Object>} Array of tool definitions with names, descriptions, and input schemas
 * @example
 * const tools = listTools();
 * // Returns: [{ name: 'list_templates', description: '...', inputSchema: {...} }, ...]
 */
function listTools() {
  return MCP_TOOLS;
}

/**
 * Get definition for a specific MCP tool
 * 
 * @param {string} toolName - Name of the tool
 * @returns {Object|null} Tool definition or null if not found
 * @example
 * const tool = getTool('list_templates');
 * // Returns: { name: 'list_templates', description: '...', inputSchema: {...} }
 */
function getTool(toolName) {
  return MCP_TOOLS.find(tool => tool.name === toolName) || null;
}

/**
 * Validate that a tool name is supported
 * 
 * @param {string} toolName - Name of the tool to validate
 * @returns {boolean} True if tool is supported, false otherwise
 * @example
 * if (isValidTool('list_templates')) {
 *   // Process tool invocation
 * }
 */
function isValidTool(toolName) {
  return MCP_TOOLS.some(tool => tool.name === toolName);
}

module.exports = {
  // Constants
  MCP_VERSION,
  MCP_CAPABILITIES,
  MCP_TOOLS,
  
  // Response functions
  successResponse,
  errorResponse,
  
  // Protocol negotiation
  negotiateProtocol,
  
  // Capability discovery
  getCapabilities,
  listTools,
  getTool,
  isValidTool
};
