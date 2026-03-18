/**
 * Rate Limiter Utility
 *
 * Implements per-client rate limiting for MCP server access with
 * interval-aligned windows and distributed state via DynamoDB.
 *
 * @module utils/rate-limiter
 */

const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');
const crypto = require('crypto');
const settings = require('../config/settings');

/* ------------------------------------------------------------------ */
/*  Conversion Helpers & Window Calculator (private)                  */
/* ------------------------------------------------------------------ */

/**
 * Convert minutes to milliseconds.
 *
 * @private
 * @param {number} minutes - Value in minutes
 * @returns {number} Equivalent value in milliseconds
 * @example
 * // In tests only via TestHarness
 * const { convertFromMinutesToMilli } = TestHarness.getInternals();
 * convertFromMinutesToMilli(5); // 300000
 */
const convertFromMinutesToMilli = function (minutes) {
  return minutes * 60 * 1000;
};

/**
 * Convert milliseconds to minutes, rounding up to the nearest minute.
 *
 * @private
 * @param {number} milliSeconds - Value in milliseconds
 * @returns {number} Equivalent value in minutes (rounded up)
 * @example
 * // In tests only via TestHarness
 * const { convertFromMilliToMinutes } = TestHarness.getInternals();
 * convertFromMilliToMinutes(300000); // 5
 * convertFromMilliToMinutes(300001); // 6
 */
const convertFromMilliToMinutes = function (milliSeconds) {
  return Math.ceil(milliSeconds / (60 * 1000));
};

/**
 * Compute the next window reset time aligned to clock boundaries in Etc/UTC.
 *
 * The result is always strictly in the future and evenly divisible by
 * `intervalInMinutes` when measured as minutes since midnight Etc/UTC.
 *
 * @private
 * @param {number} intervalInMinutes - Window size (e.g. 5, 60, 1440)
 * @param {number} [offsetInMinutes=0] - Timezone offset from UTC (future use)
 * @returns {number} Next reset time in minutes since epoch
 * @example
 * // In tests only via TestHarness
 * const { nextIntervalInMinutes } = TestHarness.getInternals();
 * const resetMinutes = nextIntervalInMinutes(60); // next top-of-hour
 */
const nextIntervalInMinutes = function (intervalInMinutes, offsetInMinutes = 0) {
  let timestampInMinutes = convertFromMilliToMinutes(Date.now());
  // Add offset so we can calculate from midnight local time — future use
  timestampInMinutes += offsetInMinutes;
  // Convert the minutes into a date
  let date = new Date(convertFromMinutesToMilli(timestampInMinutes));
  // Round up to next interval boundary
  let coeff = convertFromMinutesToMilli(intervalInMinutes);
  let rounded = new Date(Math.ceil(date.getTime() / coeff) * coeff);
  let nextInMinutes = convertFromMilliToMinutes(rounded.getTime());
  // Revert the offset so we are looking at UTC
  nextInMinutes -= offsetInMinutes;
  return nextInMinutes;
};

/* ------------------------------------------------------------------ */
/*  RateLimitCache — LRU In-Memory Cache (private)                    */
/* ------------------------------------------------------------------ */

/**
 * LRU Map-based in-memory cache for rate limit state.
 *
 * Provides sub-millisecond access to last-known rate limit state per client.
 * Entries are evicted in LRU order when the cache reaches `maxEntries`.
 * Expired entries are lazily removed on `get` and eagerly via `cleanup()`.
 *
 * WARNING: This class is private and exposed only via TestHarness for testing.
 *
 * @private
 * @example
 * // In tests only via TestHarness
 * const { RateLimitCache } = TestHarness.getInternals();
 * const cache = new RateLimitCache({ maxEntries: 100 });
 * cache.set('key', { remaining: 10 }, Date.now() + 60000);
 * const result = cache.get('key'); // { cache: 1, data: { remaining: 10 } }
 */
class RateLimitCache {
  #cache;
  #maxEntries;
  #memoryMB;

  /**
   * Creates a new RateLimitCache instance.
   *
   * @param {Object} [options] - Configuration options
   * @param {number} [options.maxEntries] - Explicit max entries (overrides memory-based calculation)
   * @param {number} [options.entriesPerGB=5000] - Entries per GB of Lambda memory
   * @param {number} [options.defaultMaxEntries=1000] - Fallback when memory info unavailable
   */
  constructor(options = {}) {
    const {
      maxEntries,
      entriesPerGB = 5000,
      defaultMaxEntries = 1000
    } = options;

    this.#cache = new Map();

    if (maxEntries !== undefined && maxEntries !== null) {
      this.#maxEntries = maxEntries;
      this.#memoryMB = null;
    } else {
      const lambdaMemory = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      if (lambdaMemory !== undefined && lambdaMemory !== null) {
        this.#memoryMB = parseInt(lambdaMemory, 10);
        if (!isNaN(this.#memoryMB) && this.#memoryMB > 0) {
          this.#maxEntries = Math.floor((this.#memoryMB / 1024) * entriesPerGB);
        } else {
          this.#maxEntries = defaultMaxEntries;
          this.#memoryMB = null;
        }
      } else {
        this.#maxEntries = defaultMaxEntries;
        this.#memoryMB = null;
      }
    }

    if (this.#maxEntries < 1) {
      this.#maxEntries = 1;
    }
  }

  /**
   * Retrieve a cached entry by key.
   *
   * @param {string} key - Cache key
   * @returns {{cache: number, data: Object|null}} Result where cache is 0 (miss), -1 (expired), or 1 (hit)
   */
  get(key) {
    if (!this.#cache.has(key)) {
      return { cache: 0, data: null };
    }

    const entry = this.#cache.get(key);
    const now = Date.now();

    if (entry.expiresAt <= now) {
      this.#cache.delete(key);
      return { cache: -1, data: entry.value };
    }

    // LRU: move to end by re-inserting
    this.#cache.delete(key);
    this.#cache.set(key, entry);

    return { cache: 1, data: entry.value };
  }

  /**
   * Store a value in the cache with an expiration time.
   *
   * @param {string} key - Cache key
   * @param {Object} value - Value to cache
   * @param {number} expiresAt - Expiration timestamp in milliseconds since epoch
   */
  set(key, value, expiresAt) {
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    }

    if (this.#cache.size >= this.#maxEntries) {
      const oldestKey = this.#cache.keys().next().value;
      this.#cache.delete(oldestKey);
    }

    this.#cache.set(key, { value, expiresAt });
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this.#cache.clear();
  }

  /**
   * Remove all expired entries from the cache.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.#cache.entries()) {
      if (entry.expiresAt <= now) {
        this.#cache.delete(key);
      }
    }
  }

  /**
   * Return information about the cache state.
   *
   * @returns {{size: number, maxEntries: number, memoryMB: number|null}} Cache info
   */
  info() {
    return {
      size: this.#cache.size,
      maxEntries: this.#maxEntries,
      memoryMB: this.#memoryMB
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Client Identifier Hashing (private)                               */
/* ------------------------------------------------------------------ */

/**
 * Hash a client identifier with window start and salt using SHA-256.
 *
 * The composite key `rawId + windowStartMinutes + salt` ensures that:
 * - Same client in same window produces the same hash (determinism)
 * - Same client in different windows produces different hashes (cross-window uniqueness)
 * - Even if the salt leaks, cross-window correlation is prevented
 *
 * @private
 * @param {string} rawId - Raw client identifier (sourceIp or userId)
 * @param {number} windowStartMinutes - Current window start in minutes since epoch
 * @param {string} salt - Secret salt from SSM Parameter Store
 * @returns {string} 64-character hex SHA-256 hash
 * @example
 * // In tests only via TestHarness
 * const { hashClientIdentifier } = TestHarness.getInternals();
 * const hash = hashClientIdentifier('192.168.1.1', 29340, 'my-secret-salt');
 */
function hashClientIdentifier(rawId, windowStartMinutes, salt) {
  // >! Use crypto.createHash for SHA-256 to prevent client identifier exposure
  return crypto
    .createHash('sha256')
    .update(`${rawId}${windowStartMinutes}${salt}`)
    .digest('hex');
}

/* ------------------------------------------------------------------ */
/*  DynamoDB Operations (private)                                     */
/* ------------------------------------------------------------------ */

/**
 * Fetch rate limit entry from DynamoDB.
 *
 * @private
 * @param {string} pk - Partition key (hashed client identifier)
 * @returns {Promise<Object|null>} DynamoDB item or null if not found
 * @example
 * // In tests only via TestHarness
 * const { fetchFromDynamo } = TestHarness.getInternals();
 * const item = await fetchFromDynamo('abc123hash');
 */
async function fetchFromDynamo(pk) {
  const result = await AWS.dynamo.get({
    TableName: settings.dynamoDbSessionsTable,
    Key: { pk }
  });
  return result.Item || null;
}

/**
 * Atomically decrement remaining count in DynamoDB.
 *
 * Uses a condition expression to ensure `remaining` never goes below zero.
 * On `ConditionalCheckFailedException`, the client has exhausted their
 * rate limit and the function returns a rate-limited state.
 *
 * @private
 * @param {string} pk - Partition key (hashed client identifier)
 * @param {number} ttl - TTL Unix timestamp in seconds
 * @param {number} limitPerWindow - Max requests for reference
 * @returns {Promise<{remaining: number, allowed: boolean}>}
 * @example
 * // In tests only via TestHarness
 * const { decrementInDynamo } = TestHarness.getInternals();
 * const result = await decrementInDynamo('abc123hash', 1700000000, 50);
 */
async function decrementInDynamo(pk, ttl, limitPerWindow) {
  try {
    const result = await AWS.dynamo.update({
      TableName: settings.dynamoDbSessionsTable,
      Key: { pk },
      UpdateExpression: 'SET remaining = remaining - :dec',
      ConditionExpression: 'remaining > :zero',
      ExpressionAttributeValues: { ':dec': 1, ':zero': 0 },
      ReturnValues: 'ALL_NEW'
    });
    return { remaining: result.Attributes.remaining, allowed: true };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return { remaining: 0, allowed: false };
    }
    throw error;
  }
}

/**
 * Create new rate limit entry in DynamoDB for a new window.
 *
 * Sets `remaining` to `limitPerWindow - 1` since this call represents
 * the first request in the window.
 *
 * @private
 * @param {string} pk - Partition key (hashed client identifier)
 * @param {number} limitPerWindow - Max requests allowed in the window
 * @param {number} ttl - TTL Unix timestamp in seconds
 * @returns {Promise<{remaining: number, allowed: boolean}>}
 * @example
 * // In tests only via TestHarness
 * const { createInDynamo } = TestHarness.getInternals();
 * const result = await createInDynamo('abc123hash', 50, 1700000000);
 */
async function createInDynamo(pk, limitPerWindow, ttl) {
  await AWS.dynamo.put({
    TableName: settings.dynamoDbSessionsTable,
    Item: {
      pk,
      remaining: limitPerWindow - 1,
      limit: limitPerWindow,
      ttl
    }
  });
  return { remaining: limitPerWindow - 1, allowed: true };
}

/* ------------------------------------------------------------------ */
/*  Module-Level Cache Instance                                       */
/* ------------------------------------------------------------------ */

/** @type {RateLimitCache} Singleton in-memory cache for rate limit state */
const cache = new RateLimitCache();

/* ------------------------------------------------------------------ */
/*  checkRateLimit — Main Entry Point (async)                         */
/* ------------------------------------------------------------------ */

/**
 * Check if request should be rate limited.
 *
 * Wires together the in-memory cache, DynamoDB distributed state,
 * interval-aligned windows, and salted SHA-256 client identifier hashing.
 *
 * Flow:
 * 1. Extract client identifier (sourceIp for public, userId for auth)
 * 2. Compute current window start and hashed client identifier
 * 3. Check in-memory cache for valid entry in current window
 * 4. Cache hit → use cached state, background DynamoDB sync
 * 5. Cache miss / expired → await DynamoDB fetch/create
 * 6. On DynamoDB failure → fall back to in-memory-only
 * 7. On hash salt unavailable → fail closed (reject requests)
 *
 * @async
 * @param {Object} event - API Gateway event
 * @param {Object} event.requestContext - Request context
 * @param {Object} event.requestContext.identity - Identity information
 * @param {string} event.requestContext.identity.sourceIp - Client IP address
 * @param {Object} event.headers - Request headers
 * @param {string} [event.headers['X-Forwarded-For']] - Forwarded IP addresses
 * @param {Object} limits - Rate limit configurations from Config.settings().rateLimits
 * @param {{limitPerWindow: number, windowInMinutes: number}} limits.public - Public tier rate limit
 * @returns {Promise<{allowed: boolean, headers: Object, retryAfter: number|null, dynamoPromise: Promise|null}>}
 */
async function checkRateLimit(event, limits) {

  // Determine tier — currently public only (TODO: auth tiers)
  const isPublic = true;
  const tier = 'public';
  const limitPerWindow = limits.public.limitPerWindow;
  const windowInMinutes = limits.public.windowInMinutes;

  // Extract client identifier
  const rawId = isPublic
    ? (event.requestContext?.identity?.sourceIp ||
       event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
       'unknown')
    : 'auth-user'; // TODO: extract userId for authenticated tiers

  // Compute window boundaries
  const resetTimeMinutes = nextIntervalInMinutes(windowInMinutes);
  const windowStartMinutes = resetTimeMinutes - windowInMinutes;
  const resetTimeMs = convertFromMinutesToMilli(resetTimeMinutes);
  const resetTimeSec = Math.floor(resetTimeMs / 1000);

  // Obtain hash salt from SSM
  let salt;
  try {
    salt = settings.sessionHashSalt ? await settings.sessionHashSalt.getValue() : null;
  } catch (err) {
    salt = null;
  }

  // >! Fail closed if hash salt is unavailable — cannot safely identify clients
  if (!salt) {
    DebugAndLog.error('Rate limiter: hash salt unavailable — failing closed');
    const retryAfter = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));
    return {
      allowed: false,
      headers: {
        'X-RateLimit-Limit': String(limitPerWindow),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetTimeSec),
        'Retry-After': String(retryAfter)
      },
      retryAfter,
      dynamoPromise: null
    };
  }

  // Hash client identifier with window start and salt
  const pk = hashClientIdentifier(rawId, windowStartMinutes, salt);

  // Check in-memory cache
  const cached = cache.get(pk);

  // TTL for DynamoDB entries — window end + 5 minute buffer (in seconds)
  const ttlSec = resetTimeSec + 300;

  let remaining;
  let allowed;
  let dynamoPromise = null;

  if (cached.cache === 1 && cached.data && cached.data.windowStart === windowStartMinutes) {
    // Cache hit with valid window — use cached state
    remaining = cached.data.remaining;
    allowed = remaining > 0;

    if (allowed) {
      // Optimistically decrement local cache
      const newRemaining = Math.max(0, remaining - 1);
      cache.set(pk, {
        remaining: newRemaining,
        limit: limitPerWindow,
        resetTimeMinutes,
        tier,
        windowStart: windowStartMinutes
      }, resetTimeMs);

      remaining = newRemaining;

      // Background DynamoDB sync — don't await here
      dynamoPromise = decrementInDynamo(pk, ttlSec, limitPerWindow).catch(err => {
        DebugAndLog.warn('Rate limiter: DynamoDB background sync failed', { error: err.message });
      });
    }
  } else {
    // Cache miss or expired window — go to DynamoDB
    try {
      const item = await fetchFromDynamo(pk);

      if (item && item.remaining !== undefined) {
        // Existing entry in DynamoDB — decrement
        const result = await decrementInDynamo(pk, ttlSec, limitPerWindow);
        remaining = result.remaining;
        allowed = result.allowed;
      } else {
        // New window — create entry
        const result = await createInDynamo(pk, limitPerWindow, ttlSec);
        remaining = result.remaining;
        allowed = result.allowed;
      }
    } catch (err) {
      // DynamoDB failure — fall back to in-memory-only
      DebugAndLog.warn('Rate limiter: DynamoDB unavailable, falling back to in-memory', { error: err.message });

      // Use cached data if available (even expired), otherwise start fresh
      if (cached.data && cached.data.remaining !== undefined) {
        remaining = Math.max(0, cached.data.remaining - 1);
        allowed = cached.data.remaining > 0;
      } else {
        remaining = limitPerWindow - 1;
        allowed = true;
      }
    }

    // Update in-memory cache
    cache.set(pk, {
      remaining,
      limit: limitPerWindow,
      resetTimeMinutes,
      tier,
      windowStart: windowStartMinutes
    }, resetTimeMs);
  }

  // Build headers — guaranteed valid numbers, never NaN
  const headers = {
    'X-RateLimit-Limit': String(limitPerWindow),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetTimeSec)
  };

  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));

    DebugAndLog.warn('Rate limit exceeded', {
      tier,
      limit: limitPerWindow,
      window: windowInMinutes,
      resetTime: new Date(resetTimeMs).toISOString(),
      retryAfter
    });

    return {
      allowed: false,
      headers: {
        ...headers,
        'Retry-After': String(retryAfter)
      },
      retryAfter,
      dynamoPromise
    };
  }

  return {
    allowed: true,
    headers,
    retryAfter: null,
    dynamoPromise
  };
}

/**
 * Create 429 Too Many Requests response
 *
 * @param {Object} headers - Rate limit headers including Retry-After
 * @param {number} retryAfter - Seconds until rate limit resets
 * @returns {Object} API Gateway response object
 */
function createRateLimitResponse(headers, retryAfter) {
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
      retryAfter,
      resetTime: headers['X-RateLimit-Reset']
    })
  };
}

/**
 * Get current rate limit statistics (for monitoring/debugging)
 *
 * @returns {{totalTrackedClients: number, activeClients: number, cacheInfo: Object}}
 */
function getRateLimitStats() {
  cache.cleanup();
  const info = cache.info();
  return {
    totalTrackedClients: info.size,
    activeClients: info.size,
    cacheInfo: info
  };
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal classes and methods for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
  /**
   * Get access to internal functions for testing purposes.
   * WARNING: This method is for testing only and should never be used in production.
   *
   * @returns {{convertFromMinutesToMilli: Function, convertFromMilliToMinutes: Function, nextIntervalInMinutes: Function, RateLimitCache: typeof RateLimitCache, hashClientIdentifier: Function}} Object containing internal functions and classes
   * @private
   * @example
   * // In tests only — DO NOT use in production
   * const { TestHarness } = require('../utils/rate-limiter');
   * const { convertFromMinutesToMilli, convertFromMilliToMinutes, nextIntervalInMinutes } = TestHarness.getInternals();
   */
  static getInternals() {
    return {
      convertFromMinutesToMilli,
      convertFromMilliToMinutes,
      nextIntervalInMinutes,
      RateLimitCache,
      hashClientIdentifier,
      fetchFromDynamo,
      decrementInDynamo,
      createInDynamo,
      cache
    };
  }
}

module.exports = {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitStats,
  TestHarness
};
