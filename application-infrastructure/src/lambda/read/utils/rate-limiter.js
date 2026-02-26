/**
 * Rate Limiter Utility
 *
 * Implements per-IP rate limiting for MCP server public access.
 * Tracks request counts per IP address and enforces hourly limits.
 * 
 * TODO: Move this to a proper DynamoDB implementation later
 *
 * @module utils/rate-limiter
 */

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * In-memory store for rate limit tracking
 * Structure: { ipAddress: { count: number, resetTime: number } }
 *
 * Note: This is per-Lambda instance. For distributed rate limiting,
 * consider using DynamoDB or ElastiCache in future phases.
 */
const rateLimitStore = new Map();

/**
 * Clean up expired rate limit entries
 * Removes entries where resetTime has passed
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now >= data.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}

/**
 * Get rate limit data for client
 *
 * @param {string} user - Client IP address or User Id
 * @param {number} limit - Rate limit threshold
 * @param {number} window - Time window in seconds
 * @returns {{count: number, resetTime: number, remaining: number, isLimited: boolean}}
 */
function getRateLimitData(user, limit, window) {
  const now = Date.now();
  const resetWindow = window * 1000; // 1 hour in milliseconds

  // Clean up expired entries periodically
  if (Math.random() < 0.1) { // 10% chance to cleanup on each request
    cleanupExpiredEntries();
  }

  let data = rateLimitStore.get(user);

  // Initialize or reset if expired
  if (!data || now >= data.resetTime) {
    data = {
      count: 0,
      resetTime: now + resetWindow
    };
    rateLimitStore.set(user, data);
  }

  const remaining = Math.max(0, limit - data.count);
  const isLimited = data.count >= limit;

  return {
    count: data.count,
    resetTime: data.resetTime,
    remaining,
    isLimited
  };
}

/**
 * Increment request count for an IP address
 *
 * @param {string} user - Client IP address or User Id
 */
function incrementRequestCount(user) {
  const data = rateLimitStore.get(user);
  if (data) {
    data.count++;
  }
}

/**
 * Check if request should be rate limited.
 * 
 * This function integrates with Config.settings().rateLimits to enforce
 * rate limits based on the configured thresholds for different access tiers.
 * 
 * Rate Limit Integration:
 * - Retrieves rate limit configuration from Config.settings().rateLimits
 * - Supports multiple access tiers: public, registered, paid, private
 * - Currently enforces public tier limits (TODO: implement authentication)
 * - Tracks requests per IP address with automatic expiration
 * 
 * Rate Limit Headers:
 * - X-RateLimit-Limit: Maximum requests allowed in window
 * - X-RateLimit-Remaining: Requests remaining in current window
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 * - Retry-After: Seconds to wait before retrying (only when limited)
 * 
 * @param {Object} event - API Gateway event
 * @param {Object} event.requestContext - Request context
 * @param {Object} event.requestContext.identity - Identity information
 * @param {string} event.requestContext.identity.sourceIp - Client IP address
 * @param {Object} event.headers - Request headers
 * @param {string} [event.headers['X-Forwarded-For']] - Forwarded IP addresses
 * @param {Object} limits - Rate limit configurations from Config.settings().rateLimits
 * @param {{limit: number, window: number}} limits.public - Public tier rate limit
 * @param {{limit: number, window: number}} limits.registered - Registered tier rate limit
 * @param {{limit: number, window: number}} limits.paid - Paid tier rate limit
 * @param {{limit: number, window: number}} limits.private - Private tier rate limit
 * @returns {{allowed: boolean, headers: Object, retryAfter: number|null}} Rate limit result
 * @returns {boolean} returns.allowed - Whether request is allowed
 * @returns {Object} returns.headers - Rate limit headers to include in response
 * @returns {number|null} returns.retryAfter - Seconds until limit resets (null if allowed)
 * @example
 * // In Lambda handler
 * const { Config } = require('./config');
 * const RateLimiter = require('./utils/rate-limiter');
 * 
 * exports.handler = async (event, context) => {
 *   // Check rate limit using Config.settings()
 *   const rateLimitCheck = RateLimiter.checkRateLimit(
 *     event,
 *     Config.settings().rateLimits
 *   );
 *   
 *   if (!rateLimitCheck.allowed) {
 *     // Return 429 Too Many Requests
 *     return RateLimiter.createRateLimitResponse(
 *       rateLimitCheck.headers,
 *       rateLimitCheck.retryAfter
 *     );
 *   }
 *   
 *   // Process request with rate limit headers
 *   const response = await processRequest(event);
 *   response.headers = {
 *     ...response.headers,
 *     ...rateLimitCheck.headers
 *   };
 *   return response;
 * };
 */
function checkRateLimit(event, limits) {

  // is it public or auth? - TODO: we will update in the future for auth plans
  const isPublic = true;

  // we are just going to use the public limit for now - TODO: we will update in the future for auth plans
  const limit = limits.public.limit;
  const window = limits.public.window;

  const ipAddress = event.requestContext?.identity?.sourceIp ||
      event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
      'unknown'
  
  // Extract IP address or user info from event - TODO: we will update in the future for auth plans
  const user = (isPublic) ? ipAddress : 'auth-user';
  const client = {user, limit, window};

  // Get current rate limit data for user/ip
  const rateLimitData = getRateLimitData(client);

  // Prepare rate limit headers
  const headers = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(rateLimitData.remaining),
    'X-RateLimit-Reset': String(Math.floor(rateLimitData.resetTime / 1000)) // Unix timestamp in seconds
  };

  // Check if rate limited
  if (rateLimitData.isLimited) {
    const retryAfter = Math.ceil((rateLimitData.resetTime - Date.now()) / 1000); // seconds

    // Log rate limit violation
    DebugAndLog.warn('Rate limit exceeded', {
      ipAddress,
      currentCount: rateLimitData.count,
      limit,
      resetTime: new Date(rateLimitData.resetTime).toISOString(),
      retryAfter
    });

    return {
      allowed: false,
      headers: {
        ...headers,
        'Retry-After': String(retryAfter)
      },
      retryAfter
    };
  }

  // Increment count for allowed request
  incrementRequestCount(ipAddress);

  // Update remaining count after increment
  headers['X-RateLimit-Remaining'] = String(Math.max(0, rateLimitData.remaining - 1));

  return {
    allowed: true,
    headers,
    retryAfter: null
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
 * @returns {{totalTrackedIPs: number, activeIPs: number}}
 */
function getRateLimitStats() {
  cleanupExpiredEntries();
  return {
    totalTrackedIPs: rateLimitStore.size,
    activeIPs: rateLimitStore.size
  };
}

module.exports = {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitStats
};
