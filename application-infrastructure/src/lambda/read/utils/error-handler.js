/**
 * Error Handling Utilities for Atlantis MCP Server
 *
 * Provides centralized error handling, categorization, and logging utilities.
 * Implements comprehensive error handling patterns including:
 * - Error categorization (4xx client errors, 5xx server errors)
 * - User-friendly error messages (no internal details)
 * - Structured error logging with context
 * - Request ID tracking
 * - CloudWatch metrics emission
 *
 * @module utils/error-handler
 */

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Error categories for classification
 */
const ErrorCategory = {
  CLIENT_ERROR: 'CLIENT_ERROR',     // 4xx errors - user input issues
  SERVER_ERROR: 'SERVER_ERROR',     // 5xx errors - internal failures
  VALIDATION_ERROR: 'VALIDATION_ERROR', // Input validation failures
  NOT_FOUND: 'NOT_FOUND',           // Resource not found
  RATE_LIMIT: 'RATE_LIMIT',         // Rate limit exceeded
  EXTERNAL_SERVICE: 'EXTERNAL_SERVICE', // External service failures (S3, GitHub)
  CACHE_ERROR: 'CACHE_ERROR'        // Cache operation failures
};

/**
 * Standard error codes
 */
const ErrorCode = {
  INVALID_INPUT: 'INVALID_INPUT',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  STARTER_NOT_FOUND: 'STARTER_NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  S3_ERROR: 'S3_ERROR',
  GITHUB_ERROR: 'GITHUB_ERROR',
  CACHE_ERROR: 'CACHE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED'
};

/**
 * Create a standardized error object
 *
 * @param {Object} options - Error options
 * @param {string} options.code - Error code from ErrorCode
 * @param {string} options.message - User-friendly error message
 * @param {ErrorCategory} options.category - Error category
 * @param {number} options.statusCode - HTTP status code
 * @param {Object} [options.details] - Additional error details (for logging only)
 * @param {Error} [options.originalError] - Original error object
 * @param {string} [options.requestId] - Request ID for tracking
 * @returns {Error} Standardized error object
 */
function createError({ code, message, category, statusCode, details, originalError, requestId }) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.statusCode = statusCode;
  error.details = details;
  error.originalError = originalError;
  error.requestId = requestId;
  error.timestamp = new Date().toISOString();

  return error;
}

/**
 * Log error with full context
 *
 * Uses appropriate DebugAndLog level based on error category:
 * - CLIENT_ERROR: warn (user input issues)
 * - SERVER_ERROR: error (internal failures)
 * - EXTERNAL_SERVICE: warn (brown-out scenarios)
 *
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 * @param {string} [context.tool] - MCP tool name
 * @param {string} [context.requestId] - Request ID
 * @param {string} [context.ip] - Client IP address
 * @param {Object} [context.parameters] - Request parameters
 */
function logError(error, context = {}) {
  const logContext = {
    error: error.message,
    code: error.code,
    category: error.category,
    statusCode: error.statusCode,
    requestId: error.requestId || context.requestId,
    timestamp: error.timestamp,
    tool: context.tool,
    ip: context.ip,
    parameters: context.parameters,
    // >! Include stack trace for server errors only
    stack: error.category === ErrorCategory.SERVER_ERROR ? error.stack : undefined,
    // >! Include original error details for debugging
    originalError: error.originalError ? {
      message: error.originalError.message,
      name: error.originalError.name,
      code: error.originalError.code
    } : undefined,
    // >! Include additional details for debugging (not sent to client)
    details: error.details
  };

  // >! Use appropriate log level based on error category
  switch (error.category) {
    case ErrorCategory.CLIENT_ERROR:
    case ErrorCategory.VALIDATION_ERROR:
    case ErrorCategory.NOT_FOUND:
      // >! Client errors are warnings - user input issues
      DebugAndLog.warn('Client error', logContext);
      break;

    case ErrorCategory.EXTERNAL_SERVICE:
      // >! External service errors are warnings - brown-out scenarios
      DebugAndLog.warn('External service error', logContext);
      break;

    case ErrorCategory.RATE_LIMIT:
      // >! Rate limit violations are informational
      DebugAndLog.info('Rate limit exceeded', logContext);
      break;

    case ErrorCategory.SERVER_ERROR:
    case ErrorCategory.CACHE_ERROR:
    default:
      // >! Server errors are fatal errors
      DebugAndLog.error('Server error', logContext);
      break;
  }
}

/**
 * Log S3 operation failure with bucket name, key, and error details
 *
 * @param {Object} options - Logging options
 * @param {string} options.operation - S3 operation (GetObject, ListObjects, etc.)
 * @param {string} options.bucket - S3 bucket name
 * @param {string} [options.key] - S3 object key
 * @param {Error} options.error - Error object
 * @param {string} [options.requestId] - Request ID
 */
function logS3Error({ operation, bucket, key, error, requestId }) {
  // >! Log S3 operation failures with bucket name, key, error details
  // >! Don't expose sensitive information in logs
  DebugAndLog.warn('S3 operation failed', {
    operation,
    bucket,
    key,
    error: error.message,
    errorCode: error.code || error.name,
    requestId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log GitHub API failure with repository, user/org, endpoint, and error details
 *
 * @param {Object} options - Logging options
 * @param {string} options.operation - GitHub operation (getRepository, listRepositories, etc.)
 * @param {string} [options.repository] - Repository name
 * @param {string} [options.userOrg] - GitHub user or organization
 * @param {string} [options.endpoint] - API endpoint
 * @param {Error} options.error - Error object
 * @param {string} [options.requestId] - Request ID
 */
function logGitHubError({ operation, repository, userOrg, endpoint, error, requestId }) {
  // >! Log GitHub API failures with repository, user/org, endpoint, error details
  // >! Log which specific org failed without exposing sensitive info
  DebugAndLog.warn('GitHub API operation failed', {
    operation,
    repository,
    userOrg,
    endpoint,
    error: error.message,
    errorCode: error.code || error.name,
    statusCode: error.status,
    requestId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Convert error to user-friendly response
 *
 * Removes internal implementation details and returns sanitized error message.
 *
 * @param {Error} error - Error object
 * @param {string} [requestId] - Request ID
 * @returns {Object} User-friendly error response
 */
function toUserResponse(error, requestId) {
  // >! Return user-friendly error messages (no internal details)
  const response = {
    error: error.code || 'INTERNAL_ERROR',
    message: error.message,
    requestId: requestId || error.requestId,
    timestamp: error.timestamp || new Date().toISOString()
  };

  // >! Include additional helpful information for specific error types
  if (error.code === ErrorCode.TEMPLATE_NOT_FOUND && error.availableTemplates) {
    response.availableTemplates = error.availableTemplates;
  }

  if (error.code === ErrorCode.UNKNOWN_TOOL && error.availableTools) {
    response.availableTools = error.availableTools;
  }

  if (error.code === ErrorCode.RATE_LIMIT_EXCEEDED && error.retryAfter) {
    response.retryAfter = error.retryAfter;
  }

  return response;
}

/**
 * Categorize error as 4xx (client) or 5xx (server)
 *
 * @param {Error} error - Error object
 * @returns {number} HTTP status code
 */
function getStatusCode(error) {
  // >! Handle null or undefined errors
  if (!error) {
    return 500;
  }

  // >! Categorize errors as 4xx (client) or 5xx (server)
  if (error.statusCode) {
    return error.statusCode;
  }

  switch (error.category) {
    case ErrorCategory.CLIENT_ERROR:
    case ErrorCategory.VALIDATION_ERROR:
      return 400;

    case ErrorCategory.NOT_FOUND:
      return 404;

    case ErrorCategory.RATE_LIMIT:
      return 429;

    case ErrorCategory.SERVER_ERROR:
    case ErrorCategory.CACHE_ERROR:
    case ErrorCategory.EXTERNAL_SERVICE:
    default:
      return 500;
  }
}

/**
 * Log request with timestamp, IP, tool name, execution time
 *
 * @param {Object} options - Request logging options
 * @param {string} options.tool - MCP tool name
 * @param {string} options.method - HTTP method
 * @param {string} options.path - Request path
 * @param {string} options.ip - Client IP address
 * @param {string} options.requestId - Request ID
 * @param {number} options.executionTime - Execution time in milliseconds
 * @param {number} options.statusCode - Response status code
 * @param {boolean} [options.cacheHit] - Whether response was served from cache
 */
function logRequest({ tool, method, path, ip, requestId, executionTime, statusCode, cacheHit }) {
  // >! Log all requests with timestamp, IP, tool name, execution time
  DebugAndLog.info('Request processed', {
    tool,
    method,
    path,
    ip,
    requestId,
    executionTime,
    statusCode,
    cacheHit,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit CloudWatch metric for error rate
 *
 * @param {Object} options - Metric options
 * @param {string} options.tool - MCP tool name
 * @param {string} options.errorCode - Error code
 * @param {number} options.statusCode - HTTP status code
 */
function emitErrorMetric({ tool, errorCode, statusCode }) {
  // >! Emit CloudWatch metrics for error rates
  // TODO: Implement CloudWatch metrics emission
  // For now, log metric data for debugging
  DebugAndLog.debug('Error metric', {
    metricName: 'ErrorCount',
    tool,
    errorCode,
    statusCode,
    value: 1,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit CloudWatch metric for latency
 *
 * @param {Object} options - Metric options
 * @param {string} options.tool - MCP tool name
 * @param {number} options.latency - Latency in milliseconds
 * @param {boolean} [options.cacheHit] - Whether response was served from cache
 */
function emitLatencyMetric({ tool, latency, cacheHit }) {
  // >! Emit CloudWatch metrics for latency
  // TODO: Implement CloudWatch metrics emission
  // For now, log metric data for debugging
  DebugAndLog.debug('Latency metric', {
    metricName: 'Latency',
    tool,
    latency,
    cacheHit,
    value: latency,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit CloudWatch metric for cache performance
 *
 * @param {Object} options - Metric options
 * @param {string} options.tool - MCP tool name
 * @param {boolean} options.cacheHit - Whether cache hit occurred
 * @param {string} [options.cacheType] - Cache type (memory, dynamodb, s3)
 */
function emitCacheMetric({ tool, cacheHit, cacheType }) {
  // >! Emit CloudWatch metrics for cache performance
  // TODO: Implement CloudWatch metrics emission
  // For now, log metric data for debugging
  DebugAndLog.debug('Cache metric', {
    metricName: cacheHit ? 'CacheHit' : 'CacheMiss',
    tool,
    cacheType,
    value: 1,
    timestamp: new Date().toISOString()
  });
}

/**
 * Wrap async function with error handling
 *
 * Catches errors, logs them, and converts to user-friendly responses.
 *
 * @param {Function} fn - Async function to wrap
 * @param {Object} context - Error context
 * @returns {Function} Wrapped function
 */
function wrapWithErrorHandling(fn, context = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      // Log error with context
      logError(error, context);

      // Emit error metric
      emitErrorMetric({
        tool: context.tool,
        errorCode: error.code || 'UNKNOWN_ERROR',
        statusCode: getStatusCode(error)
      });

      // Re-throw for caller to handle
      throw error;
    }
  };
}

module.exports = {
  ErrorCategory,
  ErrorCode,
  createError,
  logError,
  logS3Error,
  logGitHubError,
  toUserResponse,
  getStatusCode,
  logRequest,
  emitErrorMetric,
  emitLatencyMetric,
  emitCacheMetric,
  wrapWithErrorHandling
};
