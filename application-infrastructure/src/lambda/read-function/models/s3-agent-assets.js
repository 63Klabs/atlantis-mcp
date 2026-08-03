/**
 * S3 Agent Assets Data Access Object
 *
 * Handles retrieval of Kiro AI agent assets (steering documents, hooks,
 * AGENTS.md files, and future registry-driven types) from multiple S3
 * buckets with:
 * - Multi-bucket support with priority ordering
 * - Namespace discovery and indexing
 * - Registry-driven type resolution (folder + allowed extensions per type)
 * - Content-identity metadata (size, ETag, SHA-256) for client-side comparison
 * - Brown-out support (continue on bucket failures)
 *
 * This module exposes the pure, side-effect-free helpers shared by the
 * generic `list`/`get` operations (S3 key construction, extension filtering,
 * deduplication, S3-object-to-list-item mapping, and SHA-256 computation) as
 * well as the `list(connection, options)` and `get(connection, options)`
 * operations themselves. The bucket-access and namespace-discovery helpers
 * they depend on live in the shared `models/s3-common` module rather than
 * being re-declared here (Requirement 5.6).
 *
 * @module models/s3-agent-assets
 */

const crypto = require('crypto');
const { GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');
const ErrorHandler = require('../utils/error-handler');
const S3Common = require('./s3-common');

/**
 * Build the S3 object key for an agent asset.
 *
 * Appends only the (already validated) `name` to the fixed
 * `{namespace}/{basePath}/{folder}/` prefix, so the resulting key always
 * begins with that prefix and can never reference a location outside it.
 *
 * @param {string} namespace - Namespace directory (e.g. 'atlantis')
 * @param {string} basePath - Base path under the namespace (e.g. 'utilities/v2/agent_assets')
 * @param {string} folder - Registry-resolved S3 subfolder for the asset type (e.g. 'steering')
 * @param {string} name - Validated asset filename (no path separators)
 * @returns {string} S3 object key: `{namespace}/{basePath}/{folder}/{name}`
 * @example
 * buildAssetKey('atlantis', 'utilities/v2/agent_assets', 'steering', 'product-guidelines.md');
 * // => 'atlantis/utilities/v2/agent_assets/steering/product-guidelines.md'
 */
function buildAssetKey(namespace, basePath, folder, name) {
  return `${namespace}/${basePath}/${folder}/${name}`;
}

/**
 * Check whether a filename ends with one of the allowed extensions.
 *
 * @param {string} filename - Filename to test (e.g. 'my-hook.kiro.hook')
 * @param {string[]} extensions - Allowed extensions, each including the leading dot (e.g. ['.kiro.hook', '.json'])
 * @returns {boolean} True if `filename` ends with any entry in `extensions`
 * @example
 * filterByExtension('product-guidelines.md', ['.md']); // => true
 * filterByExtension('notes.txt', ['.md']); // => false
 * filterByExtension('my-hook.kiro.hook', ['.kiro.hook', '.json']); // => true
 */
function filterByExtension(filename, extensions) {
  if (typeof filename !== 'string' || !Array.isArray(extensions)) {
    return false;
  }
  return extensions.some((extension) => filename.endsWith(extension));
}

/**
 * Deduplicate assets across buckets/namespaces (first occurrence wins).
 *
 * Uses the `(type, name)` pair as the dedup key so that the same `name`
 * appearing under different asset types is treated as distinct (Requirement
 * 1.4). Callers are responsible for passing `assets` already ordered by
 * registry-type, then bucket, then namespace priority so that the retained
 * occurrence is the correct first one.
 *
 * @param {Array<Object>} assets - Asset list items, in priority order
 * @param {string} assets[].type - Registry canonical type name
 * @param {string} assets[].name - Asset filename
 * @returns {Array<Object>} Deduplicated assets, preserving input order
 * @example
 * deduplicateAssets([
 *   { type: 'steering', name: 'a.md', bucket: 'bucket-1' },
 *   { type: 'steering', name: 'a.md', bucket: 'bucket-2' }, // discarded: duplicate (type, name)
 *   { type: 'hooks', name: 'a.md', bucket: 'bucket-1' }     // kept: different type, same name
 * ]);
 * // => [
 * //   { type: 'steering', name: 'a.md', bucket: 'bucket-1' },
 * //   { type: 'hooks', name: 'a.md', bucket: 'bucket-1' }
 * // ]
 */
function deduplicateAssets(assets) {
  const seen = new Set();
  const deduplicated = [];

  for (const asset of assets) {
    const key = `${asset.type}/${asset.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(asset);
    }
  }

  return deduplicated;
}

/**
 * Parse asset list-item metadata from an S3 ListObjectsV2 entry.
 *
 * @param {Object} s3Object - S3 object listing entry (from ListObjectsV2Command)
 * @param {string} s3Object.Key - Full S3 object key
 * @param {number} s3Object.Size - Object size in bytes
 * @param {string} s3Object.ETag - S3 ETag
 * @param {Date|string} s3Object.LastModified - Last-modified timestamp
 * @param {string} bucket - S3 bucket name the object was read from
 * @param {string} namespace - Namespace the object was read from
 * @param {string} type - Registry canonical type name (the `assetType` value)
 * @returns {{name: string, type: string, namespace: string, bucket: string, s3Path: string, size: number, etag: string, lastModified: (Date|string)}} Asset list item
 * @example
 * parseAssetMetadata(
 *   {
 *     Key: 'atlantis/utilities/v2/agent_assets/steering/product-guidelines.md',
 *     Size: 4096,
 *     ETag: '"9b2cf"',
 *     LastModified: new Date('2026-05-01T12:00:00.000Z')
 *   },
 *   '63klabs',
 *   'atlantis',
 *   'steering'
 * );
 * // => {
 * //   name: 'product-guidelines.md',
 * //   type: 'steering',
 * //   namespace: 'atlantis',
 * //   bucket: '63klabs',
 * //   s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/product-guidelines.md',
 * //   size: 4096,
 * //   etag: '"9b2cf"',
 * //   lastModified: 2026-05-01T12:00:00.000Z
 * // }
 */
function parseAssetMetadata(s3Object, bucket, namespace, type) {
  const keyParts = s3Object.Key.split('/');
  const name = keyParts[keyParts.length - 1];

  return {
    name,
    type,
    namespace,
    bucket,
    s3Path: `s3://${bucket}/${s3Object.Key}`,
    size: s3Object.Size,
    etag: s3Object.ETag,
    lastModified: s3Object.LastModified
  };
}

/**
 * Compute the SHA-256 digest of a buffer using the Node.js built-in `crypto`
 * module.
 *
 * @param {Buffer|Uint8Array} buffer - Exact object bytes to hash
 * @returns {string} Lowercase hexadecimal SHA-256 digest
 * @example
 * computeSha256(Buffer.from('hello'));
 * // => '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 */
function computeSha256(buffer) {
  // >! Use the Node built-in crypto module to compute content hashes; no
  // >! shell is invoked and no third-party hashing library is added
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * List assets across one or more registered types over configured
 * buckets/namespaces, with brown-out support.
 *
 * Iterates `connection.parameters.assetTypes` in registry order (the caller
 * supplies either a single-entry array for a one-type list or all enabled
 * entries, in registry order, for an all-types list). For each type, iterates
 * `connection.host` buckets in priority order and, within each bucket, either
 * the single `connection.parameters.namespace` (when provided) or all
 * indexed namespaces from `S3Common.getIndexedNamespaces` in discovery order.
 * For each `(type, bucket, namespace)` combination, lists direct children of
 * `{namespace}/{basePath}/{folder}/` via `ListObjectsV2Command` with
 * `Delimiter: '/'` (so nested-subfolder objects surface only as
 * `CommonPrefixes` and are ignored, and the prefix placeholder key itself is
 * excluded), keeps only objects whose filename matches one of the type's
 * configured `extensions`, sorts the matched filenames ascending, and appends
 * them to the running result. After all sources are visited, deduplicates on
 * the `(type, name)` pair (first occurrence wins) so the final order is
 * registry-type, then bucket, then namespace priority, then ascending name.
 *
 * A bucket that fails `S3Common.checkBucketAccess` is skipped (brown-out)
 * with a warning and an `errors` entry; a bucket/namespace listing failure is
 * logged via `ErrorHandler.logS3Error`, recorded in `errors`, and sets
 * `partialData: true`, while the remaining sources continue to be searched.
 *
 * @param {Object} connection - Connection object
 * @param {string[]|string} connection.host - S3 bucket name(s), priority order
 * @param {string} [connection.path] - Base path under the namespace (defaults to 'utilities/v2/agent_assets')
 * @param {Object} connection.parameters - Query parameters
 * @param {import('../config/agent-asset-types').AgentAssetType[]} connection.parameters.assetTypes - Types to search, in registry order
 * @param {string} [connection.parameters.namespace] - Restrict the search to this single namespace
 * @param {Object} [options={}] - Reserved for future use (not part of the cache key)
 * @returns {Promise<{assets: Object[], errors: (Object[]|undefined), partialData: boolean}>} List result
 * @example
 * const result = await list(
 *   {
 *     host: ['63klabs'],
 *     path: 'utilities/v2/agent_assets',
 *     parameters: { assetTypes: [{ name: 'steering', folder: 'steering', extensions: ['.md'] }] }
 *   },
 *   {}
 * );
 * // result: { assets: [ { name: 'a.md', type: 'steering', ... } ], errors: undefined, partialData: false }
 */
async function list(connection, _options = {}) {
  const { assetTypes, namespace } = connection.parameters || {};
  const basePath = connection.path || 'utilities/v2/agent_assets';

  // Ensure host is an array
  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  const types = Array.isArray(assetTypes) ? assetTypes : [];

  const allAssets = [];
  const errors = [];

  // >! Iterate types in registry order, then buckets in priority order, then
  // >! namespaces in indexed-priority order, so the result is deterministic
  for (const type of types) {
    for (const bucket of buckets) {
      try {
        // >! Check if bucket has atlantis-mcp:Allow=true tag (brown-out)
        const allowAccess = await S3Common.checkBucketAccess(bucket);
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
          : await S3Common.getIndexedNamespaces(bucket);
        if (namespaces.length === 0) {
          DebugAndLog.warn(`Bucket ${bucket} has no namespaces, skipping`);
          continue;
        }

        for (const ns of namespaces) {
          const prefix = `${ns}/${basePath}/${type.folder}/`;

          try {
            const command = new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              Delimiter: '/'
            });

            const response = await AWS.s3.client.send(command);

            // >! Delimiter: '/' keeps only direct children under the prefix;
            // >! nested-subfolder objects surface as CommonPrefixes (ignored)
            // >! and are never included here. Exclude the placeholder key
            // >! equal to the prefix itself, then keep only extension matches.
            const matched = (response.Contents || [])
              .filter(obj => obj.Key !== prefix)
              .filter(obj => filterByExtension(obj.Key.split('/').pop(), type.extensions))
              .map(obj => parseAssetMetadata(obj, bucket, ns, type.name));

            // >! Sort this source's matched filenames ascending before appending
            matched.sort((a, b) => a.name.localeCompare(b.name));

            allAssets.push(...matched);
          } catch (error) {
            // >! Brown-out support: log error but continue with other namespaces
            ErrorHandler.logS3Error({
              operation: 'ListObjectsV2',
              bucket,
              key: prefix,
              error
            });
            errors.push({
              source: `${bucket}/${ns}`,
              sourceType: 's3',
              error: error.message,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        // >! Brown-out support: log error but continue with other buckets
        ErrorHandler.logS3Error({
          operation: 'ListAgentAssets',
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
  }

  // >! Deduplicate on (type, name) - first occurrence wins due to priority ordering
  const uniqueAssets = deduplicateAssets(allAssets);

  return {
    assets: uniqueAssets,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
}

/**
 * Get one agent asset's full content by name; returns the first occurrence
 * for the requested `(assetType, name)` in bucket-then-namespace priority
 * order.
 *
 * Iterates `connection.host` buckets in priority order and, within each
 * bucket, either the single `connection.parameters.namespace` (when
 * provided) or all indexed namespaces from `S3Common.getIndexedNamespaces`
 * in discovery order (mirroring `list`'s iteration approach). For each
 * `(bucket, namespace)` combination, builds the object key via
 * `buildAssetKey` and issues a plain `GetObjectCommand` with no `VersionId`,
 * so the latest object version is always read (Requirement 2.5).
 *
 * On a successful read, reads the exact object bytes via
 * `response.Body.transformToByteArray()` and computes `sha256` (via
 * `computeSha256`) and `size` from those same exact bytes, before any UTF-8
 * decoding; `content` is then the UTF-8 decoding of those same bytes.
 *
 * A `NoSuchKey` error means the asset is not at this particular
 * bucket/namespace, so the search continues with the next namespace/bucket.
 * Any other per-object error is logged via `ErrorHandler.logS3Error` and
 * also continues the search with the next bucket (brown-out, Requirement
 * 4.8). A bucket that fails `S3Common.checkBucketAccess` is skipped the same
 * way. When the asset is not found in any read source, returns `null` — the
 * `ASSET_NOT_FOUND` error is assembled by the service layer, not the DAO.
 *
 * @param {Object} connection - Connection object
 * @param {string[]|string} connection.host - S3 bucket name(s), priority order
 * @param {string} [connection.path] - Base path under the namespace (defaults to 'utilities/v2/agent_assets')
 * @param {Object} connection.parameters - Query parameters
 * @param {import('../config/agent-asset-types').AgentAssetType} connection.parameters.assetType - Single resolved asset type (with `.folder` and `.name`)
 * @param {string} connection.parameters.name - Validated asset filename (no path separators)
 * @param {string} [connection.parameters.namespace] - Restrict the search to this single namespace
 * @param {Object} [options={}] - Reserved for future use (not part of the cache key)
 * @returns {Promise<Object|null>} Asset detail object, or `null` when not found in any read source
 * @example
 * const asset = await get(
 *   {
 *     host: ['63klabs'],
 *     path: 'utilities/v2/agent_assets',
 *     parameters: {
 *       assetType: { name: 'steering', folder: 'steering', extensions: ['.md'] },
 *       name: 'product-guidelines.md'
 *     }
 *   },
 *   {}
 * );
 * // asset: {
 * //   name: 'product-guidelines.md', type: 'steering', namespace: 'atlantis',
 * //   bucket: '63klabs', s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/product-guidelines.md',
 * //   size: 4096, etag: '"9b2cf"', sha256: 'e3b0c4...', lastModified: 2026-05-01T12:00:00.000Z,
 * //   content: '# Product Guidelines\n...'
 * // }
 */
async function get(connection, _options = {}) {
  const { assetType, name, namespace } = connection.parameters || {};
  const basePath = connection.path || 'utilities/v2/agent_assets';

  // Ensure host is an array
  const buckets = Array.isArray(connection.host) ? connection.host : [connection.host];

  // >! Iterate buckets in priority order, then namespaces in indexed-priority
  // >! order, mirroring list()'s iteration approach; return the first match
  for (const bucket of buckets) {
    try {
      // >! Check if bucket has atlantis-mcp:Allow=true tag (brown-out)
      const allowAccess = await S3Common.checkBucketAccess(bucket);
      if (!allowAccess) {
        DebugAndLog.warn(`Bucket ${bucket} does not have atlantis-mcp:Allow=true tag, skipping`);
        continue;
      }

      // >! When namespace is provided, use it directly; otherwise discover all namespaces
      const namespaces = namespace
        ? [namespace]
        : await S3Common.getIndexedNamespaces(bucket);

      for (const ns of namespaces) {
        const key = buildAssetKey(ns, basePath, assetType.folder, name);

        try {
          // >! Plain GetObjectCommand with no VersionId - always reads the
          // >! latest version (Requirement 2.5)
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
          });

          const response = await AWS.s3.client.send(command);

          // >! Read exact bytes first; compute sha256/size on those raw
          // >! bytes before any UTF-8 decoding, then decode for `content`
          const bytes = await response.Body.transformToByteArray();
          const buffer = Buffer.from(bytes);

          return {
            name,
            type: assetType.name,
            namespace: ns,
            bucket,
            s3Path: `s3://${bucket}/${key}`,
            size: buffer.length,
            etag: response.ETag,
            sha256: computeSha256(buffer),
            lastModified: response.LastModified,
            content: buffer.toString('utf-8')
          };
        } catch (error) {
          if (error.name === 'NoSuchKey') {
            continue; // Not found here; try next namespace/bucket
          }
          // >! Brown-out support: log error but continue with the next bucket
          ErrorHandler.logS3Error({
            operation: 'GetObject',
            bucket,
            key,
            error
          });
        }
      }
    } catch (error) {
      // >! Brown-out support: log error but continue with other buckets
      ErrorHandler.logS3Error({
        operation: 'GetAgentAsset',
        bucket,
        error
      });
    }
  }

  // Asset not found in any bucket/namespace
  return null;
}

module.exports = {
  buildAssetKey,
  filterByExtension,
  deduplicateAssets,
  parseAssetMetadata,
  computeSha256,
  list,
  get
};
