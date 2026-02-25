/**
 * MCP Response Formatter (Views Layer)
 * 
 * Provides formatting functions for MCP protocol responses with tool-specific
 * enhancements, descriptions, and usage examples. This layer sits between
 * controllers and the MCP protocol utilities to add presentation logic.
 * 
 * The views layer enhances responses with:
 * - Tool-specific formatting and structure
 * - Helpful descriptions for AI assistants
 * - Usage examples and guidance
 * - Metadata enrichment
 * 
 * @module views/mcp-response
 */

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Format tool response with tool-specific enhancements
 * 
 * This is the main entry point for formatting MCP responses. It delegates
 * to tool-specific formatters that add descriptions, examples, and structure
 * appropriate for each tool.
 * 
 * @param {string} toolName - Name of the MCP tool
 * @param {*} data - Response data from service layer
 * @param {Object} [metadata={}] - Additional metadata
 * @returns {Object} Enhanced response data ready for MCP protocol wrapper
 * 
 * @example
 * const formatted = formatToolResponse('list_templates', templates, {
 *   cached: true,
 *   executionTime: 45
 * });
 */
function formatToolResponse(toolName, data, metadata = {}) {
  try {
    // >! Delegate to tool-specific formatter
    switch (toolName) {
      case 'list_templates':
        return formatListTemplates(data, metadata);
      
      case 'get_template':
        return formatGetTemplate(data, metadata);
      
      case 'list_template_versions':
        return formatListTemplateVersions(data, metadata);
      
      case 'list_categories':
        return formatListCategories(data, metadata);
      
      case 'list_starters':
        return formatListStarters(data, metadata);
      
      case 'get_starter_info':
        return formatGetStarterInfo(data, metadata);
      
      case 'search_documentation':
        return formatSearchDocumentation(data, metadata);
      
      case 'validate_naming':
        return formatValidateNaming(data, metadata);
      
      case 'check_template_updates':
        return formatCheckTemplateUpdates(data, metadata);
      
      default:
        // >! Return data as-is for unknown tools
        DebugAndLog.warn(`No specific formatter for tool: ${toolName}`);
        return data;
    }
  } catch (error) {
    DebugAndLog.error(`Error formatting response for ${toolName}:`, error);
    // >! Return original data on formatting error
    return data;
  }
}

/**
 * Format list_templates response
 * 
 * Enhances template list with helpful descriptions and usage guidance.
 * Includes information about partial data scenarios and brown-out support.
 * 
 * @param {Object} data - Template list data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatListTemplates(data, metadata) {
  const { templates = [], errors = [], partialData = false } = data;
  
  return {
    description: 'CloudFormation templates available in the Atlantis platform. Use get_template to retrieve full template content and parameters.',
    templates: templates.map(template => ({
      name: template.name,
      version: template.version || 'unknown',
      versionId: template.versionId,
      category: template.category,
      namespace: template.namespace,
      bucket: template.bucket,
      description: template.description || `${template.category} template: ${template.name}`,
      s3Path: template.s3Path,
      lastModified: template.lastModified,
      size: template.size
    })),
    count: templates.length,
    partialData: partialData,
    errors: errors.length > 0 ? errors : undefined,
    usage: {
      nextSteps: [
        'Use get_template with templateName and category to retrieve full template content',
        'Use list_template_versions to see version history',
        'Filter by category to narrow results'
      ],
      example: 'get_template with templateName="template-storage-s3-artifacts" and category="Storage"'
    },
    metadata: {
      ...metadata,
      brownOutSupport: errors.length > 0 ? 'Some sources failed but available data is returned' : undefined
    }
  };
}

/**
 * Format get_template response
 * 
 * Enhances template details with parameter descriptions and usage guidance.
 * Provides context about template structure and deployment.
 * 
 * @param {Object} data - Template data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatGetTemplate(data, metadata) {
  return {
    description: `CloudFormation template: ${data.name} (${data.category})`,
    template: {
      name: data.name,
      version: data.version,
      versionId: data.versionId,
      category: data.category,
      namespace: data.namespace,
      bucket: data.bucket,
      description: data.description,
      content: data.content,
      s3Path: data.s3Path,
      lastModified: data.lastModified,
      size: data.size
    },
    parameters: data.parameters || [],
    outputs: data.outputs || [],
    usage: {
      deployment: 'Deploy using Atlantis SAM configuration scripts',
      namingConvention: 'Resources follow Prefix-ProjectId-StageId-ResourceName pattern',
      nextSteps: [
        'Review parameters and provide values for your deployment',
        'Use validate_naming to verify resource names',
        'Check for updates with check_template_updates'
      ]
    },
    metadata: metadata
  };
}

/**
 * Format list_template_versions response
 * 
 * Enhances version history with helpful context about version identifiers
 * and how to retrieve specific versions.
 * 
 * @param {Object} data - Version history data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatListTemplateVersions(data, metadata) {
  const { templateName, category, versions = [], namespace, bucket } = data;
  
  return {
    description: `Version history for ${templateName} (${category})`,
    templateName: templateName,
    category: category,
    namespace: namespace,
    bucket: bucket,
    versions: versions.map(v => ({
      version: v.version,
      versionId: v.versionId,
      lastModified: v.lastModified,
      size: v.size,
      author: v.author || 'Unknown',
      isLatest: v.isLatest || false
    })),
    count: versions.length,
    usage: {
      versionIdentifiers: 'Use either version (Human_Readable_Version) or versionId (S3_VersionId) with get_template',
      orCondition: 'When both version and versionId are provided, they are treated as OR condition',
      example: 'get_template with version="v2.0.5/2026-01-07" OR versionId="abc123"'
    },
    metadata: metadata
  };
}

/**
 * Format list_categories response
 * 
 * Enhances category list with descriptions and guidance on category usage.
 * 
 * @param {Object} data - Categories data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatListCategories(data, metadata) {
  const { categories = [] } = data;
  
  return {
    description: 'Template categories in the Atlantis platform. Each category represents a different type of infrastructure component.',
    categories: categories.map(cat => ({
      name: cat.name,
      description: cat.description,
      templateCount: cat.templateCount || 0,
      examples: cat.examples || []
    })),
    count: categories.length,
    usage: {
      filtering: 'Use category parameter in list_templates to filter results',
      required: 'Category is required when using get_template',
      examples: [
        'Storage: S3 buckets, DynamoDB tables',
        'Network: CloudFront, Route53, API Gateway',
        'Pipeline: CodePipeline, CodeBuild',
        'Service Role: IAM roles and policies',
        'Modules: Reusable CloudFormation definitions'
      ]
    },
    metadata: metadata
  };
}

/**
 * Format list_starters response
 * 
 * Enhances starter list with feature highlights and integration information.
 * 
 * @param {Object} data - Starters data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatListStarters(data, metadata) {
  const { starters = [], errors = [], partialData = false } = data;
  
  return {
    description: 'Starter code repositories for bootstrapping serverless applications with Atlantis platform integration.',
    starters: starters.map(starter => ({
      name: starter.name,
      description: starter.description,
      language: starter.language,
      framework: starter.framework,
      features: starter.features || [],
      githubUrl: starter.githubUrl,
      namespace: starter.namespace,
      hasCacheData: starter.features?.includes('cache-data') || false,
      hasCloudFront: starter.features?.includes('cloudfront') || false
    })),
    count: starters.length,
    partialData: partialData,
    errors: errors.length > 0 ? errors : undefined,
    usage: {
      nextSteps: [
        'Use get_starter_info to retrieve detailed information and example code',
        'Clone repository from GitHub URL to get started',
        'Review prerequisites before using starter'
      ],
      integration: 'Starters include Atlantis platform integration and follow naming conventions'
    },
    metadata: {
      ...metadata,
      brownOutSupport: errors.length > 0 ? 'Some sources failed but available data is returned' : undefined
    }
  };
}

/**
 * Format get_starter_info response
 * 
 * Enhances starter details with setup guidance and feature explanations.
 * 
 * @param {Object} data - Starter info data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatGetStarterInfo(data, metadata) {
  return {
    description: `Starter repository: ${data.name} (${data.language})`,
    starter: {
      name: data.name,
      description: data.description,
      language: data.language,
      framework: data.framework,
      features: data.features || [],
      prerequisites: data.prerequisites || [],
      author: data.author,
      license: data.license,
      githubUrl: data.githubUrl,
      namespace: data.namespace,
      bucket: data.bucket,
      repositoryType: data.repositoryType
    },
    readme: data.readme,
    latestRelease: data.latestRelease,
    stats: data.stats,
    codeExamples: data.codeExamples || [],
    usage: {
      setup: [
        'Clone repository from GitHub URL',
        'Install prerequisites listed above',
        'Follow README instructions for configuration',
        'Deploy using Atlantis SAM configuration scripts'
      ],
      features: {
        'cache-data': 'Includes @63klabs/cache-data package for caching and routing',
        'cloudfront': 'Includes CloudFront integration for content delivery'
      }
    },
    metadata: {
      ...metadata,
      sidecarMetadata: data.sidecarMetadata || false,
      isPrivate: data.isPrivate || false
    }
  };
}

/**
 * Format search_documentation response
 * 
 * Enhances search results with result type explanations and navigation guidance.
 * 
 * @param {Object} data - Search results data from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatSearchDocumentation(data, metadata) {
  const { results = [], suggestions = [], query } = data;
  
  return {
    description: `Search results for: "${query}"`,
    results: results.map(result => ({
      title: result.title,
      excerpt: result.excerpt,
      filePath: result.filePath,
      githubUrl: result.githubUrl,
      type: result.type,
      subType: result.subType,
      relevanceScore: result.relevanceScore,
      repository: result.repository,
      repositoryType: result.repositoryType,
      namespace: result.namespace,
      codeExamples: result.codeExamples || [],
      context: result.context
    })),
    count: results.length,
    suggestions: suggestions,
    usage: {
      resultTypes: {
        'documentation': 'Markdown documentation files (guides, tutorials, references)',
        'template-pattern': 'CloudFormation template patterns and resource definitions',
        'code-example': 'Code snippets from starter repositories'
      },
      navigation: 'Use githubUrl to view full document or code in GitHub',
      refinement: suggestions.length > 0 ? 'Try suggested search terms for better results' : undefined
    },
    metadata: {
      ...metadata,
      query: query
    }
  };
}

/**
 * Format validate_naming response
 * 
 * Enhances validation results with detailed explanations and correction suggestions.
 * 
 * @param {Object} data - Validation results from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatValidateNaming(data, metadata) {
  const { valid, resourceName, components, resourceType, suggestions = [] } = data;
  
  return {
    description: valid 
      ? `Resource name "${resourceName}" is valid`
      : `Resource name "${resourceName}" is invalid`,
    valid: valid,
    resourceName: resourceName,
    resourceType: resourceType,
    components: components,
    suggestions: suggestions,
    usage: {
      namingConvention: {
        application: 'Prefix-ProjectId-StageId-ResourceName (all components required)',
        s3: 'orgPrefix-Prefix-ProjectId-StageId-Region-AccountId (StageId optional)',
        s3Alternative: 'orgPrefix-Prefix-ProjectId-Region (without AccountId)'
      },
      examples: {
        application: 'acme-person-api-test-GetPersonFunction',
        s3: 'acme-myapp-userdata-test-us-east-1-123456789012',
        s3Alternative: 'acme-myapp-userdata-us-east-1'
      },
      nextSteps: valid 
        ? ['Use this name in your CloudFormation templates']
        : ['Review suggestions above', 'Correct invalid components', 'Validate again']
    },
    metadata: metadata
  };
}

/**
 * Format check_template_updates response
 * 
 * Enhances update check results with migration guidance and change summaries.
 * 
 * @param {Object} data - Update check results from service
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatCheckTemplateUpdates(data, metadata) {
  const {
    templateName,
    currentVersion,
    currentVersionId,
    latestVersion,
    latestVersionId,
    releaseDate,
    changelogSummary,
    breakingChanges,
    migrationGuideUrl,
    updateAvailable,
    namespace,
    bucket
  } = data;
  
  return {
    description: updateAvailable
      ? `Update available for ${templateName}: ${currentVersion} → ${latestVersion}`
      : `${templateName} is up to date (${currentVersion})`,
    templateName: templateName,
    currentVersion: currentVersion,
    currentVersionId: currentVersionId,
    latestVersion: latestVersion,
    latestVersionId: latestVersionId,
    updateAvailable: updateAvailable,
    releaseDate: releaseDate,
    changelogSummary: changelogSummary,
    breakingChanges: breakingChanges || false,
    migrationGuideUrl: migrationGuideUrl,
    namespace: namespace,
    bucket: bucket,
    usage: {
      updating: updateAvailable ? [
        'Review changelog summary above',
        breakingChanges ? 'IMPORTANT: This update has breaking changes - review migration guide' : 'No breaking changes',
        'Use get_template with version or versionId to retrieve new version',
        'Test in non-production environment first'
      ] : ['No action needed - template is current'],
      migrationGuide: breakingChanges && migrationGuideUrl 
        ? `Migration guide: ${migrationGuideUrl}`
        : undefined,
      deprecation: breakingChanges 
        ? 'Old version will be supported for 24 months from new version release date'
        : undefined
    },
    metadata: metadata
  };
}

module.exports = {
  formatToolResponse,
  
  // Export individual formatters for testing
  formatListTemplates,
  formatGetTemplate,
  formatListTemplateVersions,
  formatListCategories,
  formatListStarters,
  formatGetStarterInfo,
  formatSearchDocumentation,
  formatValidateNaming,
  formatCheckTemplateUpdates
};
