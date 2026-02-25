/**
 * Unit tests for rate limiting logic
 * 
 * Tests rate limiting functionality including:
 * - Rate limit enforcement per IP
 * - Rate limit headers
 * - Rate limit reset
 * - 429 response format
 * - Configurable rate limits
 */

const RateLimiter = require('../../../lambda/read/utils/rate-limiter');

describe('Rate Limiting', () => {
  let mockEvent;

  beforeEach(() => {
    // Clear rate limit storage between tests
    if (RateLimiter._clearStorage) {
      RateLimiter._clearStorage();
    }

    mockEvent = {
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        },
        requestTime: new Date().toISOString()
      }
    };
  });

  describe('Rate Limit Enforcement', () => {
    test('should allow requests within rate limit', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 100);

      expect(result.allowed).toBe(true);
      expect(result.headers['X-RateLimit-Limit']).toBe('100');
      expect(result.headers['X-RateLimit-Remaining']).toBe('99');
    });

    test('should block requests exceeding rate limit', () => {
      const limit = 5;

      // Make requests up to limit
      for (let i = 0; i < limit; i++) {
        const result = RateLimiter.checkRateLimit(mockEvent, limit);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked
      const result = RateLimiter.checkRateLimit(mockEvent, limit);
      expect(result.allowed).toBe(false);
      expect(result.headers['X-RateLimit-Remaining']).toBe('0');
    });

    test('should track rate limits per IP address', () => {
      const ip1Event = { ...mockEvent };
      const ip2Event = {
        ...mockEvent,
        requestContext: {
          ...mockEvent.requestContext,
          identity: { sourceIp: '192.168.1.2' }
        }
      };

      // IP1 makes requests
      for (let i = 0; i < 5; i++) {
        RateLimiter.checkRateLimit(ip1Event, 5);
      }

      // IP1 should be blocked
      const ip1Result = RateLimiter.checkRateLimit(ip1Event, 5);
      expect(ip1Result.allowed).toBe(false);

      // IP2 should still be allowed
      const ip2Result = RateLimiter.checkRateLimit(ip2Event, 5);
      expect(ip2Result.allowed).toBe(true);
    });

    test('should handle missing sourceIp gracefully', () => {
      const eventWithoutIp = {
        requestContext: {
          identity: {}
        }
      };

      const result = RateLimiter.checkRateLimit(eventWithoutIp, 100);

      // Should use default IP or handle gracefully
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('headers');
    });

    test('should respect configurable rate limit', () => {
      const customLimit = 50;
      const result = RateLimiter.checkRateLimit(mockEvent, customLimit);

      expect(result.headers['X-RateLimit-Limit']).toBe(String(customLimit));
    });
  });

  describe('Rate Limit Headers', () => {
    test('should include X-RateLimit-Limit header', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 100);

      expect(result.headers).toHaveProperty('X-RateLimit-Limit', '100');
    });

    test('should include X-RateLimit-Remaining header', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 100);

      expect(result.headers).toHaveProperty('X-RateLimit-Remaining');
      expect(parseInt(result.headers['X-RateLimit-Remaining'])).toBeLessThanOrEqual(100);
    });

    test('should include X-RateLimit-Reset header', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 100);

      expect(result.headers).toHaveProperty('X-RateLimit-Reset');
      expect(parseInt(result.headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
    });

    test('should decrement X-RateLimit-Remaining on each request', () => {
      const result1 = RateLimiter.checkRateLimit(mockEvent, 100);
      const result2 = RateLimiter.checkRateLimit(mockEvent, 100);

      const remaining1 = parseInt(result1.headers['X-RateLimit-Remaining']);
      const remaining2 = parseInt(result2.headers['X-RateLimit-Remaining']);

      expect(remaining2).toBe(remaining1 - 1);
    });

    test('should set X-RateLimit-Remaining to 0 when limit exceeded', () => {
      const limit = 3;

      for (let i = 0; i < limit; i++) {
        RateLimiter.checkRateLimit(mockEvent, limit);
      }

      const result = RateLimiter.checkRateLimit(mockEvent, limit);
      expect(result.headers['X-RateLimit-Remaining']).toBe('0');
    });
  });

  describe('Rate Limit Reset', () => {
    test('should reset rate limit after time window', () => {
      const limit = 5;

      // Exhaust rate limit
      for (let i = 0; i < limit; i++) {
        RateLimiter.checkRateLimit(mockEvent, limit);
      }

      // Should be blocked
      let result = RateLimiter.checkRateLimit(mockEvent, limit);
      expect(result.allowed).toBe(false);

      // Simulate time passing (if RateLimiter supports time manipulation for testing)
      if (RateLimiter._advanceTime) {
        RateLimiter._advanceTime(3600000); // 1 hour
      }

      // Should be allowed again after reset
      result = RateLimiter.checkRateLimit(mockEvent, limit);
      expect(result.allowed).toBe(true);
    });

    test('should calculate correct reset time', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 100);
      const resetTime = parseInt(result.headers['X-RateLimit-Reset']);
      const now = Math.floor(Date.now() / 1000);

      // Reset time should be in the future (within 1 hour)
      expect(resetTime).toBeGreaterThan(now);
      expect(resetTime).toBeLessThanOrEqual(now + 3600);
    });

    test('should maintain same reset time within window', () => {
      const result1 = RateLimiter.checkRateLimit(mockEvent, 100);
      const result2 = RateLimiter.checkRateLimit(mockEvent, 100);

      expect(result1.headers['X-RateLimit-Reset']).toBe(
        result2.headers['X-RateLimit-Reset']
      );
    });
  });

  describe('429 Response Format', () => {
    test('should create proper 429 response when limit exceeded', () => {
      const limit = 2;

      for (let i = 0; i < limit; i++) {
        RateLimiter.checkRateLimit(mockEvent, limit);
      }

      const checkResult = RateLimiter.checkRateLimit(mockEvent, limit);
      const response = RateLimiter.createRateLimitResponse(
        checkResult.headers,
        checkResult.retryAfter
      );

      expect(response.statusCode).toBe(429);
      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
      expect(response.headers).toHaveProperty('Retry-After');
    });

    test('should include Retry-After header in 429 response', () => {
      const headers = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
      };
      const retryAfter = 3600;

      const response = RateLimiter.createRateLimitResponse(headers, retryAfter);

      expect(response.headers['Retry-After']).toBe(String(retryAfter));
    });

    test('should include rate limit headers in 429 response', () => {
      const headers = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '3600'
      };

      const response = RateLimiter.createRateLimitResponse(headers, 3600);

      expect(response.headers['X-RateLimit-Limit']).toBe('100');
      expect(response.headers['X-RateLimit-Remaining']).toBe('0');
      expect(response.headers['X-RateLimit-Reset']).toBe('3600');
    });

    test('should include error message in 429 response body', () => {
      const headers = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '3600'
      };

      const response = RateLimiter.createRateLimitResponse(headers, 3600);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('error');
      expect(body.error).toContain('Rate limit exceeded');
    });

    test('should include retry information in 429 response body', () => {
      const headers = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '3600'
      };
      const retryAfter = 3600;

      const response = RateLimiter.createRateLimitResponse(headers, retryAfter);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('retryAfter', retryAfter);
    });
  });

  describe('Edge Cases', () => {
    test('should handle rate limit of 0 (block all requests)', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 0);

      expect(result.allowed).toBe(false);
    });

    test('should handle very high rate limits', () => {
      const result = RateLimiter.checkRateLimit(mockEvent, 1000000);

      expect(result.allowed).toBe(true);
      expect(result.headers['X-RateLimit-Limit']).toBe('1000000');
    });

    test('should handle rapid successive requests', () => {
      const limit = 10;
      const results = [];

      for (let i = 0; i < limit + 5; i++) {
        results.push(RateLimiter.checkRateLimit(mockEvent, limit));
      }

      const allowedCount = results.filter(r => r.allowed).length;
      expect(allowedCount).toBe(limit);
    });

    test('should handle concurrent requests from same IP', async () => {
      const limit = 10;
      const promises = Array(15).fill(null).map(() =>
        Promise.resolve(RateLimiter.checkRateLimit(mockEvent, limit))
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter(r => r.allowed).length;

      // Should allow exactly up to the limit
      expect(allowedCount).toBeLessThanOrEqual(limit);
    });

    test('should handle IPv6 addresses', () => {
      const ipv6Event = {
        ...mockEvent,
        requestContext: {
          ...mockEvent.requestContext,
          identity: {
            sourceIp: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
          }
        }
      };

      const result = RateLimiter.checkRateLimit(ipv6Event, 100);

      expect(result.allowed).toBe(true);
      expect(result.headers).toHaveProperty('X-RateLimit-Limit');
    });

    test('should handle malformed IP addresses', () => {
      const malformedEvent = {
        ...mockEvent,
        requestContext: {
          ...mockEvent.requestContext,
          identity: {
            sourceIp: 'not-an-ip'
          }
        }
      };

      const result = RateLimiter.checkRateLimit(malformedEvent, 100);

      // Should handle gracefully without throwing
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('headers');
    });
  });

  describe('Performance', () => {
    test('should check rate limit quickly', () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        RateLimiter.checkRateLimit(mockEvent, 1000);
      }
      
      const duration = Date.now() - start;

      // Should complete 100 checks in under 100ms
      expect(duration).toBeLessThan(100);
    });

    test('should handle many different IPs efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        const event = {
          ...mockEvent,
          requestContext: {
            ...mockEvent.requestContext,
            identity: {
              sourceIp: `192.168.1.${i}`
            }
          }
        };
        RateLimiter.checkRateLimit(event, 100);
      }

      const duration = Date.now() - start;

      // Should handle 100 different IPs in under 200ms
      expect(duration).toBeLessThan(200);
    });
  });
});
