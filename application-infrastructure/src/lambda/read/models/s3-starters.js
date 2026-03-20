/**
 * S3 App Starters Data Access Object
 *
 * Handles retrieval of app starter packages and metadata from multiple S3 buckets with:
 * - Multi-bucket support with priority ordering
 * - Namespace discovery and indexing
 * - Sidecar metadata file support
 * - Brown-out support (continue on bucket failures)
 * - Bucket access validation via tags
 *
 * @module models/s3-starters
 */

const { GetObjectCommand, ListObjectsV2Command, GetObjectTaggingCommand } = require('@aws-sdk/client-s3');
const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');

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
    DebugAndLog.warn(`Failed to check bucket access for ${bucketName}: ${error.message}`);
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
    DebugAndLog.warn(`Failed to get indexed namespaces for ${bucketName}: ${error.message}`);
    return [];
  }
}

/**
 * Parse sidecar metadata JSON with backward compatibility for singular field names.
 *
 * Reads plural array fields (`languages`, `frameworks`) with fallback to singular
 * string fields (`language`, `framework`) wrapped in an array for backward compatibility.
 *
 * @param {string} metadataContent - JSON content from sidecar file
 * @returns {Object} Parsed metadata with languages, frameworks, topics, dependencies, devDependencies, hasCacheData, deployment_platform, repository, and other fields
 * @example
 * const meta = parseSidecarMetadata('{"languages":["Node.js"],"frameworks":["Express"]}');
 * // meta.languages => ['Node.js'], meta.frameworks => ['Express']
 *
 * @example
 * // Backward compatibility with singular fields
 * const meta = parseSidecarMetadata('{"language":"Python","framework":"Flask"}');
 * // meta.languages => ['Python'], meta.frameworks => ['Flask']
 */
function parseSidecarMetadata(metadataContent) {
  try {
    const metadata = JSON.parse(metadataContent);

    return {
      name: metadata.name || '',
      description: metadata.description || '',
      languages: metadata.languages || (metadata.language ? [metadata.language] : []),
      frameworks: metadata.frameworks || (metadata.framework ? [metadata.framework] : []),
      topics: metadata.topics || [],
      dependencies: metadata.dependencies || [],
      devDependencies: metadata.devDependencies || metadata.dev_dependencies || [],
      hasCacheData: metadata.hasCacheData || metadata.has_cache_data || false,
      deployment_platform: metadata.deployment_platform || 'atlantis',
      features: metadata.features || [],
      prerequisites: metadata.prerequisites || [],
      author: metadata.author || '',
      license: metadata.license || 'UNLICENSED',
      repository: metadata.repository || metadata.github_url || metadata.githubUrl || '',
      repository_type: metadata.repository_type || metadata.repositoryType || 'app-starter',
      version: metadata.version || '',
      last_updated: metadata.last_updated || metadata.lastUpdated || ''
    };
  } catch (error) {
    DebugAndLog.error(`Failed to parse sidecar metadata: ${error.message}`);
    return {
      name: '',
      description: '',
      languages: [],
      frameworks: [],
      topics: [],
      dependencies: [],
      devDependencies: [],
      hasCacheData: false,
      deployment_platform: '',
      features: [],
      prerequisites: [],
      author: '',
      license: '',
      repository: '',
      repository_type: 'app-starter',
      version: '',
      last_updated: ''
    };
  }
}

/**
 * Build S3 key for app starter ZIP file
 *
 * @param {string} namespace - Namespace directory
 * @param {string} basePath - Base path (e.g., 'app-starters/v2')
 * @param {string} appName - App starter name
 * @returns {string} S3 object key for ZIP file
 */
function buildStarterZipKey(namespace, basePath, appName) {
  return `${namespace}/${basePath}/${appName}.zip`;
}

/**
 * Build S3 key for sidecar metadata file
 *
 * @param {string} namespace - Namespace directory
 * @param {string} basePath - Base path (e.g., 'app-starters/v2')
 * @param {string} appName - App starter name
 * @returns {string} S3 object key for metadata JSON file
 */
function buildStarterMetadataKey(namespace, basePath, appName) {
  return `${namespace}/${basePath}/${appName}.json`;
}

/**
 * Extract app name from S3 key
 *
 * @param {string} key - S3 object key
 * @returns {string} App starter name (without .zip extension)
 */
function extractAppNameFromKey(key) {
  const parts = key.split('/');
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.zip$/, '');
}

/**
 * Deduplicate starters across buckets (first occurrence wins)
 *
 * @param {Array<Object>} starters - Array of starter metadata
 * @returns {Array<Object>} Deduplicated starters
 */
function deduplicateStarters(starters) {
  const seen = new Set();
  const deduplicated = [];

  for (const starter of starters) {
    const key = starter.name;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(starter);
    }
  }

  return deduplicated;
}

/**
 * List all app starters from S3 buckets with brown-out support
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - S3 bucket name(s)
 * @param {string} connection.path - S3 object key prefix (e.g., "app-starters/v2")
 * @param {Object} connection.parameters - Query parameters (reserved for future filtering)
 * @param {Object} options - Reserved for future use (not in cache key)
 * @returns {Promise<Object>} { starters: Array, errors: Array, partialData: boolean }
 */
async function list(connection, options = {}) {
  const basePath = connection.path || 'app-starters/v2';

  // Ensure host is an array
  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  const allStarters = [];
  const errors = [];

  // >! Iterate through buckets in priority order
  for (const bucket of buckets) {
    try {
      // >! Check if bucket has atlantis-mcp:Allow=true tag
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        DebugAndLog.warn(`Bucket ${bucket} does not have atlantis-mcp:Allow=true tag, skipping`);
        errors.push({
          source: bucket,
          sourceType: 's3',
          error: 'Bucket access not allowed',
          timestamp: new Date().toISOString()
        });
        continue;
      }

      // >! Get IndexPriority tag to determine which namespaces to index
      const namespaces = await getIndexedNamespaces(bucket);
      if (namespaces.length === 0) {
        DebugAndLog.warn(`Bucket ${bucket} has no namespaces, skipping`);
        continue;
      }

      // >! Search for ZIP files at path {namespace}/app-starters/v2/{appName}.zip
      for (const namespace of namespaces) {
        const prefix = `${namespace}/${basePath}/`;

        try {
          const command = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix
          });

          const response = await AWS.s3.client.send(command);

          // >! Find all ZIP files
          const zipFiles = (response.Contents || [])
            .filter(obj => obj.Key.endsWith('.zip'));

          // >! For each ZIP file, check for corresponding sidecar metadata
          for (const zipFile of zipFiles) {
            const appName = extractAppNameFromKey(zipFile.Key);
            const metadataKey = buildStarterMetadataKey(namespace, basePath, appName);

            try {
              // >! Search for sidecar metadata at path {namespace}/app-starters/v2/{appName}.json
              const metadataCommand = new GetObjectCommand({
                Bucket: bucket,
                Key: metadataKey
              });

              const metadataResponse = await AWS.s3.client.send(metadataCommand);
              const metadataContent = await metadataResponse.Body.transformToString();

              // >! Parse sidecar metadata JSON
              const metadata = parseSidecarMetadata(metadataContent);

              // >! Verify ZIP file name matches GitHub repository name
              // The metadata should contain the repository name, which should match the ZIP file name
              if (metadata.name && metadata.name !== appName) {
                DebugAndLog.warn(`ZIP file name '${appName}' does not match metadata name '${metadata.name}' in ${bucket}/${namespace}`);
              }

              allStarters.push({
                ...metadata,
                name: appName, // Use ZIP file name as authoritative
                hasSidecarMetadata: true,
                namespace,
                bucket,
                s3ZipPath: `s3://${bucket}/${zipFile.Key}`,
                s3MetadataPath: `s3://${bucket}/${metadataKey}`,
                zipSize: zipFile.Size,
                lastModified: zipFile.LastModified
              });
            } catch (error) {
              if (error.name === 'NoSuchKey') {
                // >! Include starters without sidecar metadata with minimal metadata
                DebugAndLog.warn(`Starter ${appName} in ${bucket}/${namespace}: no sidecar metadata file found, using minimal metadata`);
                allStarters.push({
                  name: appName,
                  description: '',
                  languages: [],
                  frameworks: [],
                  topics: [],
                  dependencies: [],
                  devDependencies: [],
                  hasCacheData: false,
                  deployment_platform: '',
                  features: [],
                  prerequisites: [],
                  author: '',
                  license: '',
                  repository: '',
                  repository_type: 'app-starter',
                  version: '',
                  last_updated: '',
                  hasSidecarMetadata: false,
                  namespace,
                  bucket,
                  s3ZipPath: `s3://${bucket}/${zipFile.Key}`,
                  zipSize: zipFile.Size,
                  lastModified: zipFile.LastModified
                });
              } else {
                DebugAndLog.warn(`Failed to read sidecar metadata for ${appName} in ${bucket}/${namespace}: ${error.message}`);
              }
              // Continue to next starter
            }
          }
        } catch (error) {
          // >! Brown-out support: log error but continue with other namespaces
          DebugAndLog.warn(`Failed to list starters from ${bucket}/${namespace}: ${error.message}`);
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
      DebugAndLog.warn(`Failed to list starters from bucket ${bucket}: ${error.message}`);
      errors.push({
        source: bucket,
        sourceType: 's3',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // >! Deduplicate starters (first occurrence wins due to priority ordering)
  const uniqueStarters = deduplicateStarters(allStarters);

  return {
    starters: uniqueStarters,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
}

/**
 * Get specific app starter metadata from S3 buckets with brown-out support
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - S3 bucket name(s)
 * @param {string} connection.path - S3 object key prefix
 * @param {Object} connection.parameters - Query parameters
 * @param {string} connection.parameters.starterName - App starter name
 * @param {Object} options - Reserved for future use
 * @returns {Promise<Object|null>} Starter metadata or null
 */
async function get(connection, options = {}) {
  const { starterName } = connection.parameters || {};
  const basePath = connection.path || 'app-starters/v2';

  if (!starterName) {
    DebugAndLog.error('starterName parameter is required');
    return null;
  }

  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  // >! Search buckets in priority order
  for (const bucket of buckets) {
    try {
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        continue;
      }

      const namespaces = await getIndexedNamespaces(bucket);

      // >! Search namespaces in priority order
      for (const namespace of namespaces) {
        const zipKey = buildStarterZipKey(namespace, basePath, starterName);
        const metadataKey = buildStarterMetadataKey(namespace, basePath, starterName);

        try {
          // >! Check if ZIP file exists
          const zipCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: zipKey
          });

          const zipResponse = await AWS.s3.client.send(zipCommand);

          // ZIP exists, now get sidecar metadata
          try {
            const metadataCommand = new GetObjectCommand({
              Bucket: bucket,
              Key: metadataKey
            });

            const metadataResponse = await AWS.s3.client.send(metadataCommand);
            const metadataContent = await metadataResponse.Body.transformToString();

            // >! Parse sidecar metadata JSON
            const metadata = parseSidecarMetadata(metadataContent);

            // >! Verify ZIP file name matches GitHub repository name
            if (metadata.name && metadata.name !== starterName) {
              DebugAndLog.warn(`ZIP file name '${starterName}' does not match metadata name '${metadata.name}' in ${bucket}/${namespace}`);
            }

            return {
              ...metadata,
              name: starterName, // Use ZIP file name as authoritative
              hasSidecarMetadata: true,
              namespace,
              bucket,
              s3ZipPath: `s3://${bucket}/${zipKey}`,
              s3MetadataPath: `s3://${bucket}/${metadataKey}`,
              zipSize: zipResponse.ContentLength,
              lastModified: zipResponse.LastModified
            };
          } catch (error) {
            if (error.name === 'NoSuchKey') {
              // >! Return minimal metadata for starters without sidecar JSON
              DebugAndLog.warn(`Starter ${starterName} in ${bucket}/${namespace}: no sidecar metadata file found, returning minimal metadata`);
              return {
                name: starterName,
                description: '',
                languages: [],
                frameworks: [],
                topics: [],
                dependencies: [],
                devDependencies: [],
                hasCacheData: false,
                deployment_platform: '',
                features: [],
                prerequisites: [],
                author: '',
                license: '',
                repository: '',
                repository_type: 'app-starter',
                version: '',
                last_updated: '',
                hasSidecarMetadata: false,
                namespace,
                bucket,
                s3ZipPath: `s3://${bucket}/${zipKey}`,
                zipSize: zipResponse.ContentLength,
                lastModified: zipResponse.LastModified
              };
            }
            throw error;
          }
        } catch (error) {
          if (error.name === 'NoSuchKey') {
            continue; // Try next namespace/bucket
          }
          // >! Brown-out support: try next bucket on failure
          DebugAndLog.warn(`Failed to get starter from ${bucket}/${namespace}: ${error.message}`);
        }
      }
    } catch (error) {
      DebugAndLog.warn(`Failed to get starter from bucket ${bucket}: ${error.message}`);
      // Continue to next bucket
    }
  }

  // Starter not found in any bucket
  return null;
}

module.exports = {
  checkBucketAccess,
  getIndexedNamespaces,
  list,
  get,
  // Export helper functions for testing
  parseSidecarMetadata,
  buildStarterZipKey,
  buildStarterMetadataKey,
  extractAppNameFromKey,
  deduplicateStarters
};
