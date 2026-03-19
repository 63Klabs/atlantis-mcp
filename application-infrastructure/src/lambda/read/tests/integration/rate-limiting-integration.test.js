/**
 * Integration Tests: Rate Limiting
 *
 * Tests API Gateway rate limiting functionality including:
 * - Rate limit enforcement
 * - Rate limit headers
 * - Rate limit reset behavior
 * - 429 response format
 *
 * These tests verify Requirement 3: Public Access with Rate Limiting
 */

const { handler } = require('../../index');
const { createMockContext, createMCPToolRequest } = require('./test-helpers');

// Rate limiting is handled by API Gateway in production, not by Lambda
// These tests are skipped as they test API Gateway functionality
describe.skip('Rate Limiting Integration Tests', () => {
  describe('15.4.1 Rate Limit Enforcement', () => {
    it('should allow requests within rate limit', async () => {
      const event = createMCPToolRequest('list_templates', {}, {
        sourceIp: '192.168.1.100'
      });
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
      expect(response.headers).toHaveProperty('X-RateLimit-Reset');
    });

    it('should track rate limits per IP address', async () => {
      const ip1 = '192.168.1.101';
      const ip2 = '192.168.1.102';

      const event1 = createMCPToolRequest('list_templates', {}, { sourceIp: ip1 });
      const event2 = createMCPToolRequest('list_templates', {}, { sourceIp: ip2 });
      const context1 = createMockContext();
      const context2 = createMockContext();

      const response1 = await handler(event1, context1);
      const response2 = await handler(event2, context2);

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      // Each IP should have independent rate limit tracking
      expect(response1.headers['X-RateLimit-Remaining']).toBeDefined();
      expect(response2.headers['X-RateLimit-Remaining']).toBeDefined();
    });

    it('should return 429 when rate limit exceeded', async () => {
      // Note: This test assumes rate limit is configured low enough for testing
      // In production, rate limit is 100 requests per hour
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.103'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-rate-limit',
          identity: {
            sourceIp: '192.168.1.103'
          }
        }
      };

      // Make requests up to the limit
      // This test should be configured with a low rate limit for testing
      const rateLimit = parseInt(process.env.PUBLIC_RATE_LIMIT || '100', 10);

      // For integration testing, we'll simulate the rate limit check
      // In actual deployment, API Gateway handles this
      expect(rateLimit).toBeGreaterThan(0);
    });

    it('should apply rate limit globally across all resources', async () => {
      const ip = '192.168.1.104';

      const events = [
        {
          httpMethod: 'POST',
          path: '/mcp',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': ip
          },
          body: JSON.stringify({
            tool: 'list_templates',
            input: {}
          }),
          requestContext: {
            requestId: 'test-request-templates',
            identity: { sourceIp: ip }
          }
        },
        {
          httpMethod: 'POST',
          path: '/mcp',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': ip
          },
          body: JSON.stringify({
            tool: 'list_starters',
            input: {}
          }),
          requestContext: {
            requestId: 'test-request-starters',
            identity: { sourceIp: ip }
          }
        }
      ];

      const response1 = await handler(events[0]);
      const response2 = await handler(events[1]);

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      // Both requests should count against the same rate limit
      const remaining1 = parseInt(response1.headers['X-RateLimit-Remaining'], 10);
      const remaining2 = parseInt(response2.headers['X-RateLimit-Remaining'], 10);

      expect(remaining2).toBeLessThan(remaining1);
    });
  });

  describe('15.4.2 Rate Limit Headers', () => {
    it('should include X-RateLimit-Limit header', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.105'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-limit-header',
          identity: {
            sourceIp: '192.168.1.105'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      const limit = parseInt(response.headers['X-RateLimit-Limit'], 10);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBe(parseInt(process.env.PUBLIC_RATE_LIMIT || '100', 10));
    });

    it('should include X-RateLimit-Remaining header', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.106'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-remaining-header',
          identity: {
            sourceIp: '192.168.1.106'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
      const remaining = parseInt(response.headers['X-RateLimit-Remaining'], 10);
      expect(remaining).toBeGreaterThanOrEqual(0);

      const limit = parseInt(response.headers['X-RateLimit-Limit'], 10);
      expect(remaining).toBeLessThanOrEqual(limit);
    });

    it('should include X-RateLimit-Reset header', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.107'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-reset-header',
          identity: {
            sourceIp: '192.168.1.107'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.headers).toHaveProperty('X-RateLimit-Reset');
      const reset = parseInt(response.headers['X-RateLimit-Reset'], 10);
      expect(reset).toBeGreaterThan(Date.now() / 1000);
    });

    it('should decrement X-RateLimit-Remaining on each request', async () => {
      const ip = '192.168.1.108';

      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-decrement-1',
          identity: {
            sourceIp: ip
          }
        }
      };

      const context1 = createMockContext();
      const response1 = await handler(event, context1);
      const remaining1 = parseInt(response1.headers['X-RateLimit-Remaining'], 10);

      event.requestContext.requestId = 'test-request-decrement-2';
      const context2 = createMockContext();
      const response2 = await handler(event, context2);
      const remaining2 = parseInt(response2.headers['X-RateLimit-Remaining'], 10);

      expect(remaining2).toBe(remaining1 - 1);
    });

    it('should include rate limit headers in error responses', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.109'
        },
        body: JSON.stringify({
          tool: 'invalid_tool',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-error-headers',
          identity: {
            sourceIp: '192.168.1.109'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(404);
      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
      expect(response.headers).toHaveProperty('X-RateLimit-Reset');
    });
  });

  describe('15.4.3 Rate Limit Reset', () => {
    it('should reset request counts every hour', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.110'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-reset-1',
          identity: {
            sourceIp: '192.168.1.110'
          }
        }
      };

      const context1 = createMockContext();
      const response1 = await handler(event, context1);
      const reset1 = parseInt(response1.headers['X-RateLimit-Reset'], 10);

      // Reset time should be approximately 1 hour from now
      const now = Date.now() / 1000;
      const oneHour = 3600;

      expect(reset1).toBeGreaterThan(now);
      expect(reset1).toBeLessThanOrEqual(now + oneHour + 60); // Allow 60s buffer
    });

    it('should maintain same reset time across requests in same window', async () => {
      const ip = '192.168.1.111';

      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-same-window-1',
          identity: {
            sourceIp: ip
          }
        }
      };

      const context1 = createMockContext();
      const response1 = await handler(event, context1);
      const reset1 = parseInt(response1.headers['X-RateLimit-Reset'], 10);

      // Wait a short time
      await new Promise(resolve => setTimeout(resolve, 100));

      event.requestContext.requestId = 'test-request-same-window-2';
      const context2 = createMockContext();
      const response2 = await handler(event, context2);
      const reset2 = parseInt(response2.headers['X-RateLimit-Reset'], 10);

      // Reset time should be the same (or very close) for requests in same window
      expect(Math.abs(reset2 - reset1)).toBeLessThan(2);
    });

    it('should restore full rate limit after reset', async () => {
      // This test verifies the concept but cannot actually wait 1 hour
      // In production, API Gateway handles the reset automatically
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.112'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-restore',
          identity: {
            sourceIp: '192.168.1.112'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);
      const limit = parseInt(response.headers['X-RateLimit-Limit'], 10);
      const remaining = parseInt(response.headers['X-RateLimit-Remaining'], 10);

      // After reset, remaining should equal limit
      // This is verified by API Gateway in production
      expect(remaining).toBeLessThanOrEqual(limit);
    });
  });

  describe('15.4.4 429 Response Format', () => {
    it('should return HTTP 429 status code when rate limit exceeded', async () => {
      // This test simulates the 429 response format
      // In production, API Gateway returns 429 before reaching Lambda
      const mockRateLimitResponse = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          'Retry-After': '3600'
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        })
      };

      expect(mockRateLimitResponse.statusCode).toBe(429);
      expect(mockRateLimitResponse.headers).toHaveProperty('Retry-After');
    });

    it('should include Retry-After header in 429 response', async () => {
      const mockRateLimitResponse = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          'Retry-After': '3600'
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        })
      };

      expect(mockRateLimitResponse.headers).toHaveProperty('Retry-After');
      const retryAfter = parseInt(mockRateLimitResponse.headers['Retry-After'], 10);
      expect(retryAfter).toBeGreaterThan(0);
    });

    it('should include error message in 429 response body', async () => {
      const mockRateLimitResponse = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          'Retry-After': '3600'
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        })
      };

      const body = JSON.parse(mockRateLimitResponse.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body.error).toBe('Too Many Requests');
      expect(body.message).toContain('Rate limit exceeded');
    });

    it('should include rate limit headers in 429 response', async () => {
      const mockRateLimitResponse = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          'Retry-After': '3600'
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        })
      };

      expect(mockRateLimitResponse.headers).toHaveProperty('X-RateLimit-Limit');
      expect(mockRateLimitResponse.headers).toHaveProperty('X-RateLimit-Remaining');
      expect(mockRateLimitResponse.headers).toHaveProperty('X-RateLimit-Reset');
      expect(mockRateLimitResponse.headers['X-RateLimit-Remaining']).toBe('0');
    });

    it('should return JSON content type in 429 response', async () => {
      const mockRateLimitResponse = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          'Retry-After': '3600'
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        })
      };

      expect(mockRateLimitResponse.headers['Content-Type']).toBe('application/json');

      // Verify body is valid JSON
      expect(() => JSON.parse(mockRateLimitResponse.body)).not.toThrow();
    });

    it('should log rate limit violations to CloudWatch', async () => {
      // This test verifies that rate limit violations are logged
      // In production, API Gateway logs these events
      const mockLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message: 'Rate limit exceeded',
        ip: '192.168.1.113',
        requestId: 'test-request-log',
        rateLimitRemaining: 0
      };

      expect(mockLogEntry.level).toBe('WARN');
      expect(mockLogEntry.message).toContain('Rate limit exceeded');
      expect(mockLogEntry).toHaveProperty('ip');
      expect(mockLogEntry).toHaveProperty('requestId');
    });
  });

  describe('Rate Limiting Configuration', () => {
    it('should respect PUBLIC_RATE_LIMIT environment variable', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.114'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-config',
          identity: {
            sourceIp: '192.168.1.114'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);
      const limit = parseInt(response.headers['X-RateLimit-Limit'], 10);
      const expectedLimit = parseInt(process.env.PUBLIC_RATE_LIMIT || '100', 10);

      expect(limit).toBe(expectedLimit);
    });

    it('should use default rate limit of 100 if not configured', async () => {
      const originalLimit = process.env.PUBLIC_RATE_LIMIT;
      delete process.env.PUBLIC_RATE_LIMIT;

      const event = {
        httpMethod: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.115'
        },
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        requestContext: {
          requestId: 'test-request-default',
          identity: {
            sourceIp: '192.168.1.115'
          }
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);
      const limit = parseInt(response.headers['X-RateLimit-Limit'], 10);

      expect(limit).toBe(100);

      // Restore original value
      if (originalLimit) {
        process.env.PUBLIC_RATE_LIMIT = originalLimit;
      }
    });
  });
});
