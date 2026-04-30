/**
 * S3 Templates Data Access Object
 *
 * Handles retrieval of CloudFormation templates from multiple S3 buckets with:
 * - Multi-bucket support with priority ordering
 * - Namespace discovery and indexing
 * - Template versioning (Human_Readable_Version and S3_VersionId)
 * - Brown-out support (continue on bucket failures)
 * - Bucket access validation via tags
 *
 * @module models/s3-templates
 */

const { GetObjectCommand, ListObjectsV2Command, ListObjectVersionsCommand, GetObjectTaggingCommand } = require('@aws-sdk/client-s3');
const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');
const yaml = require('js-yaml');
const ErrorHandler = require('../utils/error-handler');

/**
 * Check if a bucket has the atlantis-mcp:Allow=true tag
 *
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<boolean>} True if bucket has Allow tag set to true
 */
async function checkBucketAccess(bucketName) {
  try {
    const command = new GetObjectTaggingCommand({
      Bucket: bucketName,
      Key: '' // Bucket-level tags
    });

    // Note: Bucket tags require GetBucketTagging permission
    // For now, we'll assume access is allowed if bucket exists
    // TODO: Implement proper bucket tagging check when permissions are configured
    return true;
  } catch (error) {
    // >! Log S3 operation failures with bucket name, key, error details
    ErrorHandler.logS3Error({
      operation: 'GetObjectTagging',
      bucket: bucketName,
      key: '',
      error
    });
    return false;
  }
}

/**
 * Get indexed namespaces from bucket's atlantis-mcp:IndexPriority tag
 *
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<Array<string>>} Array of namespace names in priority order
 */
async function getIndexedNamespaces(bucketName) {
  try {
    // TODO: Implement bucket tag reading when permissions are configured
    // For now, discover namespaces by listing root-level directories
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Delimiter: '/',
      MaxKeys: 100
    });

    const response = await AWS.s3.client.send(command);
    const namespaces = (response.CommonPrefixes || [])
      .map(prefix => prefix.Prefix.replace(/\/$/, ''))
      .filter(ns => ns.length > 0);

    DebugAndLog.debug(`Discovered namespaces in ${bucketName}: ${namespaces.join(', ')}`);
    return namespaces;
  } catch (error) {
    // >! Log S3 operation failures with bucket name, key, error details
    ErrorHandler.logS3Error({
      operation: 'ListObjectsV2',
      bucket: bucketName,
      error
    });
    return [];
  }
}

/**
 * Parse Human_Readable_Version from template comments
 * Format: # Version: vX.X.X/YYYY-MM-DD
 *
 * @param {string} templateContent - CloudFormation template content
 * @returns {string|null} Version string or null if not found
 */
function parseHumanReadableVersion(templateContent) {
  const versionMatch = templateContent.match(/^#\s*Version:\s*(v[\d.]+\/\d{4}-\d{2}-\d{2})/m);
  return versionMatch ? versionMatch[1] : null;
}

/**
 * Parse CloudFormation template structure
 *
 * @param {string} templateContent - CloudFormation template YAML content
 * @returns {Object} Parsed template with Parameters, Outputs, Description
 */
function parseCloudFormationTemplate(templateContent) {
  try {
    // Define custom types for CloudFormation intrinsic functions
    const cfnTypes = [
      new yaml.Type('!GetAtt', { kind: 'scalar', construct: data => ({ 'Fn::GetAtt': data }) }),
      new yaml.Type('!GetAtt', { kind: 'sequence', construct: data => ({ 'Fn::GetAtt': data }) }),
      new yaml.Type('!Ref', { kind: 'scalar', construct: data => ({ Ref: data }) }),
      new yaml.Type('!Sub', { kind: 'scalar', construct: data => ({ 'Fn::Sub': data }) }),
      new yaml.Type('!Sub', { kind: 'sequence', construct: data => ({ 'Fn::Sub': data }) }),
      new yaml.Type('!Join', { kind: 'sequence', construct: data => ({ 'Fn::Join': data }) }),
      new yaml.Type('!Select', { kind: 'sequence', construct: data => ({ 'Fn::Select': data }) }),
      new yaml.Type('!Split', { kind: 'sequence', construct: data => ({ 'Fn::Split': data }) }),
      new yaml.Type('!FindInMap', { kind: 'sequence', construct: data => ({ 'Fn::FindInMap': data }) }),
      new yaml.Type('!GetAZs', { kind: 'scalar', construct: data => ({ 'Fn::GetAZs': data }) }),
      new yaml.Type('!GetAZs', { kind: 'sequence', construct: data => ({ 'Fn::GetAZs': data }) }),
      new yaml.Type('!ImportValue', { kind: 'scalar', construct: data => ({ 'Fn::ImportValue': data }) }),
      new yaml.Type('!Base64', { kind: 'scalar', construct: data => ({ 'Fn::Base64': data }) }),
      new yaml.Type('!Cidr', { kind: 'sequence', construct: data => ({ 'Fn::Cidr': data }) }),
      new yaml.Type('!And', { kind: 'sequence', construct: data => ({ 'Fn::And': data }) }),
      new yaml.Type('!Equals', { kind: 'sequence', construct: data => ({ 'Fn::Equals': data }) }),
      new yaml.Type('!If', { kind: 'sequence', construct: data => ({ 'Fn::If': data }) }),
      new yaml.Type('!Not', { kind: 'sequence', construct: data => ({ 'Fn::Not': data }) }),
      new yaml.Type('!Or', { kind: 'sequence', construct: data => ({ 'Fn::Or': data }) }),
      new yaml.Type('!Condition', { kind: 'scalar', construct: data => ({ Condition: data }) })
    ];

    // Create custom schema with CloudFormation types (js-yaml 4.x uses new Schema constructor)
    const CFN_SCHEMA = new yaml.Schema({
      include: [yaml.DEFAULT_SCHEMA],
      explicit: cfnTypes
    });

    const template = yaml.load(templateContent, { schema: CFN_SCHEMA });

    return {
      version: parseHumanReadableVersion(templateContent),
      Description: template.Description || '',
      Parameters: template.Parameters || {},
      Outputs: template.Outputs || {},
      Resources: template.Resources || {},
      Metadata: template.Metadata || {}
    };
  } catch (error) {
    DebugAndLog.error(`Failed to parse CloudFormation template: ${error.message}`);
    return {
      version: null,
      Description: '',
      Parameters: {},
      Outputs: {},
      Resources: {},
      Metadata: {}
    };
  }
}

/**
 * Build S3 key for template
 *
 * @param {string} namespace - Namespace directory
 * @param {string} basePath - Base path (e.g., 'templates/v2')
 * @param {string} category - Template category
 * @param {string} templateName - Template name (without extension)
 * @param {string} extension - File extension (.yml or .yaml)
 * @returns {string} S3 object key
 */
function buildTemplateKey(namespace, basePath, category, templateName, extension = '.yml') {
  return `${namespace}/${basePath}/${category}/${templateName}${extension}`;
}

/**
 * Find the S3 key for a module template in any subdirectory.
 *
 * Issues a ListObjectsV2Command with prefix `{namespace}/{basePath}/modules/`
 * and filters results for objects whose filename matches
 * `{templateName}.yml` or `{templateName}.yaml`. Returns the first match
 * with the extracted subcategory (.yml is preferred over .yaml).
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} namespace - Namespace prefix
 * @param {string} basePath - Base path (e.g., 'templates/v2')
 * @param {string} templateName - Template name without extension
 * @returns {Promise<{key: string, subcategory: string, extension: string}|null>}
 *   The discovered key info, or null if not found
 * @example
 * const result = await findModuleTemplateKey('my-bucket', '63klabs', 'templates/v2', 'module-vpc-endpoints');
 * // result: { key: '63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml', subcategory: 'vpc', extension: '.yml' }
 */
async function findModuleTemplateKey(bucket, namespace, basePath, templateName) {
  const prefix = `${namespace}/${basePath}/modules/`;

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix
    });

    const response = await AWS.s3.client.send(command);
    const contents = response.Contents || [];

    // >! Filter for objects whose filename matches the template name with .yml or .yaml
    const ymlMatch = [];
    const yamlMatch = [];

    for (const obj of contents) {
      const keyParts = obj.Key.split('/');
      const fileName = keyParts[keyParts.length - 1];

      if (fileName === `${templateName}.yml`) {
        const subcategory = keyParts[keyParts.length - 2];
        ymlMatch.push({ key: obj.Key, subcategory, extension: '.yml' });
      } else if (fileName === `${templateName}.yaml`) {
        const subcategory = keyParts[keyParts.length - 2];
        yamlMatch.push({ key: obj.Key, subcategory, extension: '.yaml' });
      }
    }

    // >! Prefer .yml over .yaml
    if (ymlMatch.length > 0) {
      return ymlMatch[0];
    }
    if (yamlMatch.length > 0) {
      return yamlMatch[0];
    }

    return null;
  } catch (error) {
    ErrorHandler.logS3Error({
      operation: 'ListObjectsV2',
      bucket,
      key: prefix,
      error
    });
    return null;
  }
}

/**
 * Filter template by category
 *
 * @param {Object} template - Template metadata
 * @param {string} category - Category filter (optional)
 * @returns {boolean} True if template matches category filter
 */
function filterByCategory(template, category) {
  if (!category) {
    return true;
  }
  return template.category === category;
}

/**
 * Check if a template version matches a user-provided version filter.
 * Supports both exact match (vX.Y.Z/YYYY-MM-DD) and semver-only match (vX.Y.Z).
 * When the user provides a semver-only version, it matches any template whose
 * semver portion is identical regardless of the date suffix.
 *
 * @param {string} templateVersion - Full version from template (e.g., v0.0.14/2025-08-08)
 * @param {string} filterVersion - User-provided version filter (e.g., v0.0.14 or v0.0.14/2025-08-08)
 * @returns {boolean} True if versions match
 */
function versionsMatch(templateVersion, filterVersion) {
  if (templateVersion === filterVersion) {
    return true;
  }
  // >! Allow semver-only filter to match full Human_Readable_Version
  const filterSemver = filterVersion.split('/')[0];
  const templateSemver = templateVersion ? templateVersion.split('/')[0] : null;
  return filterSemver === templateSemver;
}

/**
 * Filter template by Human_Readable_Version
 *
 * @param {Object} template - Template metadata
 * @param {string} version - Version filter (optional)
 * @returns {boolean} True if template matches version filter
 */
function filterByVersion(template, version) {
  if (!version) {
    return true;
  }
  return versionsMatch(template.version, version);
}

/**
 * Filter template by S3_VersionId
 *
 * @param {Object} template - Template metadata
 * @param {string} versionId - S3 VersionId filter (optional)
 * @returns {boolean} True if template matches versionId filter
 */
function filterByVersionId(template, versionId) {
  if (!versionId) {
    return true;
  }
  return template.versionId === versionId;
}

/**
 * Deduplicate templates across buckets (first occurrence wins)
 *
 * Uses `category/subcategory/name` as the dedup key so that templates
 * with the same name in different subcategories are treated as distinct.
 *
 * @param {Array<Object>} templates - Array of template metadata
 * @returns {Array<Object>} Deduplicated templates
 */
function deduplicateTemplates(templates) {
  const seen = new Set();
  const deduplicated = [];

  for (const template of templates) {
    const key = `${template.category}/${template.subcategory || ''}/${template.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(template);
    }
  }

  return deduplicated;
}

/**
 * Parse template metadata from S3 object
 *
 * Detects nesting depth by finding the `templates/v2` segment in the key.
 * For keys with 2 segments after the base path (category/file), extracts
 * category using flat behavior. For keys with 3 segments
 * (category/subcategory/file), extracts both category and subcategory.
 *
 * @param {Object} s3Object - S3 object metadata with Key property
 * @param {string} bucketName - S3 bucket name
 * @param {string} namespace - Namespace
 * @returns {Object} Template metadata including:
 *   - name {string} - Template name without extension
 *   - category {string} - Template category (e.g., "modules")
 *   - subcategory {string|null} - Subcategory for nested templates, null for flat
 *   - namespace {string}
 *   - bucket {string}
 *   - s3Path {string}
 *   - key {string}
 *   - lastModified {Date}
 *   - size {number}
 */
function parseTemplateMetadata(s3Object, bucketName, namespace) {
  const keyParts = s3Object.Key.split('/');
  const fileName = keyParts[keyParts.length - 1];
  const name = fileName.replace(/\.(yml|yaml)$/, '');

  // Find the base path offset by locating 'templates' and 'v2' segments
  let baseOffset = -1;
  for (let i = 0; i < keyParts.length - 1; i++) {
    if (keyParts[i] === 'templates' && keyParts[i + 1] === 'v2') {
      baseOffset = i;
      break;
    }
  }

  let category;
  let subcategory = null;

  if (baseOffset >= 0) {
    // Count segments after 'templates/v2': 2 = flat, 3 = nested
    const segmentsAfterBase = keyParts.length - (baseOffset + 2);

    if (segmentsAfterBase === 3) {
      // Nested: {namespace}/templates/v2/{category}/{subcategory}/{file}
      category = keyParts[baseOffset + 2];
      subcategory = keyParts[baseOffset + 3];
    } else {
      // Flat: {namespace}/templates/v2/{category}/{file}
      category = keyParts[baseOffset + 2];
    }
  } else {
    // Fallback: use second-to-last segment as category (original behavior)
    category = keyParts[keyParts.length - 2];
  }

  return {
    name,
    category,
    subcategory,
    namespace,
    bucket: bucketName,
    s3Path: `s3://${bucketName}/${s3Object.Key}`,
    key: s3Object.Key,
    lastModified: s3Object.LastModified,
    size: s3Object.Size
  };
}

/**
 * List all templates from S3 buckets with brown-out support
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - S3 bucket name(s)
 * @param {string} connection.path - S3 object key prefix (e.g., "templates/v2")
 * @param {Object} connection.parameters - Query parameters
 * @param {string} connection.parameters.category - Template category filter
 * @param {Object} options - Reserved for future use (not in cache key)
 * @returns {Promise<Object>} { templates: Array, errors: Array, partialData: boolean }
 */
async function list(connection, options = {}) {
  const { category, namespace } = connection.parameters || {};
  const basePath = connection.path || 'templates/v2';

  // Ensure host is an array
  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  const allTemplates = [];
  const errors = [];

  // Iterate through buckets in priority order
  for (const bucket of buckets) {
    try {
      // >! Check if bucket has atlantis-mcp:Allow=true tag
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        // >! Log which specific bucket failed without exposing sensitive info
        DebugAndLog.warn(`Bucket ${bucket} does not have atlantis-mcp:Allow=true tag, skipping`);
        errors.push({
          source: bucket,
          sourceType: 's3',
          error: 'Bucket access not allowed',
          timestamp: new Date().toISOString()
        });
        continue;
      }

      // >! When namespace is provided, use it directly; otherwise discover all namespaces
      const namespaces = namespace
        ? [namespace]
        : await getIndexedNamespaces(bucket);
      if (namespaces.length === 0) {
        DebugAndLog.warn(`Bucket ${bucket} has no namespaces, skipping`);
        continue;
      }

      // List templates from each namespace
      for (const namespace of namespaces) {
        const prefix = `${namespace}/${basePath}/`;

        try {
          const command = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix
          });

          const response = await AWS.s3.client.send(command);

          // >! Parse template metadata from S3 keys
          // >! Support both .yml and .yaml extensions (.yml takes precedence)
          let templates = (response.Contents || [])
            .filter(obj => obj.Key.endsWith('.yml') || obj.Key.endsWith('.yaml'))
            .map(obj => parseTemplateMetadata(obj, bucket, namespace))
            .filter(t => filterByCategory(t, category));

          allTemplates.push(...templates);
        } catch (error) {
          // >! Brown-out support: log error but continue with other namespaces
          // >! Use DebugAndLog.warn for non-fatal errors (brown-out scenarios)
          ErrorHandler.logS3Error({
            operation: 'ListObjectsV2',
            bucket,
            key: prefix,
            error
          });
          errors.push({
            source: `${bucket}/${namespace}`,
            sourceType: 's3',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      // >! Brown-out support: log error but continue with other buckets
      // >! Use DebugAndLog.warn for non-fatal errors (brown-out scenarios)
      ErrorHandler.logS3Error({
        operation: 'ListTemplates',
        bucket,
        error
      });
      errors.push({
        source: bucket,
        sourceType: 's3',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // >! Deduplicate templates (first occurrence wins due to priority ordering)
  const uniqueTemplates = deduplicateTemplates(allTemplates);

  return {
    templates: uniqueTemplates,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
}

/**
 * Get specific template from S3 buckets with brown-out support
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - S3 bucket name(s)
 * @param {string} connection.path - S3 object key prefix
 * @param {Object} connection.parameters - Query parameters
 * @param {string} connection.parameters.category - Template category
 * @param {string} connection.parameters.templateName - Template name
 * @param {string} connection.parameters.version - Human_Readable_Version (optional)
 * @param {string} connection.parameters.versionId - S3 VersionId (optional)
 * @param {Object} options - Reserved for future use
 * @returns {Promise<Object|null>} Template details or null
 */
async function get(connection, options = {}) {
  const { category, templateName, version, versionId, namespace } = connection.parameters || {};
  const basePath = connection.path || 'templates/v2';

  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  // >! Search buckets in priority order
  for (const bucket of buckets) {
    try {
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        continue;
      }

      // >! When namespace is provided, use it directly; otherwise discover all namespaces
      const namespaces = namespace
        ? [namespace]
        : await getIndexedNamespaces(bucket);

      // >! Search namespaces in priority order
      for (const namespace of namespaces) {
        // >! For modules category, use findModuleTemplateKey() to discover the key
        // >! For flat categories, iterate over extensions and use buildTemplateKey()
        const keysToTry = [];

        if (category === 'modules') {
          const found = await findModuleTemplateKey(bucket, namespace, basePath, templateName);
          if (found) {
            keysToTry.push({ key: found.key, subcategory: found.subcategory });
          }
        } else {
          // >! Try .yml first, then .yaml for flat categories
          for (const extension of ['.yml', '.yaml']) {
            keysToTry.push({ key: buildTemplateKey(namespace, basePath, category, templateName, extension), subcategory: null });
          }
        }

        for (const { key, subcategory } of keysToTry) {
          try {
            // >! When both version and versionId provided, we need to check if ANY version matches EITHER criterion
            // >! This requires listing versions and checking each one
            if (version && versionId) {
              // List all versions of this template
              const listCommand = new ListObjectVersionsCommand({
                Bucket: bucket,
                Prefix: key
              });

              const listResponse = await AWS.s3.client.send(listCommand);

              if (listResponse.Versions && listResponse.Versions.length > 0) {
                // Check each version to see if it matches either criterion
                for (const v of listResponse.Versions) {
                  try {
                    const getCommand = new GetObjectCommand({
                      Bucket: bucket,
                      Key: key,
                      VersionId: v.VersionId
                    });

                    const response = await AWS.s3.client.send(getCommand);
                    const templateContent = await response.Body.transformToString();
                    const parsed = parseCloudFormationTemplate(templateContent);

                    // Check if this version matches EITHER criterion (OR condition)
                    const versionMatches = versionsMatch(parsed.version, version);
                    const versionIdMatches = v.VersionId === versionId;

                    if (versionMatches || versionIdMatches) {
                      // Found a match! Return this template
                      const result = {
                        name: templateName,
                        version: parsed.version,
                        versionId: v.VersionId,
                        content: templateContent,
                        parameters: parsed.Parameters,
                        outputs: parsed.Outputs,
                        description: parsed.Description,
                        category: category,
                        namespace: namespace,
                        bucket: bucket,
                        s3Path: `s3://${bucket}/${key}`,
                        lastModified: response.LastModified,
                        size: response.ContentLength,
                        metadata: parsed.Metadata
                      };
                      // >! Include subcategory in metadata for modules
                      if (subcategory) {
                        result.subcategory = subcategory;
                      }
                      return result;
                    }
                  } catch (versionError) {
                    DebugAndLog.warn(`Failed to check version ${v.VersionId}: ${versionError.message}`);
                    continue;
                  }
                }
              }

              // No version matched either criterion, try next key/namespace/bucket
              continue;
            }

            // >! Single criterion: version OR versionId (not both)
            const getParams = {
              Bucket: bucket,
              Key: key
            };

            // >! If versionId specified (without version), fetch that specific version
            if (versionId && !version) {
              getParams.VersionId = versionId;
            }

            const command = new GetObjectCommand(getParams);
            const response = await AWS.s3.client.send(command);

            const templateContent = await response.Body.transformToString();
            const parsed = parseCloudFormationTemplate(templateContent);

            // >! If only version specified, check if it matches
            if (version && !versionId && !versionsMatch(parsed.version, version)) {
              continue; // Try next namespace/bucket
            }

            const result = {
              name: templateName,
              version: parsed.version,
              versionId: response.VersionId,
              content: templateContent,
              parameters: parsed.Parameters,
              outputs: parsed.Outputs,
              description: parsed.Description,
              category: category,
              namespace: namespace,
              bucket: bucket,
              s3Path: `s3://${bucket}/${key}`,
              lastModified: response.LastModified,
              size: response.ContentLength,
              metadata: parsed.Metadata
            };
            // >! Include subcategory in metadata for modules
            if (subcategory) {
              result.subcategory = subcategory;
            }
            return result;
          } catch (error) {
            if (error.name === 'NoSuchKey') {
              continue; // Try next key/namespace/bucket
            }
            // >! Brown-out support: try next bucket on failure
            ErrorHandler.logS3Error({
              operation: 'GetObject',
              bucket,
              key,
              error
            });
          }
        }
      }
    } catch (error) {
      ErrorHandler.logS3Error({
        operation: 'GetTemplate',
        bucket,
        error
      });
      // Continue to next bucket
    }
  }

  // Template not found in any bucket
  return null;
}

/**
 * List all versions of a specific template
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - S3 bucket name(s)
 * @param {string} connection.path - S3 object key prefix
 * @param {Object} connection.parameters - Query parameters
 * @param {string} connection.parameters.category - Template category
 * @param {string} connection.parameters.templateName - Template name
 * @param {Object} options - Reserved for future use
 * @returns {Promise<Object>} Version history with versions array
 */
async function listVersions(connection, options = {}) {
  const { category, templateName, namespace } = connection.parameters || {};
  const basePath = connection.path || 'templates/v2';

  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  // Find the bucket/namespace where template exists
  for (const bucket of buckets) {
    try {
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        continue;
      }

      // >! When namespace is provided, use it directly; otherwise discover all namespaces
      const namespaces = namespace
        ? [namespace]
        : await getIndexedNamespaces(bucket);

      for (const namespace of namespaces) {
        // >! For modules category, use findModuleTemplateKey() to discover the key
        // >! For flat categories, iterate over extensions and use buildTemplateKey()
        const keysToTry = [];

        if (category === 'modules') {
          const found = await findModuleTemplateKey(bucket, namespace, basePath, templateName);
          if (found) {
            keysToTry.push(found.key);
          }
        } else {
          // Try .yml first, then .yaml
          for (const extension of ['.yml', '.yaml']) {
            keysToTry.push(buildTemplateKey(namespace, basePath, category, templateName, extension));
          }
        }

        for (const key of keysToTry) {
          try {
            const command = new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: key
            });

            const response = await AWS.s3.client.send(command);

            if (!response.Versions || response.Versions.length === 0) {
              continue;
            }

            // >! Parse versions and extract metadata
            const versions = await Promise.all(
              response.Versions.map(async (v) => {
                try {
                  // Get template content to extract Human_Readable_Version
                  const getCommand = new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    VersionId: v.VersionId
                  });
                  const content = await AWS.s3.client.send(getCommand);
                  const templateContent = await content.Body.transformToString();
                  const parsed = parseCloudFormationTemplate(templateContent);

                  return {
                    versionId: v.VersionId,
                    version: parsed.version,
                    lastModified: v.LastModified,
                    size: v.Size,
                    isLatest: v.IsLatest || false
                  };
                } catch (error) {
                  DebugAndLog.warn(`Failed to fetch version ${v.VersionId}: ${error.message}`);
                  return {
                    versionId: v.VersionId,
                    version: null,
                    lastModified: v.LastModified,
                    size: v.Size,
                    isLatest: v.IsLatest || false
                  };
                }
              })
            );

            // Sort by lastModified (newest first)
            versions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

            return {
              templateName,
              category,
              namespace,
              bucket,
              versions
            };
          } catch (error) {
            if (error.name === 'NoSuchKey') {
              continue;
            }
            ErrorHandler.logS3Error({
              operation: 'ListObjectVersions',
              bucket,
              key,
              error
            });
          }
        }
      }
    } catch (error) {
      ErrorHandler.logS3Error({
        operation: 'ListVersions',
        bucket,
        error
      });
    }
  }

  // Template not found
  return {
    templateName,
    category,
    versions: []
  };
}

module.exports = {
  checkBucketAccess,
  getIndexedNamespaces,
  list,
  get,
  listVersions,
  // Export helper functions for testing
  parseHumanReadableVersion,
  parseCloudFormationTemplate,
  buildTemplateKey,
  findModuleTemplateKey,
  filterByCategory,
  filterByVersion,
  filterByVersionId,
  versionsMatch,
  deduplicateTemplates,
  parseTemplateMetadata
};
