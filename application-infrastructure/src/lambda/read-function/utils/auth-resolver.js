/**
 * Auth Resolver Utility
 *
 * Resolves API key authentication from incoming requests, performing
 * scrypt key hashing, DynamoDB user lookup, tier computation,
 * the Downgrade of a lapsed tier, and TTL renewal while a key is in use.
 *
 * Supports two header formats:
 * - `Authorization: Bearer <key>`
 * - `X-API-Key: <key>`
 *
 * Degradation strategy: if SSM or DynamoDB is unavailable, falls back
 * to public tier with `degraded: true`. Invalid keys always return 401.
 *
 * @module utils/auth-resolver
 */

'use strict';

const crypto = require('crypto');
const { tools: { DebugAndLog, AWS, CachedSsmParameter } } = require('@63klabs/cache-data');
// >! Loaded from the tier-common layer; a missing layer fails the cold start (no local copy)
const TierCommon = require('./tier-common');
// >! The only place a client address becomes a rate-limit bucket key (validated and normalized)
const { toBucketKey } = require('./client-address');

const { EXPIRY_STATE } = TierCommon;

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** @type {number} 90 days in seconds */
const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;

/** @type {number} 120 days in seconds */
const ONE_TWENTY_DAYS_SEC = 120 * 24 * 60 * 60;

/* ------------------------------------------------------------------ */
/*  CachedSsmParameter for API Key Hash Salt                          */
/* ------------------------------------------------------------------ */

/**
 * Cached SSM parameter for the scrypt hash salt.
 *
 * Retrieved from `PARAM_STORE_PATH + 'Mcp_ApiKeyHashSalt'`.
 * Used to hash raw API keys before DynamoDB lookup.
 *
 * @type {CachedSsmParameter}
 */
// >! Hash salt stored in SSM — never hardcoded
const apiKeyHashSalt = new CachedSsmParameter(process.env.PARAM_STORE_PATH + 'Mcp_ApiKeyHashSalt');

/* ------------------------------------------------------------------ */
/*  Users Table Name                                                  */
/* ------------------------------------------------------------------ */

/** @type {string} DynamoDB Users table name from environment */
const usersTableName = process.env.MCP_DYNAMODB_USERS_TABLE || '';

/* ------------------------------------------------------------------ */
/*  Private Helper Functions                                          */
/* ------------------------------------------------------------------ */

/**
 * Extract API key from request headers.
 *
 * Checks `Authorization: Bearer <key>` first, then `X-API-Key: <key>`.
 * Header names are case-insensitive (API Gateway lowercases them).
 *
 * @private
 * @param {Object} event - API Gateway event object
 * @param {Object} [event.headers] - Request headers (lowercased by API Gateway)
 * @returns {string|null} Raw API key or null if no key header present
 * @example
 * // In tests only via TestHarness
 * const { extractApiKey } = TestHarness.getInternals();
 * const key = extractApiKey({ headers: { authorization: 'Bearer atl_abc123' } });
 * // key: 'atl_abc123'
 */
function extractApiKey(event) {
  const headers = event.headers || {};

  // >! Check Authorization: Bearer <key> first
  const authHeader = headers['authorization'] || headers['Authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const key = authHeader.slice(7).trim();
    if (key.length > 0) {
      return key;
    }
  }

  // >! Check X-API-Key header as fallback
  const apiKeyHeader = headers['x-api-key'] || headers['X-API-Key'] || '';
  if (apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * Compute the effective tier from the stored tier and its end date.
 *
 * Delegates to the tier-common layer, which is the one rule for reading
 * `tierExpiresAt` in every function. A missing end date keeps the stored tier.
 * A lapsed end date gives the remembered tier when `fallback` still holds,
 * otherwise `registered`. A malformed end date also gives `registered`.
 *
 * @private
 * @param {string} storedTier - Tier value from DynamoDB record
 * @param {string|null|undefined} tierExpiresAt - ISO 8601 string or null
 * @param {{tier: string, tierExpiresAt: (string|null)}|null} [fallback] - Remembered lower tier, if any
 * @returns {string} Effective tier: the stored tier, the remembered tier, or `registered`
 * @example
 * // In tests only via TestHarness
 * const { computeEffectiveTier } = TestHarness.getInternals();
 * computeEffectiveTier('paid', null);                        // 'paid'
 * computeEffectiveTier('paid', '2099-01-01T00:00:00.000Z');  // 'paid'
 * computeEffectiveTier('paid', '2020-01-01T00:00:00.000Z');  // 'registered'
 */
function computeEffectiveTier(storedTier, tierExpiresAt, fallback) {
  return TierCommon.computeEffectiveTier(storedTier, tierExpiresAt, undefined, fallback).tier;
}

/**
 * Build the catch handler for a fire-and-forget Users table write.
 *
 * A failed condition means the record changed or was removed since it was read.
 * That is expected, so it is logged at debug level without any identifying
 * values. Any other error is logged as a warning.
 *
 * @private
 * @param {string} write - Short write name for the log line (for example 'TTL refresh')
 * @returns {function(Error): void} Promise rejection handler
 * @example
 * // In tests only via TestHarness
 * const { onUserWriteError } = TestHarness.getInternals();
 * AWS.dynamo.update(params).catch(onUserWriteError('TTL refresh'));
 */
function onUserWriteError(write) {
  return (err) => {
    // >! A failed condition is a normal race (record changed or removed); log without pk, email, or cognitoSub
    if (err && err.name === 'ConditionalCheckFailedException') {
      DebugAndLog.debug(`Auth resolver: ${write} skipped, user record changed or removed`);
      return;
    }
    DebugAndLog.warn(`Auth resolver: ${write} failed (non-blocking)`, { error: err && err.message });
  };
}

/**
 * Renew a user record's DynamoDB TTL while its key is in use.
 *
 * When the record's TTL is less than 90 days from now, it is set to now + 120 days.
 * Any tier is renewed, whether or not the record has an end date. The caller
 * (`maintainUserRecord`) never passes a record whose tier has lapsed; that record
 * gets `downgradeLapsedTier` instead. Fire-and-forget: errors are logged, never thrown.
 *
 * @private
 * @param {string} pk - DynamoDB partition key (`KEY#<hash>`)
 * @param {Object} record - User record from DynamoDB
 * @param {number} [record.ttl] - Current TTL as Unix epoch seconds
 * @returns {void}
 * @example
 * // In tests only via TestHarness
 * const { refreshTtl } = TestHarness.getInternals();
 * refreshTtl('KEY#abc123', { ttl: soonEpochSec, tier: 'private', tierExpiresAt: null });
 */
function refreshTtl(pk, record) {
  const nowSec = Math.floor(Date.now() / 1000);

  // >! No numeric ttl, or at least 90 days left: nothing to renew
  if (typeof record.ttl !== 'number' || record.ttl >= nowSec + NINETY_DAYS_SEC) {
    return;
  }

  // >! Fire and forget — don't await; failures are handled by onUserWriteError
  AWS.dynamo.update({
    TableName: usersTableName,
    Key: { pk },
    UpdateExpression: 'SET #ttl = :newTtl',
    // >! UpdateItem creates a missing item. Without this condition, a renewal that races
    // >! key regeneration would recreate the deleted record and revive the revoked key.
    ConditionExpression: 'attribute_exists(#pk)',
    ExpressionAttributeNames: { '#pk': 'pk', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':newTtl': nowSec + ONE_TWENTY_DAYS_SEC }
  }).catch(onUserWriteError('TTL refresh'));
}

/**
 * Write a lapsed record back to the Users table.
 *
 * When a lower tier the user held is still valid, it is restored (spec
 * 0-0-7-lapsed-tier-downgrade); otherwise the record becomes an ordinary
 * `registered` record. Either way `ttl` is set to now + 120 days (no 90-day check)
 * and the two fallback attributes are removed. The write is conditional on the
 * tier and end date that were read, so a concurrent voucher redemption or key
 * regeneration is never overwritten. Fire-and-forget: errors are logged, never thrown.
 *
 * @private
 * @param {string} pk - DynamoDB partition key (`KEY#<hash>`)
 * @param {Object} record - User record from DynamoDB
 * @param {string} record.tier - Stored tier that has lapsed
 * @param {string} record.tierExpiresAt - Stored end date (ISO 8601 string) that has passed
 * @param {{state: string, restoreTo: ({tier: string, tierExpiresAt: (string|null)}|null)}} resolution - Result of `TierCommon.resolveRecordTier(record)`
 * @returns {void}
 * @example
 * // In tests only via TestHarness
 * const { downgradeLapsedTier } = TestHarness.getInternals();
 * downgradeLapsedTier('KEY#abc123', lapsedRecord, TierCommon.resolveRecordTier(lapsedRecord));
 */
function downgradeLapsedTier(pk, record, resolution) {
  const nowSec = Math.floor(Date.now() / 1000);
  const restore = resolution.restoreTo; // null, or { tier, tierExpiresAt, ... }
  const toTier = restore ? restore.tier : 'registered';

  // >! Fire and forget — don't await; failures are handled by onUserWriteError
  AWS.dynamo.update({
    TableName: usersTableName,
    Key: { pk },
    UpdateExpression: 'SET #tier = :toTier, #exp = :toExpiry, #ttl = :newTtl REMOVE #fbTier, #fbExp',
    // >! Write only if the record still holds what was read. The tier written is registered,
    // >! or a lower tier the Auth Function recorded earlier that ranks below the lapsed one.
    ConditionExpression: 'attribute_exists(#pk) AND #tier = :readTier AND #exp = :readExpiry',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#tier': 'tier',
      '#exp': 'tierExpiresAt',
      '#ttl': 'ttl',
      '#fbTier': 'fallbackTier',
      '#fbExp': 'fallbackExpiresAt'
    },
    ExpressionAttributeValues: {
      ':toTier': toTier,
      ':toExpiry': restore ? restore.tierExpiresAt : null, // null is stored as the NULL type
      ':newTtl': nowSec + ONE_TWENTY_DAYS_SEC,
      ':readTier': record.tier,
      ':readExpiry': record.tierExpiresAt
    }
  }).then(() => {
    // >! Log the tiers only; never the pk, cognitoSub, email, or key
    DebugAndLog.info(`TIER_LAPSE_DOWNGRADE ${JSON.stringify({
      fromTier: String(record.tier).slice(0, 20),
      toTier: String(toTier).slice(0, 20)
    })}`);
  }).catch(onUserWriteError('tier downgrade'));
}

/**
 * Choose the one Users table write for this request, if any.
 *
 * A lapsed tier is written back (the remembered lower tier is restored, otherwise
 * the record becomes `registered`). Any other record may get a TTL renewal. At most
 * one write is made per request: a lapsed record never also gets a separate renewal.
 *
 * @private
 * @param {string} pk - DynamoDB partition key (`KEY#<hash>`)
 * @param {Object} record - User record from DynamoDB
 * @param {{state: string}} resolution - Result of `TierCommon.resolveRecordTier(record)`
 * @returns {void}
 * @example
 * // In tests only via TestHarness
 * const { maintainUserRecord } = TestHarness.getInternals();
 * maintainUserRecord('KEY#abc123', record, TierCommon.resolveRecordTier(record));
 */
function maintainUserRecord(pk, record, resolution) {
  if (resolution.state === EXPIRY_STATE.LAPSED) {
    downgradeLapsedTier(pk, record, resolution);
    return;
  }
  refreshTtl(pk, record);
}

/* ------------------------------------------------------------------ */
/*  resolveAuth — Main Entry Point (async)                            */
/* ------------------------------------------------------------------ */

/**
 * Resolve authentication from an incoming API Gateway event.
 *
 * Flow:
 * 0. Normalize the client address into the public rate-limit identity (`toBucketKey`)
 * 1. Extract API key from headers (Bearer or X-API-Key)
 * 2. No key → return public tier result
 * 3. Key present → retrieve hash salt from SSM
 * 4. Hash key with scrypt → DynamoDB GetItem on Users table
 * 5. Key not found → return 401 error
 * 6. Key found → compute effective tier, then make at most one background write:
 *    the Downgrade for a lapsed tier, otherwise a TTL renewal if needed
 * 7. Return authenticated result with tier and cognitoSub
 *
 * Degradation: SSM or DynamoDB failures fall back to public tier
 * with `degraded: true`. Invalid keys always return 401.
 *
 * @async
 * @param {Object} event - API Gateway event object
 * @param {Object} [event.headers] - Request headers
 * @param {*} [clientAddress] - The client address cache-data resolved, from `clientRequest.getClientIp()`
 *   (with `CACHE_DATA_TRUSTED_PROXY_HOPS=0` this is API Gateway's `sourceIp`). Any value is accepted;
 *   it is validated and normalized by `toBucketKey`. The event is not read for the address.
 * @returns {Promise<Object>} Auth result object
 * @returns {string} returns.tier - Effective tier: 'public', 'registered', 'paid', or 'private'
 * @returns {string|null} returns.identity - Rate limit identity: the normalized client address for public
 *   results (IPv4, or an IPv6 /64 prefix), or cognitoSub for authenticated results. `null` is possible only on
 *   the public paths (no key, salt unavailable, salt empty, Users table read failure) and means no usable
 *   identity; the rate limiter refuses such a request
 * @returns {boolean} returns.isAuthenticated - Whether the request is authenticated
 * @returns {string} [returns.userId] - DynamoDB partition key (only for authenticated)
 * @returns {boolean} returns.degraded - Whether auth fell back to public due to infrastructure issues
 * @returns {boolean} [returns.error] - True if returning an error response
 * @returns {Object} [returns.errorResponse] - API Gateway error response (only when error is true)
 *
 * @example
 * // No API key — public tier
 * const result = await resolveAuth({ headers: {} }, '1.2.3.4');
 * // { tier: 'public', identity: '1.2.3.4', isAuthenticated: false, degraded: false }
 *
 * @example
 * // No API key and no usable client address — identity is null (the rate limiter refuses it)
 * const result = await resolveAuth({ headers: {} }, 'not-an-ip');
 * // { tier: 'public', identity: null, isAuthenticated: false, degraded: false }
 *
 * @example
 * // Valid API key — authenticated (the address is not used)
 * const result = await resolveAuth({ headers: { authorization: 'Bearer atl_abc...' } }, '1.2.3.4');
 * // { tier: 'registered', identity: 'cognito-sub-123', isAuthenticated: true, userId: 'KEY#hash', degraded: false }
 *
 * @example
 * // Invalid API key — 401 error
 * const result = await resolveAuth({ headers: { authorization: 'Bearer atl_invalid' } }, '1.2.3.4');
 * // { error: true, errorResponse: { statusCode: 401, ... } }
 */
async function resolveAuth(event, clientAddress) {
  // >! The address is cache-data's resolved client address (sourceIp at count 0), validated and
  // >! normalized here. null means "no usable identity"; the rate limiter refuses it.
  // >! No request header is read for the address.
  const publicIdentity = toBucketKey(clientAddress);
  const rawKey = extractApiKey(event);

  // >! No key present — public tier (preserves current behavior)
  if (!rawKey) {
    return {
      tier: 'public',
      identity: publicIdentity,
      isAuthenticated: false,
      degraded: false
    };
  }

  // >! Key present — attempt authenticated resolution
  let salt;
  try {
    salt = await apiKeyHashSalt.getValue();
  } catch (err) {
    // >! SSM unavailable — degrade to public, don't reject
    DebugAndLog.error('Auth resolver: hash salt unavailable — degrading to public', err.message);
    return {
      tier: 'public',
      identity: publicIdentity,
      isAuthenticated: false,
      degraded: true
    };
  }

  if (!salt) {
    // >! Salt returned empty — degrade to public
    DebugAndLog.error('Auth resolver: hash salt is empty — degrading to public');
    return {
      tier: 'public',
      identity: publicIdentity,
      isAuthenticated: false,
      degraded: true
    };
  }

  // >! scrypt hash the raw key with the salt (matches hashApiKey in auth lambda)
  const keyHash = crypto.scryptSync(rawKey, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  const pk = `KEY#${keyHash}`;

  // >! Look up user record in DynamoDB
  let record;
  try {
    const result = await AWS.dynamo.get({
      TableName: usersTableName,
      Key: { pk },
      // >! Request only what auth resolution uses. The IAM policy allows no other attributes,
      // >! and a GetItem without a projection would be denied by it (dynamodb:Attributes).
      ProjectionExpression: '#pk, #tier, #exp, #ttl, #sub, #fbTier, #fbExp',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#tier': 'tier',
        '#exp': 'tierExpiresAt',
        '#ttl': 'ttl',
        '#sub': 'cognitoSub',
        '#fbTier': 'fallbackTier',
        '#fbExp': 'fallbackExpiresAt'
      }
    });
    record = result.Item || null;
  } catch (err) {
    // >! DynamoDB unavailable — degrade to public, don't reject
    DebugAndLog.error('Auth resolver: DynamoDB lookup failed — degrading to public', err.message);
    return {
      tier: 'public',
      identity: publicIdentity,
      isAuthenticated: false,
      degraded: true
    };
  }

  // >! Key not found in Users table — return 401 (NOT degradation)
  if (!record) {
    return {
      error: true,
      errorResponse: {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Invalid API key' }
        })
      }
    };
  }

  // >! One expiry rule for every function (tier-common layer), evaluated once per request
  const resolution = TierCommon.resolveRecordTier(record);
  if (resolution.state === EXPIRY_STATE.MALFORMED) {
    // >! Fail closed: registered limits. Log the tier and a truncated value only, never pk, cognitoSub, or email.
    DebugAndLog.warn(`TIER_EXPIRY_MALFORMED ${JSON.stringify(
      TierCommon.malformedExpiryLogFields(record.tier, record.tierExpiresAt))}`);
  } else if (resolution.fallbackState === 'malformed') {
    DebugAndLog.warn(`TIER_EXPIRY_MALFORMED ${JSON.stringify(
      TierCommon.malformedExpiryLogFields(record.fallbackTier, record.fallbackExpiresAt, 'fallbackExpiresAt'))}`);
  }

  // >! Background write: Downgrade for a lapsed tier, otherwise TTL renewal (one write per request)
  maintainUserRecord(pk, record, resolution);

  return {
    tier: resolution.tier,
    identity: record.cognitoSub,
    isAuthenticated: true,
    userId: pk,
    degraded: false
  };
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
  /**
   * Get access to internal functions for testing purposes.
   * WARNING: This method is for testing only and should never be used in production.
   *
   * @returns {{extractApiKey: Function, computeEffectiveTier: Function, refreshTtl: Function, maintainUserRecord: Function, downgradeLapsedTier: Function, onUserWriteError: Function, apiKeyHashSalt: CachedSsmParameter, NINETY_DAYS_SEC: number, ONE_TWENTY_DAYS_SEC: number}} Object containing internal functions and constants
   * @private
   * @example
   * // In tests only — DO NOT use in production
   * const { TestHarness } = require('../utils/auth-resolver');
   * const { extractApiKey, computeEffectiveTier, refreshTtl } = TestHarness.getInternals();
   */
  static getInternals() {
    return {
      extractApiKey,
      computeEffectiveTier,
      refreshTtl,
      maintainUserRecord,
      downgradeLapsedTier,
      onUserWriteError,
      apiKeyHashSalt,
      NINETY_DAYS_SEC,
      ONE_TWENTY_DAYS_SEC
    };
  }
}

module.exports = {
  resolveAuth,
  TestHarness
};
