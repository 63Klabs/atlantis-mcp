/**
 * JSON Schema Validator for MCP Tool Inputs
 *
 * Validates MCP tool inputs against JSON Schema definitions to ensure
 * proper parameter types, required fields, and valid values.
 *
 * @module schema-validator
 */

const settings = require('../config/settings');
const TEMPLATE_CATEGORIES = settings.templates.categories;

/**
 * JSON Schema definitions for all MCP tools
 */
const schemas = {
  /**
   * Schema for list_templates tool input
   * Lists all available CloudFormation templates from configured S3 buckets
   */
  list_templates: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: TEMPLATE_CATEGORIES.map(cat => cat.name),
        description: 'Filter templates by category'
      },
      version: {
        type: 'string',
        pattern: '^v\\d+\\.\\d+\\.\\d+$',
        description: 'Filter by Human_Readable_Version (e.g., v1.2.3)'
      },
      versionId: {
        type: 'string',
        description: 'Filter by S3_VersionId'
      },
      s3Buckets: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 3,
          maxLength: 63
        },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    additionalProperties: false
  },

  /**
   * Schema for get_template tool input
   * Retrieves a specific CloudFormation template with full metadata
   */
  get_template: {
    type: 'object',
    properties: {
      templateName: {
        type: 'string',
        minLength: 1,
        description: 'Name of the template to retrieve'
      },
      category: {
        type: 'string',
        enum: TEMPLATE_CATEGORIES.map(cat => cat.name),
        description: 'Template category'
      },
      version: {
        type: 'string',
        pattern: '^v\\d+\\.\\d+\\.\\d+$',
        description: 'Human_Readable_Version (e.g., v1.2.3)'
      },
      versionId: {
        type: 'string',
        description: 'S3_VersionId for specific version'
      },
      s3Buckets: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 3,
          maxLength: 63
        },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    required: ['templateName'],
    additionalProperties: false
  },

  /**
   * Schema for list_template_versions tool input
   * Lists all versions of a specific template
   */
  list_template_versions: {
    type: 'object',
    properties: {
      templateName: {
        type: 'string',
        minLength: 1,
        description: 'Name of the template'
      },
      category: {
        type: 'string',
        enum: TEMPLATE_CATEGORIES.map(cat => cat.name),
        description: 'Template category'
      },
      s3Buckets: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 3,
          maxLength: 63
        },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    required: ['templateName'],
    additionalProperties: false
  },

  /**
   * Schema for list_categories tool input
   * Lists all available template categories
   */
  list_categories: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },

  /**
   * Schema for list_starters tool input
   * Lists all available starter code repositories from configured S3 buckets
   */
  list_starters: {
    type: 'object',
    properties: {
      s3Buckets: {
        type: 'array',
        items: { type: 'string', minLength: 3, maxLength: 63 },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    additionalProperties: false
  },

  /**
   * Schema for get_starter_info tool input
   * Retrieves detailed information about a specific starter from configured S3 buckets
   */
  get_starter_info: {
    type: 'object',
    properties: {
      starterName: {
        type: 'string',
        minLength: 1,
        description: 'Name of the starter repository'
      },
      s3Buckets: {
        type: 'array',
        items: { type: 'string', minLength: 3, maxLength: 63 },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    required: ['starterName'],
    additionalProperties: false
  },

  /**
   * Schema for search_documentation tool input
   * Searches Atlantis documentation and code patterns
   */
  search_documentation: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description: 'Search query keywords'
      },
      type: {
        type: 'string',
        enum: ['guide', 'tutorial', 'reference', 'troubleshooting', 'template pattern', 'code example'],
        description: 'Filter by documentation type'
      },
      ghusers: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1
        },
        minItems: 1,
        description: 'Filter to specific GitHub users/orgs from configured list'
      }
    },
    required: ['query'],
    additionalProperties: false
  },

  /**
   * Schema for validate_naming tool input
   * Validates resource names against Atlantis naming conventions
   */
  validate_naming: {
    type: 'object',
    properties: {
      resourceName: {
        type: 'string',
        minLength: 1,
        description: 'Resource name to validate'
      },
      resourceType: {
        type: 'string',
        enum: ['application', 's3', 'dynamodb', 'lambda', 'cloudformation'],
        description: 'Type of AWS resource'
      }
    },
    required: ['resourceName'],
    additionalProperties: false
  },

  /**
   * Schema for check_template_updates tool input
   * Checks if newer versions of templates are available
   */
  check_template_updates: {
    type: 'object',
    properties: {
      templateName: {
        type: 'string',
        minLength: 1,
        description: 'Name of the template to check'
      },
      currentVersion: {
        type: 'string',
        pattern: '^v\\d+\\.\\d+\\.\\d+$',
        description: 'Current Human_Readable_Version (e.g., v1.2.3)'
      },
      category: {
        type: 'string',
        enum: TEMPLATE_CATEGORIES.map(cat => cat.name),
        description: 'Template category'
      },
      s3Buckets: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 3,
          maxLength: 63
        },
        minItems: 1,
        description: 'Filter to specific S3 buckets from configured list'
      },
      namespace: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        maxLength: 63,
        description: 'Filter to a specific namespace (S3 root prefix)'
      }
    },
    required: ['templateName', 'currentVersion'],
    additionalProperties: false
  },

  /**
   * Schema for list_tools tool input - Lists all available MCP tools
   */
  list_tools: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
};

/**
 * Validate input against a JSON Schema
 *
 * @param {string} toolName - Name of the MCP tool
 * @param {Object} input - Input data to validate
 * @returns {{valid: boolean, errors: Array<string>}} Validation result
 *
 * @example
 * const result = validate('list_templates', { category: 'storage' });
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
const validate = (toolName, input) => {
  const schema = schemas[toolName];

  if (!schema) {
    return {
      valid: false,
      errors: [`Unknown tool: ${toolName}`]
    };
  }

  const errors = [];

  // Validate input is an object
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    errors.push('Input must be an object');
    return { valid: false, errors };
  }

  // Check required properties
  if (schema.required) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in input)) {
        errors.push(`Missing required property: ${requiredProp}`);
      }
    }
  }

  // Check for additional properties
  if (schema.additionalProperties === false) {
    const allowedProps = Object.keys(schema.properties || {});
    for (const prop of Object.keys(input)) {
      if (!allowedProps.includes(prop)) {
        errors.push(`Unknown property: ${prop}`);
      }
    }
  }

  // Validate each property
  for (const [propName, propValue] of Object.entries(input)) {
    const propSchema = schema.properties[propName];

    if (!propSchema) {
      continue; // Already handled by additionalProperties check
    }

    // Validate type
    if (propSchema.type) {
      const actualType = Array.isArray(propValue) ? 'array' : typeof propValue;
      if (actualType !== propSchema.type) {
        errors.push(`Property '${propName}' must be of type ${propSchema.type}, got ${actualType}`);
        continue;
      }
    }

    // Validate enum
    if (propSchema.enum && !propSchema.enum.includes(propValue)) {
      errors.push(`Property '${propName}' must be one of: ${propSchema.enum.join(', ')}`);
    }

    // Validate pattern (for strings)
    if (propSchema.pattern && typeof propValue === 'string') {
      const regex = new RegExp(propSchema.pattern);
      if (!regex.test(propValue)) {
        errors.push(`Property '${propName}' does not match required pattern: ${propSchema.pattern}`);
      }
    }

    // Validate minLength (for strings)
    if (propSchema.minLength !== undefined && typeof propValue === 'string') {
      if (propValue.length < propSchema.minLength) {
        errors.push(`Property '${propName}' must be at least ${propSchema.minLength} characters long`);
      }
    }

    // Validate maxLength (for strings)
    if (propSchema.maxLength !== undefined && typeof propValue === 'string') {
      if (propValue.length > propSchema.maxLength) {
        errors.push(`Property '${propName}' must be at most ${propSchema.maxLength} characters long`);
      }
    }

    // Validate array items
    if (propSchema.type === 'array' && Array.isArray(propValue)) {
      // Validate minItems
      if (propSchema.minItems !== undefined && propValue.length < propSchema.minItems) {
        errors.push(`Property '${propName}' must have at least ${propSchema.minItems} items`);
      }

      // Validate maxItems
      if (propSchema.maxItems !== undefined && propValue.length > propSchema.maxItems) {
        errors.push(`Property '${propName}' must have at most ${propSchema.maxItems} items`);
      }

      // Validate each item
      if (propSchema.items) {
        propValue.forEach((item, index) => {
          // Validate item type
          if (propSchema.items.type) {
            const itemType = Array.isArray(item) ? 'array' : typeof item;
            if (itemType !== propSchema.items.type) {
              errors.push(`Property '${propName}[${index}]' must be of type ${propSchema.items.type}, got ${itemType}`);
            }
          }

          // Validate item minLength
          if (propSchema.items.minLength !== undefined && typeof item === 'string') {
            if (item.length < propSchema.items.minLength) {
              errors.push(`Property '${propName}[${index}]' must be at least ${propSchema.items.minLength} characters long`);
            }
          }

          // Validate item maxLength
          if (propSchema.items.maxLength !== undefined && typeof item === 'string') {
            if (item.length > propSchema.items.maxLength) {
              errors.push(`Property '${propName}[${index}]' must be at most ${propSchema.items.maxLength} characters long`);
            }
          }
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Get the JSON Schema for a specific tool
 *
 * @param {string} toolName - Name of the MCP tool
 * @returns {Object|null} JSON Schema or null if tool not found
 *
 * @example
 * const schema = getSchema('list_templates');
 * console.log(schema.properties);
 */
const getSchema = (toolName) => {
  return schemas[toolName] || null;
};

/**
 * Get all available tool names
 *
 * @returns {Array<string>} List of tool names
 *
 * @example
 * const tools = getToolNames();
 * console.log('Available tools:', tools);
 */
const getToolNames = () => {
  return Object.keys(schemas);
};

module.exports = {
  validate,
  getSchema,
  getToolNames,
  schemas
};
