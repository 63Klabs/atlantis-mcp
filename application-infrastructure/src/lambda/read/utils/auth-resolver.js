/**
 * Auth Resolver Utility
 *
 * Resolves API key authentication from incoming requests, performing
 * scrypt key hashing, DynamoDB user lookup, tier computation,
 * and TTL refresh for free registered users.
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
 * Compute the effective tier based on stored tier and expiration.
 *
 * If `tierExpiresAt` is set and in the past, the effective tier
 * reverts to `registered`. Otherwise the stored tier is used.
 *
 * @private
 * @param {string} storedTier - Tier value from DynamoDB record
 * @param {number|null|undefined} tierExpiresAt - Unix epoch seconds or null/undefined
 * @returns {string} Effective tier: the stored tier or `registered` if expired
 * @example
 * // In tests only via TestHarness
 * const { computeEffectiveTier } = TestHarness.getInternals();
 * computeEffectiveTier('paid', null);           // 'paid'
 * computeEffectiveTier('paid', futureEpoch);    // 'paid'
 * computeEffectiveTier('paid', pastEpoch);      // 'registered'
 */
function computeEffectiveTier(storedTier, tierExpiresAt) {
  if (tierExpiresAt != null && tierExpiresAt <= Math.floor(Date.now() / 1000)) {
    return 'registered';
  }
  return storedTier;
}

/**
 * Extract source IP from the API Gateway event.
 *
 * Checks `X-Forwarded-For` header first (first IP in chain),
 * then falls back to `requestContext.identity.sourceIp`.
 *
 * @private
 * @param {Object} event - API Gateway event object
 * @returns {string} Client IP address or 'unknown'
 * @example
 * // In tests only via TestHarness
 * const { extractSourceIp } = TestHarness.getInternals();
 * const ip = extractSourceIp({ headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' } });
 * // ip: '1.2.3.4'
 */
function extractSourceIp(event) {
  return event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim()
    || event.requestContext?.identity?.sourceIp
    || 'unknown';
}

/**
 * Background TTL refresh for free registered users.
 *
 * If the user's TTL is less than 90 days from now, updates it to
 * now + 120 days. This is a fire-and-forget operation — errors are
 * caught and logged silently.
 *
 * Only applies to free registered users (effectiveTier === 'registered'
 * AND tierExpiresAt is null/undefined, meaning not a downgraded paid user).
 *
 * @private
 * @param {string} pk - DynamoDB partition key (`KEY#<hash>`)
 * @param {Object} record - User record from DynamoDB
 * @param {number} [record.ttl] - Current TTL as Unix epoch seconds
 * @param {string} record.tier - Stored tier value
 * @param {number|null|undefined} [record.tierExpiresAt] - Tier expiration
 * @param {string} effectiveTier - Computed effective tier
 * @returns {void}
 * @example
 * // In tests only via TestHarness
 * const { refreshTtl } = TestHarness.getInternals();
 * refreshTtl('KEY#abc123', { ttl: oldTtl, tier: 'registered' }, 'registered');
 */
function refreshTtl(pk, record, effectiveTier) {
  // >! Only refresh TTL for free registered users (not downgraded paid users)
  if (effectiveTier !== 'registered') {
    return;
  }

  // >! If tierExpiresAt is set, this is a downgraded paid user — skip refresh
  if (record.tierExpiresAt != null) {
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = record.ttl;

  // >! Check if TTL is within 90 days from now
  if (ttl != null && ttl < (nowSec + NINETY_DAYS_SEC)) {
    const newTtl = nowSec + ONE_TWENTY_DAYS_SEC;

    // >! Fire and forget — don't await, catch errors silently
    AWS.dynamo.update({
      TableName: usersTableName,
      Key: { pk },
      UpdateExpression: 'SET #ttl = :newTtl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':newTtl': newTtl }
    }).catch(err => {
      DebugAndLog.warn('Auth resolver: TTL refresh failed (non-blocking)', { error: err.message });
    });
  }
}

/* ------------------------------------------------------------------ */
/*  resolveAuth — Main Entry Point (async)                            */
/* ------------------------------------------------------------------ */

/**
 * Resolve authentication from an incoming API Gateway event.
 *
 * Flow:
 * 1. Extract API key from headers (Bearer or X-API-Key)
 * 2. No key → return public tier result
 * 3. Key present → retrieve hash salt from SSM
 * 4. Hash key with scrypt → DynamoDB GetItem on Users table
 * 5. Key not found → return 401 error
 * 6. Key found → compute effective tier, trigger TTL refresh if needed
 * 7. Return authenticated result with tier and cognitoSub
 *
 * Degradation: SSM or DynamoDB failures fall back to public tier
 * with `degraded: true`. Invalid keys always return 401.
 *
 * @async
 * @param {Object} event - API Gateway event object
 * @param {Object} [event.headers] - Request headers
 * @param {Object} [event.requestContext] - Request context
 * @param {Object} [event.requestContext.identity] - Identity information
 * @param {string} [event.requestContext.identity.sourceIp] - Client IP address
 * @returns {Promise<Object>} Auth result object
 * @returns {string} returns.tier - Effective tier: 'public', 'registered', 'paid', or 'private'
 * @returns {string} returns.identity - Rate limit identity (IP for public, cognitoSub for authenticated)
 * @returns {boolean} returns.isAuthenticated - Whether the request is authenticated
 * @returns {string} [returns.userId] - DynamoDB partition key (only for authenticated)
 * @returns {boolean} returns.degraded - Whether auth fell back to public due to infrastructure issues
 * @returns {boolean} [returns.error] - True if returning an error response
 * @returns {Object} [returns.errorResponse] - API Gateway error response (only when error is true)
 *
 * @example
 * // No API key — public tier
 * const result = await resolveAuth({ headers: {}, requestContext: { identity: { sourceIp: '1.2.3.4' } } });
 * // { tier: 'public', identity: '1.2.3.4', isAuthenticated: false, degraded: false }
 *
 * @example
 * // Valid API key — authenticated
 * const result = await resolveAuth({ headers: { authorization: 'Bearer atl_abc...' } });
 * // { tier: 'registered', identity: 'cognito-sub-123', isAuthenticated: true, userId: 'KEY#hash', degraded: false }
 *
 * @example
 * // Invalid API key — 401 error
 * const result = await resolveAuth({ headers: { authorization: 'Bearer atl_invalid' } });
 * // { error: true, errorResponse: { statusCode: 401, ... } }
 */
async function resolveAuth(event) {
  const sourceIp = extractSourceIp(event);
  const rawKey = extractApiKey(event);

  // >! No key present — public tier (preserves current behavior)
  if (!rawKey) {
    return {
      tier: 'public',
      identity: sourceIp,
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
      identity: sourceIp,
      isAuthenticated: false,
      degraded: true
    };
  }

  if (!salt) {
    // >! Salt returned empty — degrade to public
    DebugAndLog.error('Auth resolver: hash salt is empty — degrading to public');
    return {
      tier: 'public',
      identity: sourceIp,
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
      Key: { pk }
    });
    record = result.Item || null;
  } catch (err) {
    // >! DynamoDB unavailable — degrade to public, don't reject
    DebugAndLog.error('Auth resolver: DynamoDB lookup failed — degrading to public', err.message);
    return {
      tier: 'public',
      identity: sourceIp,
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
          error: { code: -32001, message: 'Invalid API key' },
          id: null
        })
      }
    };
  }

  // >! Compute effective tier (handles tier expiration)
  const effectiveTier = computeEffectiveTier(record.tier, record.tierExpiresAt);

  // >! Background TTL refresh for free registered users
  refreshTtl(pk, record, effectiveTier);

  return {
    tier: effectiveTier,
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
   * @returns {{extractApiKey: Function, computeEffectiveTier: Function, refreshTtl: Function, extractSourceIp: Function, apiKeyHashSalt: CachedSsmParameter, NINETY_DAYS_SEC: number, ONE_TWENTY_DAYS_SEC: number}} Object containing internal functions and constants
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
      extractSourceIp,
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
