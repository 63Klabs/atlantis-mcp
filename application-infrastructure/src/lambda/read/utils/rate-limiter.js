/**
 * Rate Limiter Utility
 * 
 * Implements per-IP rate limiting for MCP server public access.
 * Tracks request counts per IP address and enforces hourly limits.
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
 * Get rate limit data for an IP address
 * 
 * @param {string} ipAddress - Client IP address
 * @param {number} limit - Rate limit threshold
 * @returns {{count: number, resetTime: number, remaining: number, isLimited: boolean}}
 */
function getRateLimitData(ipAddress, limit) {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
  
  // Clean up expired entries periodically
  if (Math.random() < 0.1) { // 10% chance to cleanup on each request
    cleanupExpiredEntries();
  }
  
  let data = rateLimitStore.get(ipAddress);
  
  // Initialize or reset if expired
  if (!data || now >= data.resetTime) {
    data = {
      count: 0,
      resetTime: now + oneHour
    };
    rateLimitStore.set(ipAddress, data);
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
 * @param {string} ipAddress - Client IP address
 */
function incrementRequestCount(ipAddress) {
  const data = rateLimitStore.get(ipAddress);
  if (data) {
    data.count++;
  }
}

/**
 * Check if request should be rate limited
 * 
 * @param {Object} event - API Gateway event
 * @param {number} limit - Rate limit threshold (requests per hour)
 * @returns {{allowed: boolean, headers: Object, retryAfter: number|null}}
 */
function checkRateLimit(event, limit) {
  // Extract IP address from event
  const ipAddress = event.requestContext?.identity?.sourceIp || 
                    event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
                    'unknown';
  
  // Get current rate limit data
  const rateLimitData = getRateLimitData(ipAddress, limit);
  
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
