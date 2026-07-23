'use strict';

/**
 * CloudFormation custom-resource Lambda that provisions the Amazon S3 Vectors vector
 * bucket + index for the Bedrock-assisted documentation semantic search feature
 * (spec 0-0-6, Task 4.3).
 *
 * S3 Vectors has no native CloudFormation resource type (Task 4.1 spike), so this
 * Lambda-backed `Custom::S3VectorIndex` resource owns the full create/update/delete
 * lifecycle behind the stack's `EnableDocAi` Condition. Per AGENTS.md, because it uses the
 * AWS SDK it also handles a clean teardown (the Delete lifecycle).
 *
 * Lifecycle:
 *   - Create: ensure the vector bucket exists, then create the index (idempotent).
 *   - Update: no-op when no IMMUTABLE attribute changed; otherwise reconcile the index.
 *     A vector index's name, dimension, distance metric, and non-filterable metadata keys
 *     are immutable, so a change means (re)provisioning:
 *       * name changed  → provision the new index and return a NEW PhysicalResourceId so
 *         CloudFormation deletes the OLD one afterward (standard replacement).
 *       * only immutable config changed (same name) → delete + recreate the index IN PLACE
 *         (an index name is unique within a bucket, so a same-name "create new then delete
 *         old" would collide); the PhysicalResourceId is unchanged. // >!
 *   - Delete: best-effort delete of the index then the bucket; missing resources are
 *     treated as success and errors never fail the Delete (avoids stuck stacks). // >!
 *
 * Security:
 *   - No region/credentials are hardcoded; the SDK default provider chain resolves them
 *     from the Lambda environment (`AWS_REGION`). // >!
 *   - `ResourceProperties` are UNTRUSTED and validated before any AWS call. // >!
 *   - Vector data is never handled here; only names/dimensions. Logs are structured JSON
 *     and never include the pre-signed `ResponseURL` or secrets. // >!
 *   - The handler ALWAYS sends a CloudFormation response (success or a sanitized failure)
 *     so the stack never hangs waiting on this resource. // >!
 *
 * @module index
 */

// >! AWS SDK v3 S3 Vectors client. This client is NEW and may not yet be present in the
// >! nodejs24.x managed runtime, so `@aws-sdk/client-s3vectors` is declared as a
// >! PRODUCTION dependency of THIS function and bundled with it. Bundling the SDK is
// >! contrary to the usual AGENTS.md guidance, but provisioning reliability is critical
// >! and this is the one justified place to bundle (per the Task 4.1/4.2 notes).
const {
  S3VectorsClient,
  CreateVectorBucketCommand,
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorBucketCommand,
  GetIndexCommand
} = require('@aws-sdk/client-s3vectors');

const { sendResponse } = require('./lib/cfn-response');
const {
  RESPONSE_STATUS,
  DATA_TYPE,
  InvalidPropertiesError,
  normalizeProperties,
  hasMaterialChange,
  makePhysicalResourceId,
  parsePhysicalResourceId,
  isConflictError,
  isNotFoundError,
  sanitizeReason
} = require('./lib/provisioner-helpers');

/**
 * Maximum attempts for create/wait loops that must tolerate S3 Vectors eventual
 * consistency (e.g., recreating an index immediately after deleting it).
 * @constant {number}
 */
const MAX_ATTEMPTS = 6;

/**
 * Base delay (ms) between eventual-consistency retries; multiplied by the attempt number
 * for a simple linear backoff, comfortably within the function's 300s timeout.
 * @constant {number}
 */
const RETRY_BASE_DELAY_MS = 3000;

/**
 * Lazily created S3 Vectors client singleton (never constructed at module load, so merely
 * requiring this file is cheap).
 * @type {?S3VectorsClient}
 */
let s3VectorsClient = null;

/**
 * Get or create the shared S3 Vectors client.
 *
 * @returns {S3VectorsClient} The shared client.
 */
function getClient() {
  if (!s3VectorsClient) {
    // >! Region/credentials resolved from the Lambda environment; nothing hardcoded.
    s3VectorsClient = new S3VectorsClient({});
  }
  return s3VectorsClient;
}

/**
 * Override the shared S3 Vectors client (test seam).
 *
 * @param {?S3VectorsClient} client - Client to use, or `null` to reset.
 * @returns {void}
 */
function setClient(client) {
  s3VectorsClient = client;
}

/**
 * Emit a structured JSON log line.
 *
 * @param {string} level - Log level (`INFO`/`WARN`/`ERROR`).
 * @param {string} eventName - Short machine-readable event name.
 * @param {Object} [extra] - Additional non-sensitive fields.
 * @returns {void}
 */
function log(level, eventName, extra = {}) {
  console.log(JSON.stringify({ level, event: eventName, ...extra }));
}

/**
 * Resolve after `ms` milliseconds.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure the vector bucket exists (idempotent). A conflict/already-exists error is treated
 * as success so re-runs and shared buckets are handled gracefully.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {string} vectorBucketName - The vector bucket name.
 * @returns {Promise<void>}
 * @throws {Error} On any non-conflict AWS error.
 */
async function ensureVectorBucket(client, vectorBucketName) {
  try {
    await client.send(new CreateVectorBucketCommand({ vectorBucketName }));
    log('INFO', 'vector-bucket.created', { vectorBucketName });
  } catch (error) {
    if (isConflictError(error)) {
      log('INFO', 'vector-bucket.exists', { vectorBucketName });
      return;
    }
    throw error;
  }
}

/**
 * Check whether a vector index exists.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {string} vectorBucketName - The vector bucket name.
 * @param {string} indexName - The vector index name.
 * @returns {Promise<boolean>} `true` when the index exists.
 * @throws {Error} On any non-not-found AWS error.
 */
async function indexExists(client, vectorBucketName, indexName) {
  try {
    await client.send(new GetIndexCommand({ vectorBucketName, indexName }));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Delete a vector index if present; a missing index is treated as success.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {string} vectorBucketName - The vector bucket name.
 * @param {string} indexName - The vector index name.
 * @returns {Promise<void>}
 * @throws {Error} On any non-not-found AWS error.
 */
async function deleteIndexIfExists(client, vectorBucketName, indexName) {
  try {
    await client.send(new DeleteIndexCommand({ vectorBucketName, indexName }));
    log('INFO', 'index.deleted', { vectorBucketName, indexName });
  } catch (error) {
    if (isNotFoundError(error)) {
      log('INFO', 'index.delete.absent', { vectorBucketName, indexName });
      return;
    }
    throw error;
  }
}

/**
 * Create the vector index with the desired immutable configuration.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {{vectorBucketName: string, indexName: string, dimension: number, distanceMetric: string, nonFilterableMetadataKeys: string[]}} config - Normalized index config.
 * @returns {Promise<void>}
 * @throws {Error} On any AWS error.
 */
async function createVectorIndex(client, config) {
  const params = {
    vectorBucketName: config.vectorBucketName,
    indexName: config.indexName,
    dataType: DATA_TYPE,
    dimension: config.dimension,
    distanceMetric: config.distanceMetric
  };
  // Non-filterable metadata keys are optional and immutable once set.
  if (Array.isArray(config.nonFilterableMetadataKeys) && config.nonFilterableMetadataKeys.length > 0) {
    params.metadataConfiguration = { nonFilterableMetadataKeys: config.nonFilterableMetadataKeys };
  }
  await client.send(new CreateIndexCommand(params));
  log('INFO', 'index.created', {
    vectorBucketName: config.vectorBucketName,
    indexName: config.indexName,
    dimension: config.dimension,
    distanceMetric: config.distanceMetric,
    nonFilterableMetadataKeys: config.nonFilterableMetadataKeys
  });
}

/**
 * Poll until an index is gone (or the bounded attempt budget is exhausted), used after a
 * delete before an in-place recreate to ride out S3 Vectors eventual consistency.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {string} vectorBucketName - The vector bucket name.
 * @param {string} indexName - The vector index name.
 * @returns {Promise<void>}
 */
async function waitUntilIndexGone(client, vectorBucketName, indexName) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!(await indexExists(client, vectorBucketName, indexName))) {
      return;
    }
    await sleep(RETRY_BASE_DELAY_MS);
  }
  // Bounded: proceed; createIndexIdempotent retries on any lingering conflict.
  log('WARN', 'index.delete.pending', { vectorBucketName, indexName });
}

/**
 * Create the index idempotently, tolerating eventual consistency. On a conflict, confirms
 * the index exists (treating that as success) and otherwise retries with linear backoff.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {Object} config - Normalized index config.
 * @returns {Promise<void>}
 * @throws {Error} When creation ultimately fails with a non-conflict error or exhausts retries.
 */
async function createIndexIdempotent(client, config) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await createVectorIndex(client, config);
      return;
    } catch (error) {
      lastError = error;
      if (!isConflictError(error)) {
        throw error;
      }
      // Conflict: either the index already exists (idempotent success) or a prior delete
      // is still settling. Confirm current state before deciding to retry.
      if (await indexExists(client, config.vectorBucketName, config.indexName)) {
        log('INFO', 'index.exists', { vectorBucketName: config.vectorBucketName, indexName: config.indexName });
        return;
      }
      log('INFO', 'index.create.retry', { indexName: config.indexName, attempt });
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

/**
 * Ensure the desired index exists with the desired configuration.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {Object} config - Normalized index config.
 * @param {Object} options - Provisioning options.
 * @param {boolean} options.replaceExisting - When `true`, delete a same-named index first
 *   (used when immutable attributes changed but the name did not).
 * @returns {Promise<void>}
 */
async function provisionIndex(client, config, options) {
  await ensureVectorBucket(client, config.vectorBucketName);

  if (options.replaceExisting && await indexExists(client, config.vectorBucketName, config.indexName)) {
    // >! Immutable attributes changed with an unchanged index name. Index names are unique
    // >! within a bucket, so create-new-then-delete-old would collide; delete in place then
    // >! recreate. The doc-indexer re-populates the (now empty) index on its next run.
    await deleteIndexIfExists(client, config.vectorBucketName, config.indexName);
    await waitUntilIndexGone(client, config.vectorBucketName, config.indexName);
  }

  await createIndexIdempotent(client, config);
}

/**
 * Best-effort delete of a vector bucket. Missing buckets succeed; any other error (e.g.,
 * the bucket is still in use by another index) is logged and swallowed so a Delete never
 * gets stuck and never removes a bucket still in use.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {string} vectorBucketName - The vector bucket name.
 * @returns {Promise<void>}
 */
async function deleteVectorBucketBestEffort(client, vectorBucketName) {
  try {
    await client.send(new DeleteVectorBucketCommand({ vectorBucketName }));
    log('INFO', 'vector-bucket.deleted', { vectorBucketName });
  } catch (error) {
    if (isNotFoundError(error)) {
      log('INFO', 'vector-bucket.delete.absent', { vectorBucketName });
      return;
    }
    // >! Do not fail a Delete for a shared/non-empty bucket; leave it intact and continue.
    log('WARN', 'vector-bucket.delete.skipped', { vectorBucketName, reason: sanitizeReason(error) });
  }
}

/**
 * Handle a `Create` request: provision the bucket + index idempotently.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {Object} event - The custom resource event.
 * @returns {Promise<{physicalResourceId: string, data: Object}>}
 */
async function handleCreate(client, event) {
  const config = normalizeProperties(event.ResourceProperties);
  await provisionIndex(client, config, { replaceExisting: false });
  return {
    physicalResourceId: makePhysicalResourceId(config.vectorBucketName, config.indexName),
    data: { VectorBucketName: config.vectorBucketName, IndexName: config.indexName }
  };
}

/**
 * Handle an `Update` request: no-op when nothing immutable changed; otherwise reconcile.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {Object} event - The custom resource event.
 * @returns {Promise<{physicalResourceId: string, data: Object}>}
 */
async function handleUpdate(client, event) {
  const config = normalizeProperties(event.ResourceProperties);
  const physicalResourceId = makePhysicalResourceId(config.vectorBucketName, config.indexName);

  let oldConfig = null;
  try {
    oldConfig = normalizeProperties(event.OldResourceProperties);
  } catch {
    // Old properties invalid/absent → treat as a material change and reconcile the index.
    oldConfig = null;
  }

  if (oldConfig && !hasMaterialChange(config, oldConfig)) {
    log('INFO', 'update.noop', { vectorBucketName: config.vectorBucketName, indexName: config.indexName });
    // Keep the SAME physical id so CloudFormation does not delete anything.
    return {
      physicalResourceId: event.PhysicalResourceId || physicalResourceId,
      data: { VectorBucketName: config.vectorBucketName, IndexName: config.indexName }
    };
  }

  // Material change. When the name is unchanged, replace the index in place (same physical
  // id → no delete triggered). When the name changed, the new physical id differs, so
  // CloudFormation calls Delete on the OLD physical id afterward (clean teardown).
  const nameUnchanged = Boolean(
    oldConfig &&
    oldConfig.vectorBucketName === config.vectorBucketName &&
    oldConfig.indexName === config.indexName
  );

  await provisionIndex(client, config, { replaceExisting: nameUnchanged });

  return {
    physicalResourceId,
    data: { VectorBucketName: config.vectorBucketName, IndexName: config.indexName }
  };
}

/**
 * Handle a `Delete` request: best-effort teardown of the index then the bucket. Never
 * throws, so a stack delete is not blocked by missing or shared resources.
 *
 * @async
 * @param {S3VectorsClient} client - The S3 Vectors client.
 * @param {Object} event - The custom resource event.
 * @returns {Promise<{physicalResourceId: string, data: Object}>}
 */
async function handleDelete(client, event) {
  const { vectorBucketName, indexName } = parsePhysicalResourceId(event.PhysicalResourceId);

  // >! Never fail a Delete for missing resources — that would leave the stack stuck.
  if (vectorBucketName && indexName) {
    try {
      await deleteIndexIfExists(client, vectorBucketName, indexName);
    } catch (error) {
      log('WARN', 'index.delete.skipped', { vectorBucketName, indexName, reason: sanitizeReason(error) });
    }
  }
  if (vectorBucketName) {
    await deleteVectorBucketBestEffort(client, vectorBucketName);
  }

  return {
    physicalResourceId: event.PhysicalResourceId,
    data: { VectorBucketName: vectorBucketName, IndexName: indexName }
  };
}

/**
 * CloudFormation custom-resource Lambda handler. Dispatches on `RequestType`, then ALWAYS
 * sends a response (success or a sanitized failure) so the stack never hangs.
 *
 * @async
 * @param {Object} event - The custom resource event.
 * @param {Object} context - The Lambda context.
 * @returns {Promise<void>}
 */
async function handler(event, context) {
  log('INFO', 'handler.invoke', {
    requestType: event && event.RequestType,
    logicalResourceId: event && event.LogicalResourceId
  });

  const client = getClient();

  try {
    let result;
    switch (event && event.RequestType) {
      case 'Create':
        result = await handleCreate(client, event);
        break;
      case 'Update':
        result = await handleUpdate(client, event);
        break;
      case 'Delete':
        result = await handleDelete(client, event);
        break;
      default:
        throw new InvalidPropertiesError(`Unsupported RequestType: ${event && event.RequestType}`);
    }

    await sendResponse(event, context, {
      status: RESPONSE_STATUS.SUCCESS,
      physicalResourceId: result.physicalResourceId,
      data: result.data
    });
  } catch (error) {
    log('ERROR', 'handler.error', {
      requestType: event && event.RequestType,
      reason: sanitizeReason(error)
    });

    // On Create failure, omit the physical id so CloudFormation's follow-up Delete targets
    // a sentinel and is a no-op; on Update/Delete, preserve the existing physical id.
    const physicalResourceId = (event && event.RequestType === 'Create')
      ? undefined
      : (event && event.PhysicalResourceId);

    try {
      await sendResponse(event, context, {
        status: RESPONSE_STATUS.FAILED,
        reason: sanitizeReason(error),
        physicalResourceId
      });
    } catch (sendError) {
      // Last resort: log so the stuck-stack cause is visible; rethrow to fail the invocation.
      log('ERROR', 'handler.sendFailed', { reason: sanitizeReason(sendError) });
      throw sendError;
    }
  }
}

module.exports = {
  handler,
  // Exposed for testing / smoke checks (SDK-backed orchestration).
  setClient,
  getClient,
  ensureVectorBucket,
  indexExists,
  deleteIndexIfExists,
  createVectorIndex,
  createIndexIdempotent,
  provisionIndex,
  deleteVectorBucketBestEffort,
  handleCreate,
  handleUpdate,
  handleDelete
};
