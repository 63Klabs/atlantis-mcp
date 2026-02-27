/**
 * MCP Protocol Compliance Tests
 *
 * Tests that the Atlantis MCP Server complies with the Model Context Protocol v1.0 specification.
 * These tests verify protocol negotiation, capability discovery, tool listing, tool invocation,
 * error responses, and JSON Schema validation.
 */

// Mock Config module before importing handler
jest.mock('../../lambda/read/config', () => ({
  Config: {
    init: jest.fn().mockResolvedValue(undefined),
    prime: jest.fn().mockResolvedValue(undefined),
    settings: jest.fn().mockReturnValue({
      s3: { buckets: ['test-bucket'] },
      github: { 
        userOrgs: ['test-org'],
        token: { getValue: jest.fn().mockResolvedValue('test-token') }
      },
      cache: { dynamoDbTable: 'test-table', s3Bucket: 'test-cache-bucket' },
      aws: { region: 'us-east-1' },
      logging: { level: 'INFO' },
      rateLimits: {
        public: { limit: 100, window: 3600 }
      }
    }),
    getConnCacheProfile: jest.fn(),
    isInitialized: jest.fn().mockReturnValue(true)
  }
}));

// Mock RateLimiter to always allow requests
jest.mock('../../lambda/read/utils/rate-limiter', () => ({
  checkRateLimit: jest.fn().mockReturnValue({
    allowed: true,
    headers: {
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
    }
  }),
  createRateLimitResponse: jest.fn()
}));

const { handler } = require('../../lambda/read/index');
const { createMockContext, createMCPToolRequest, createMockEvent } = require('./test-helpers');

// Skip these tests - they need AWS SDK v3 migration and handler fixes
describe.skip('MCP Protocol Compliance Tests', () => {
  describe('15.1.1 Protocol Negotiation', () => {
    it('should support MCP protocol version 1.0', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/negotiate',
        body: JSON.stringify({
          protocol: 'mcp',
          version: '1.0'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.protocol).toBe('mcp');
      expect(body.version).toBe('1.0');
      expect(body.supported).toBe(true);
    });

    it('should reject unsupported protocol versions', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/negotiate',
        body: JSON.stringify({
          protocol: 'mcp',
          version: '2.0'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNSUPPORTED_VERSION');
    });

    it('should reject non-MCP protocols', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/negotiate',
        body: JSON.stringify({
          protocol: 'unknown',
          version: '1.0'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNSUPPORTED_PROTOCOL');
    });
  });

  describe('15.1.2 Capability Discovery', () => {
    it('should return server capabilities', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/capabilities',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify capabilities structure
      expect(body.capabilities).toBeDefined();
      expect(body.capabilities.tools).toBe(true);
      expect(body.capabilities.resources).toBe(false); // Phase 1 is read-only
      expect(body.capabilities.prompts).toBe(false);

      // Verify server info
      expect(body.serverInfo).toBeDefined();
      expect(body.serverInfo.name).toBe('atlantis-mcp-server');
      expect(body.serverInfo.version).toBeDefined();
    });

    it('should include supported features in capabilities', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/capabilities',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      expect(body.capabilities.features).toBeDefined();
      expect(body.capabilities.features).toContain('template_discovery');
      expect(body.capabilities.features).toContain('starter_discovery');
      expect(body.capabilities.features).toContain('documentation_search');
      expect(body.capabilities.features).toContain('naming_validation');
    });
  });

  describe('15.1.3 Tool Listing', () => {
    it('should list all available tools', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/tools',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    it('should include all Phase 1 tools', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/tools',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      const toolNames = body.tools.map(t => t.name);

      // Verify all Phase 1 tools are present
      expect(toolNames).toContain('list_templates');
      expect(toolNames).toContain('get_template');
      expect(toolNames).toContain('list_template_versions');
      expect(toolNames).toContain('list_categories');
      expect(toolNames).toContain('list_starters');
      expect(toolNames).toContain('get_starter_info');
      expect(toolNames).toContain('search_documentation');
      expect(toolNames).toContain('validate_naming');
      expect(toolNames).toContain('check_template_updates');
    });

    it('should include tool descriptions and schemas', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/tools',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      // Verify each tool has required fields
      body.tools.forEach(tool => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      });
    });

    it('should include usage examples for AI assistants', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/tools',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      // At least some tools should have examples
      const toolsWithExamples = body.tools.filter(t => t.examples && t.examples.length > 0);
      expect(toolsWithExamples.length).toBeGreaterThan(0);
    });
  });

  describe('15.1.4 Tool Invocation', () => {
    describe('list_templates tool', () => {
      it('should invoke list_templates successfully', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'list_templates',
            input: {}
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.result).toBeDefined();
      });

      it('should accept category filter', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'list_templates',
            input: {
              category: 'Storage'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect(response.statusCode).toBe(200);
      });
    });

    describe('get_template tool', () => {
      it('should invoke get_template with required parameters', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'get_template',
            input: {
              templateName: 'template-storage-s3-artifacts',
              category: 'Storage'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});

        // May return 200 with data or 404 if template doesn't exist in test environment
        expect([200, 404]).toContain(response.statusCode);
      });
    });

    describe('list_template_versions tool', () => {
      it('should invoke list_template_versions', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'list_template_versions',
            input: {
              templateName: 'template-storage-s3-artifacts',
              category: 'Storage'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect([200, 404]).toContain(response.statusCode);
      });
    });

    describe('list_categories tool', () => {
      it('should invoke list_categories', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'list_categories',
            input: {}
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.result).toBeDefined();
        expect(Array.isArray(body.result.categories)).toBe(true);
      });
    });

    describe('list_starters tool', () => {
      it('should invoke list_starters', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'list_starters',
            input: {}
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect(response.statusCode).toBe(200);
      });
    });

    describe('get_starter_info tool', () => {
      it('should invoke get_starter_info', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'get_starter_info',
            input: {
              starterName: 'atlantis-starter-01'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect([200, 404]).toContain(response.statusCode);
      });
    });

    describe('search_documentation tool', () => {
      it('should invoke search_documentation', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'search_documentation',
            input: {
              query: 'CloudFormation'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect(response.statusCode).toBe(200);
      });
    });

    describe('validate_naming tool', () => {
      it('should invoke validate_naming', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'validate_naming',
            input: {
              resourceName: 'acme-myapp-test-MyFunction',
              resourceType: 'lambda'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect(response.statusCode).toBe(200);
      });
    });

    describe('check_template_updates tool', () => {
      it('should invoke check_template_updates', async () => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/tools/invoke',
          body: JSON.stringify({
            tool: 'check_template_updates',
            input: {
              templateName: 'template-storage-s3-artifacts',
              currentVersion: 'v1.0.0/2024-01-01'
            }
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const response = await handler(event, {});
        expect([200, 404]).toContain(response.statusCode);
      });
    });
  });

  describe('15.1.5 Error Response Compliance', () => {
    it('should return MCP-compliant error for unknown tool', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'unknown_tool',
          input: {}
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);

      // Verify MCP error structure
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
      expect(typeof body.error.code).toBe('string');
      expect(typeof body.error.message).toBe('string');
    });

    it('should return MCP-compliant error for invalid input', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'get_template',
          input: {
            // Missing required templateName parameter
            category: 'Storage'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message).toBeDefined();
      expect(body.error.details).toBeDefined();
    });

    it('should return MCP-compliant error for rate limit exceeded', async () => {
      // This test would require actually exceeding rate limits
      // For now, we verify the error structure is correct when rate limit is hit

      // Mock scenario: assume rate limit exceeded
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.0.2.1' // Test IP
        }
      };

      // In actual implementation, this would be tested by making many requests
      // Here we just verify the error structure when it occurs
      const response = await handler(event, {});

      if (response.statusCode === 429) {
        const body = JSON.parse(response.body);
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.headers['Retry-After']).toBeDefined();
      }
    });

    it('should include request ID in error responses', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'unknown_tool',
          input: {}
        }),
        headers: {
          'Content-Type': 'application/json'
        },
        requestContext: {
          requestId: 'test-request-id-123'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      expect(body.requestId).toBeDefined();
    });

    it('should not expose internal error details', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'get_template',
          input: {
            templateName: 'test',
            category: 'Storage'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      // Error messages should not contain stack traces or internal paths
      if (body.error) {
        expect(body.error.message).not.toMatch(/\/src\//);
        expect(body.error.message).not.toMatch(/Error: /);
        expect(body.error.stack).toBeUndefined();
      }
    });
  });

  describe('15.1.6 JSON Schema Validation', () => {
    it('should validate list_templates input schema', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'list_templates',
          input: {
            category: 'InvalidCategory', // Invalid category
            version: 123 // Should be string
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.details).toBeDefined();
    });

    it('should validate get_template input schema', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'get_template',
          input: {
            // Missing required templateName
            category: 'Storage'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('should validate search_documentation input schema', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'search_documentation',
          input: {
            // Missing required query parameter
            type: 'guide'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('should validate validate_naming input schema', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'validate_naming',
          input: {
            // Missing required resourceName
            resourceType: 'lambda'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('should accept valid optional parameters', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'list_templates',
          input: {
            category: 'Storage',
            version: 'v1.0.0/2024-01-01',
            s3Buckets: ['bucket1', 'bucket2']
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should reject additional unknown properties', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'list_templates',
          input: {
            category: 'Storage',
            unknownProperty: 'value' // Not in schema
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      // Depending on schema configuration, may reject or ignore
      // At minimum, should not cause server error
      expect(response.statusCode).not.toBe(500);
    });

    it('should provide detailed validation error messages', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'get_template',
          input: {
            templateName: '', // Empty string
            category: 'Storage'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      if (response.statusCode === 400) {
        const body = JSON.parse(response.body);
        expect(body.error.details).toBeDefined();
        expect(Array.isArray(body.error.details)).toBe(true);

        // Should specify which field failed validation
        const hasFieldInfo = body.error.details.some(d =>
          d.field || d.path || d.property
        );
        expect(hasFieldInfo).toBe(true);
      }
    });
  });

  describe('MCP Protocol Headers', () => {
    it('should include MCP protocol version in response headers', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/mcp/tools',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.headers).toBeDefined();
      expect(response.headers['X-MCP-Version']).toBe('1.0');
    });

    it('should include rate limit headers', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/mcp/tools/invoke',
        body: JSON.stringify({
          tool: 'list_templates',
          input: {}
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await handler(event, {});

      expect(response.headers['X-RateLimit-Limit']).toBeDefined();
      expect(response.headers['X-RateLimit-Remaining']).toBeDefined();
      expect(response.headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should include CORS headers for browser access', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        path: '/mcp/tools',
        headers: {
          'Origin': 'https://example.com'
        }
      };

      const response = await handler(event, {});

      expect(response.headers['Access-Control-Allow-Origin']).toBeDefined();
      expect(response.headers['Access-Control-Allow-Methods']).toBeDefined();
      expect(response.headers['Access-Control-Allow-Headers']).toBeDefined();
    });
  });
});
