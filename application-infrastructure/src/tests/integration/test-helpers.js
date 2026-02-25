/**
 * Test Helpers for Integration Tests
 *
 * Provides utility functions for creating test fixtures and mocks
 * used across integration tests.
 */

/**
 * Create a mock Lambda context object
 *
 * @param {Object} options - Context options
 * @param {string} options.requestId - Request ID (default: auto-generated)
 * @param {string} options.functionName - Function name (default: 'test-function')
 * @param {number} options.remainingTime - Remaining time in ms (default: 30000)
 * @returns {Object} Mock Lambda context
 */
function createMockContext(options = {}) {
  return {
    requestId: options.requestId || `test-request-${Date.now()}`,
    functionName: options.functionName || 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '512',
    awsRequestId: options.requestId || `test-request-${Date.now()}`,
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2024/01/01/[$LATEST]test',
    getRemainingTimeInMillis: () => options.remainingTime || 30000,
    callbackWaitsForEmptyEventLoop: true,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };
}

/**
 * Create a mock API Gateway event object
 *
 * @param {Object} options - Event options
 * @param {string} options.httpMethod - HTTP method (default: 'POST')
 * @param {string} options.path - Request path (default: '/mcp')
 * @param {Object} options.body - Request body object (will be JSON stringified)
 * @param {Object} options.headers - Request headers
 * @param {Object} options.queryStringParameters - Query parameters
 * @param {string} options.sourceIp - Source IP address (default: '192.168.1.1')
 * @param {string} options.requestId - Request ID (default: auto-generated)
 * @returns {Object} Mock API Gateway event
 */
function createMockEvent(options = {}) {
  const requestId = options.requestId || `test-request-${Date.now()}`;
  const sourceIp = options.sourceIp || '192.168.1.1';

  return {
    httpMethod: options.httpMethod || 'POST',
    path: options.path || '/mcp',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': sourceIp,
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : null,
    queryStringParameters: options.queryStringParameters || null,
    requestContext: {
      requestId,
      identity: {
        sourceIp,
        userAgent: 'test-agent'
      },
      stage: 'test',
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now()
    },
    isBase64Encoded: false
  };
}

/**
 * Create a mock MCP tool request event
 *
 * @param {string} tool - Tool name (e.g., 'list_templates')
 * @param {Object} input - Tool input parameters
 * @param {Object} options - Additional event options
 * @returns {Object} Mock API Gateway event for MCP tool request
 */
function createMCPToolRequest(tool, input = {}, options = {}) {
  return createMockEvent({
    ...options,
    body: {
      tool,
      input
    }
  });
}

module.exports = {
  createMockContext,
  createMockEvent,
  createMCPToolRequest
};
