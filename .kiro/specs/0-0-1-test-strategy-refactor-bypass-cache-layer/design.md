# Design Document: Test Strategy Refactor - Bypass Cache Layer

## Overview

This design document outlines the refactoring strategy for 217 failing tests across 26 test files in the atlantis-mcp project. The core issue is that tests currently mock `CacheableDataAccess.getData()` from the `@63klabs/cache-data` package, which is complex, brittle, and breaks when Config structures change. The solution is to bypass the cache layer in tests and directly mock the underlying fetch functions (DAO methods) instead.

### Current Problem

Tests follow this pattern:
```javascript
// ❌ CURRENT (BRITTLE) - Mocking the cache wrapper
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  }
}));

// Mock must understand cache internals and call fetchFunction
CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
  const body = await fetchFunction(conn, opts);
  return { body };
});
```

This approach:
- Requires understanding cache internals (cacheProfile structure, cache key generation)
- Breaks when Config refactoring changes connection/profile structures
- Tests caching mechanism instead of business logic
- Creates tight coupling between tests and cache implementation

### Proposed Solution

Tests will follow this pattern:
```javascript
// ✅ NEW (ROBUST) - Mocking the DAO functions directly
jest.mock('../../../lambda/read/models', () => ({
  S3Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn()
  },
  S3Starters: {
    list: jest.fn()
  },
  GitHubAPI: {
    fetchRepositories: jest.fn()
  },
  DocIndex: {
    get: jest.fn()
  }
}));

// Mock returns data directly - no cache knowledge needed
Models.S3Templates.list.mockResolvedValue({
  templates: [{ name: 'template1' }],
  errors: [],
  partialData: false
});
```

This approach:
- Tests business logic, not caching mechanism
- No knowledge of cache internals required
- Resilient to Config refactoring
- Simpler, more maintainable tests
- Production code continues using cache for performance

## Architecture

### Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Lambda Handler                            │
│  (index.js - routes requests, handles rate limiting)        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Controllers                               │
│  (Validate input, format MCP responses)                     │
│  - templates.js, starters.js, documentation.js              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     Services                                 │
│  (Business logic + CacheableDataAccess.getData wrapper)     │
│  - templates.js, starters.js, documentation.js              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              CacheableDataAccess.getData()                   │
│  (Cache wrapper from @63klabs/cache-data)                   │
│  - Checks cache, calls fetch function on miss               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Models (DAOs)                             │
│  (Data access - fetch functions)                            │
│  - S3Templates, S3Starters, GitHubAPI, DocIndex            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  AWS Services                                │
│  (S3, DynamoDB, GitHub API)                                 │
└─────────────────────────────────────────────────────────────┘
```

### Test Strategy by Layer

| Layer | What to Mock | What to Test |
|-------|-------------|--------------|
| **Controllers** | Mock Services (Templates, Starters, Documentation) | Input validation, MCP response formatting, error handling |
| **Services** | Mock Models (S3Templates, S3Starters, GitHubAPI, DocIndex) | Business logic, data transformation, error enrichment |
| **Models (DAOs)** | Mock AWS SDK clients (S3Client, DynamoDBClient) | AWS API calls, data parsing, multi-source aggregation |
| **Lambda Handler** | Mock Services | Request routing, rate limiting, logging, metrics |

### Key Insight: Testing Fetch Functions Directly

The service layer uses this pattern:
```javascript
async function list(options = {}) {
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-templates', 'templates-list');
  
  // Define fetch function
  const fetchFunction = async (connection, opts) => {
    return await Models.S3Templates.list(connection, opts);
  };
  
  // Wrap with cache
  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}
  );
  
  return result.body;
}
```

**Old approach**: Mock `CacheableDataAccess.getData()` to call `fetchFunction`
**New approach**: Mock `Models.S3Templates.list()` directly - service calls it through cache wrapper

## Components and Interfaces

### Test Pattern Templates

#### Pattern 1: Service Layer Tests

**Purpose**: Test business logic in service layer by mocking DAO functions

**Mock Setup**:
```javascript
// Mock Models at module level
jest.mock('../../../lambda/read/models', () => ({
  S3Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn()
  },
  S3Starters: {
    list: jest.fn()
  },
  GitHubAPI: {
    fetchRepositories: jest.fn()
  },
  DocIndex: {
    get: jest.fn()
  }
}));

// Mock Config
jest.mock('../../../lambda/read/config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

// Mock DebugAndLog
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));

// Import after mocking
const Templates = require('../../../lambda/read/services/templates');
const Models = require('../../../lambda/read/models');
const { Config } = require('../../../lambda/read/config');
```

**Test Structure**:
```javascript
describe('Templates Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Config mocks
    Config.getConnCacheProfile.mockReturnValue({
      conn: { 
        host: ['bucket1', 'bucket2'], 
        path: '/templates',
        parameters: {} 
      },
      cacheProfile: { 
        pathId: 'test-path',
        defaultExpirationInSeconds: 300,
        hostId: 's3-templates',
        profile: 'template-list'
      }
    });
    
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket1', 'bucket2']
      }
    });
  });
  
  describe('list()', () => {
    it('should call Models.S3Templates.list with correct parameters', async () => {
      // Arrange
      Models.S3Templates.list.mockResolvedValue({
        templates: [{ name: 'template1' }],
        errors: [],
        partialData: false
      });
      
      // Act
      const result = await Templates.list({ category: 'storage' });
      
      // Assert
      expect(Models.S3Templates.list).toHaveBeenCalledWith(
        expect.objectContaining({
          host: ['bucket1', 'bucket2'],
          parameters: expect.objectContaining({
            category: 'storage'
          })
        }),
        {}
      );
      expect(result.templates).toHaveLength(1);
    });
    
    it('should handle DAO errors appropriately', async () => {
      // Arrange
      Models.S3Templates.list.mockRejectedValue(new Error('S3 access denied'));
      
      // Act & Assert
      await expect(Templates.list({})).rejects.toThrow('S3 access denied');
    });
  });
});
```

#### Pattern 2: Controller Layer Tests

**Purpose**: Test request validation and MCP response formatting by mocking service functions

**Mock Setup**:
```javascript
// Mock Services at module level
jest.mock('../../../lambda/read/services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
  },
  Starters: {
    list: jest.fn()
  },
  Documentation: {
    get: jest.fn()
  }
}));

// Mock validators and utilities
jest.mock('../../../lambda/read/utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../lambda/read/utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

// Import after mocking
const TemplatesController = require('../../../lambda/read/controllers/templates');
const Services = require('../../../lambda/read/services');
const SchemaValidator = require('../../../lambda/read/utils/schema-validator');
const MCPProtocol = require('../../../lambda/read/utils/mcp-protocol');
```

**Test Structure**:
```javascript
describe('Templates Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('list()', () => {
    it('should validate input and call service', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            category: 'storage'
          }
        }
      };
      
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.list.mockResolvedValue({
        templates: [{ name: 'template1' }]
      });
      
      // Act
      const result = await TemplatesController.list(props);
      
      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_templates', props.body.input);
      expect(Services.Templates.list).toHaveBeenCalledWith({
        category: 'storage',
        version: undefined,
        versionId: undefined,
        s3Buckets: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_templates', expect.any(Object));
      expect(result.success).toBe(true);
    });
    
    it('should return error for invalid input', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            category: 'InvalidCategory'
          }
        }
      };
      
      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'category', message: 'Invalid category' }]
      });
      
      // Act
      const result = await TemplatesController.list(props);
      
      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed'
        }),
        'list_templates'
      );
      expect(Services.Templates.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
```

#### Pattern 3: DAO Layer Tests

**Purpose**: Test data access logic by mocking AWS SDK clients

**Mock Setup**:
```javascript
// Mock AWS SDK clients BEFORE importing module
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');

// Create mock before module import
const s3Mock = mockClient(S3Client);

// Now import the module (it will use the mocked S3Client)
const S3Templates = require('../../../lambda/read/models/s3-templates');

// Mock DebugAndLog
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));
```

**Test Structure**:
```javascript
describe('S3 Templates DAO', () => {
  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });
  
  describe('list()', () => {
    it('should list templates from S3', async () => {
      // Arrange
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/templates/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/templates/v2/storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          }
        ]
      });
      
      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {}
      };
      
      // Act
      const result = await S3Templates.list(connection, {});
      
      // Assert
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].name).toBe('template-s3');
      expect(result.templates[0].category).toBe('storage');
    });
  });
});
```

#### Pattern 4: Lambda Integration Tests

**Purpose**: Test Lambda handler routing and error handling by mocking service layer

**Mock Setup**:
```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

// Mock Config
jest.mock('../../../lambda/read/config', () => ({
  Config: {
    init: jest.fn(),
    prime: jest.fn(),
    settings: jest.fn(),
    getConnCacheProfile: jest.fn()
  }
}));

// Mock Routes
jest.mock('../../../lambda/read/routes');

// Mock Services (for integration tests)
jest.mock('../../../lambda/read/services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn()
  },
  Starters: {
    list: jest.fn()
  },
  Documentation: {
    get: jest.fn()
  }
}));

// Import after mocking
const { handler } = require('../../../lambda/read/index');
const { Config } = require('../../../lambda/read/config');
const Routes = require('../../../lambda/read/routes');
const Services = require('../../../lambda/read/services');
```

**Test Structure**:
```javascript
describe('Read Lambda Handler', () => {
  let mockEvent;
  let mockContext;
  
  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    s3Mock.reset();
    
    mockEvent = {
      httpMethod: 'POST',
      path: '/mcp',
      body: JSON.stringify({
        tool: 'list_templates',
        input: {}
      }),
      requestContext: {
        requestId: 'test-request-id',
        identity: {
          sourceIp: '192.168.1.1'
        }
      }
    };
    
    mockContext = {
      requestId: 'test-request-id',
      functionName: 'test-function',
      getRemainingTimeInMillis: () => 30000
    };
    
    Config.init.mockResolvedValue(undefined);
    Config.settings.mockReturnValue({
      s3: { buckets: ['bucket1'] },
      rateLimits: { public: { limit: 100, window: 3600 } }
    });
    
    const mockResponse = {
      toAPIGateway: jest.fn().mockReturnValue({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'success' })
      }),
      getProps: jest.fn().mockReturnValue({
        statusCode: 200,
        cacheHit: false
      })
    };
    Routes.process.mockResolvedValue(mockResponse);
  });
  
  describe('Request Processing', () => {
    it('should delegate to Routes.process()', async () => {
      // Act
      await handler(mockEvent, mockContext);
      
      // Assert
      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });
  });
});
```

## Data Models

### Mock Data Structures

#### S3Templates.list() Response
```javascript
{
  templates: [
    {
      name: 'template-storage-s3-artifacts',
      category: 'storage',
      namespace: 'atlantis',
      bucket: 'test-bucket',
      version: 'v1.3.5/2024-01-15',
      versionId: 'abc123',
      lastModified: '2024-01-15T10:00:00Z',
      size: 2048,
      s3Path: 'atlantis/templates/v2/storage/template-storage-s3-artifacts.yml'
    }
  ],
  errors: [],
  partialData: false
}
```

#### S3Templates.get() Response
```javascript
{
  name: 'template-storage-s3-artifacts',
  category: 'storage',
  namespace: 'atlantis',
  bucket: 'test-bucket',
  version: 'v1.3.5/2024-01-15',
  versionId: 'abc123',
  lastModified: '2024-01-15T10:00:00Z',
  size: 2048,
  s3Path: 'atlantis/templates/v2/storage/template-storage-s3-artifacts.yml',
  content: 'AWSTemplateFormatVersion: "2010-09-09"...',
  description: 'S3 bucket for build artifacts',
  parameters: {
    BucketName: {
      Type: 'String',
      Description: 'Name of the S3 bucket'
    }
  },
  outputs: {
    BucketArn: {
      Value: '!GetAtt Bucket.Arn',
      Description: 'ARN of the bucket'
    }
  }
}
```

#### S3Starters.list() Response
```javascript
{
  starters: [
    {
      name: 'atlantis-starter-01',
      namespace: 'atlantis',
      bucket: 'test-bucket',
      version: 'v1.0.0/2024-01-01',
      description: 'Basic starter template',
      lastModified: '2024-01-01T10:00:00Z'
    }
  ],
  errors: [],
  partialData: false
}
```

#### GitHubAPI.fetchRepositories() Response
```javascript
{
  repositories: [
    {
      name: 'atlantis-starter-01',
      fullName: 'org1/atlantis-starter-01',
      description: 'Basic starter template',
      url: 'https://github.com/org1/atlantis-starter-01',
      topics: ['atlantis', 'starter'],
      stargazersCount: 42,
      updatedAt: '2024-01-01T10:00:00Z'
    }
  ],
  errors: [],
  partialData: false
}
```

#### DocIndex.get() Response
```javascript
{
  documentPath: 'docs/templates/v2/storage/template-storage-s3-artifacts-README.md',
  content: '# Template Documentation...',
  metadata: {
    title: 'S3 Artifacts Template',
    category: 'storage',
    version: 'v1.3.5/2024-01-15'
  }
}
```

### Config Mock Structures

#### Config.getConnCacheProfile() Response
```javascript
{
  conn: {
    host: ['bucket1', 'bucket2'],  // Can be string or array
    path: '/templates/v2',
    parameters: {
      category: 'storage',
      version: 'v1.3.5/2024-01-15'
    }
  },
  cacheProfile: {
    pathId: 's3-templates-list',
    defaultExpirationInSeconds: 300,
    hostId: 's3-templates',
    profile: 'template-list',
    overrideOriginHeaderExpiration: false,
    expirationIsOnInterval: false,
    headersToRetain: '',
    hostEncryption: 'public'
  }
}
```

#### Config.settings() Response
```javascript
{
  s3: {
    buckets: ['bucket1', 'bucket2']
  },
  github: {
    userOrgs: ['org1', 'org2'],
    token: {
      getValue: jest.fn().mockResolvedValue('mock-token')
    }
  },
  templates: {
    categories: [
      { name: 'storage', description: 'Storage templates' },
      { name: 'network', description: 'Network templates' },
      { name: 'pipeline', description: 'Pipeline templates' }
    ]
  },
  rateLimits: {
    public: {
      limit: 100,
      window: 3600
    }
  }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Acceptance Criteria Testing Prework


Based on the prework analysis, most acceptance criteria are testable as examples (specific test file checks) rather than properties (universal rules). The criteria focus on verifying that specific test patterns exist in specific files, which are concrete examples rather than universal properties.

### Property 1: Parameter Verification Completeness

*For any* test that mocks a DAO or service function, the test SHALL include assertions verifying the mocked function was called with the expected parameters.

**Validates: Requirements 1.5, 3.5, 3.6, 4.4, 5.5**

### Property 2: Data Transformation Verification

*For any* test that mocks a DAO response, the test SHALL include assertions verifying the service or controller correctly transforms or filters that data.

**Validates: Requirements 1.6, 4.5, 5.6**

### Property 3: Error Handling Coverage

*For any* service, controller, or DAO module, the test suite SHALL include tests where dependencies throw errors and verify appropriate error handling.

**Validates: Requirements 4.6, 5.7, 6.7, 7.4**

### Property 4: Return Format Validation

*For any* DAO function test, the test SHALL verify the returned data structure matches the expected format defined in the data models.

**Validates: Requirements 3.7, 6.6**

### Property 5: Public Method Coverage

*For any* public method in service, controller, or DAO layers, the test suite SHALL include at least one test exercising that method.

**Validates: Requirements 9.2, 9.3, 9.4**

### Property 6: Edge Case Coverage

*For any* function that accepts parameters with boundary conditions (empty arrays, null values, edge values), the test suite SHALL include tests for those edge cases.

**Validates: Requirements 9.6**

### Property 7: Clear Test Failure Messages

*For any* test, when the test fails, the error message SHALL clearly indicate what was expected and what was received.

**Validates: Requirements 11.5**

## Error Handling

### Test Refactoring Errors

**Error Type**: Mock Configuration Error
- **Cause**: Incorrect mock setup or import order
- **Detection**: Tests fail with "Cannot read property of undefined" or "X is not a function"
- **Resolution**: Ensure mocks are defined before imports, check mock structure matches actual module exports
- **Prevention**: Follow test pattern templates exactly, use TypeScript for type checking

**Error Type**: Assertion Mismatch
- **Cause**: Expected parameters don't match actual function calls
- **Detection**: Tests fail with "Expected mock function to have been called with..."
- **Resolution**: Check actual function signature and parameters in source code
- **Prevention**: Use IDE autocomplete, refer to source code when writing assertions

**Error Type**: Async Handling Error
- **Cause**: Missing await or improper promise handling
- **Detection**: Tests pass but don't actually test anything, or timeout
- **Resolution**: Ensure all async functions are awaited, use async/await consistently
- **Prevention**: Always use async/await pattern, avoid mixing with .then()

**Error Type**: Mock Leakage
- **Cause**: Mocks not cleared between tests
- **Detection**: Tests pass individually but fail when run together
- **Resolution**: Add jest.clearAllMocks() in beforeEach()
- **Prevention**: Always include beforeEach() with mock cleanup

### Production Code Preservation

**Error Type**: Accidental Cache Removal
- **Cause**: Removing CacheableDataAccess.getData() calls from production code
- **Detection**: Performance degradation, increased AWS API calls
- **Resolution**: Restore CacheableDataAccess.getData() wrapper in service layer
- **Prevention**: Only modify test files, not production service files

**Error Type**: Breaking Service Interface
- **Cause**: Changing service function signatures during refactoring
- **Detection**: Controller tests fail, integration tests fail
- **Resolution**: Restore original service function signatures
- **Prevention**: Only change test mocking strategy, not production interfaces

## Testing Strategy

### Dual Testing Approach

The test suite uses two complementary testing strategies:

1. **Unit Tests**: Test specific examples, edge cases, and error conditions
   - Focus on concrete scenarios with specific inputs and outputs
   - Verify individual function behavior in isolation
   - Fast execution, easy to debug

2. **Integration Tests**: Test caching behavior and multi-component interactions
   - Verify CacheableDataAccess.getData() works with real fetch functions
   - Test cache hits, misses, and expiration
   - Slower execution, test realistic scenarios

### Test Organization

```
application-infrastructure/src/tests/
├── unit/
│   ├── controllers/          # Controller layer tests (mock Services)
│   │   ├── templates-controller.test.js
│   │   ├── starters-controller.test.js
│   │   └── documentation-controller.test.js
│   ├── services/             # Service layer tests (mock Models)
│   │   ├── templates-service.test.js
│   │   ├── starters-service.test.js
│   │   └── documentation-service.test.js
│   ├── models/               # DAO layer tests (mock AWS SDK)
│   │   ├── s3-templates-dao.test.js
│   │   ├── s3-starters-dao.test.js
│   │   ├── github-api-dao.test.js
│   │   └── doc-index-dao.test.js
│   └── lambda/               # Lambda handler tests (mock Services)
│       ├── read-handler.test.js
│       ├── multi-bucket-handling.test.js
│       └── error-handling.test.js
└── integration/
    ├── caching-integration.test.js      # Cache behavior tests
    ├── multi-source-integration.test.js # Multi-bucket/org tests
    └── s3-integration.test.js           # Real S3 integration tests
```

### Test Execution Configuration

**Jest Configuration** (jest.config.js):
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/lambda/read/**/*.js',
    '!src/lambda/read/**/*.test.js',
    '!src/lambda/read/config/index-old.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000
};
```

**Test Execution Commands**:
```bash
# Run all tests
npm test

# Run unit tests only
npm test -- tests/unit

# Run integration tests only
npm test -- tests/integration

# Run specific test file
npm test -- tests/unit/services/templates-service.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode (development)
npm test -- --watch
```

### Migration Strategy

The migration will be executed in phases to minimize risk and ensure incremental progress:

#### Phase 1: High Priority Service Tests (Week 1)
**Files to Update** (6 files):
1. `tests/unit/services/templates-service.test.js`
2. `tests/unit/services/templates-error-handling.test.js`
3. `tests/unit/services/starters-service.test.js`
4. `tests/unit/services/starters-cache-data-integration.test.js`
5. `tests/unit/services/starters-cloudfront-integration.test.js`
6. `tests/unit/services/documentation-service.test.js`

**Approach**:
- Start with templates-error-handling.test.js (already working as reference)
- Update one file at a time
- Run tests after each file to verify
- Commit after each successful file update

**Verification**:
- All service tests pass
- No CacheableDataAccess.getData() mocks remain
- Models.* functions are mocked instead

#### Phase 2: High Priority Controller Tests (Week 1-2)
**Files to Update** (6 files):
1. `tests/unit/controllers/templates-controller.test.js`
2. `tests/unit/controllers/starters-controller.test.js`
3. `tests/unit/controllers/documentation-controller.test.js`
4. `tests/unit/controllers/controller-error-handling.test.js`
5. `tests/unit/controllers/json-schema-validation.test.js`
6. `tests/unit/controllers/validation-controller.test.js`

**Approach**:
- Update controller tests to mock Services instead of CacheableDataAccess
- Verify input validation tests still work
- Verify MCP response formatting tests still work

**Verification**:
- All controller tests pass
- Services.* functions are mocked
- No CacheableDataAccess.getData() mocks remain

#### Phase 3: Medium Priority DAO Tests (Week 2)
**Files to Update** (5 files):
1. `tests/unit/models/s3-templates-dao.test.js`
2. `tests/unit/models/s3-starters-dao.test.js`
3. `tests/unit/models/github-api-dao.test.js`
4. `tests/unit/models/doc-index-dao.test.js`
5. `tests/unit/models/s3-templates-or-condition.test.js`

**Approach**:
- Verify DAO tests already mock AWS SDK clients correctly
- Update any tests that mock CacheableDataAccess
- Ensure aws-sdk-client-mock is used consistently

**Verification**:
- All DAO tests pass
- Only AWS SDK clients are mocked
- No higher-level abstractions are mocked

#### Phase 4: Medium Priority Lambda Integration Tests (Week 2-3)
**Files to Update** (6 files):
1. `tests/unit/lambda/read-handler.test.js`
2. `tests/unit/lambda/multi-bucket-handling.test.js`
3. `tests/unit/lambda/multi-github-org-handling.test.js`
4. `tests/unit/lambda/error-handling.test.js`
5. `tests/unit/lambda/rate-limiting.test.js`
6. `tests/unit/lambda/namespace-discovery.test.js`

**Approach**:
- Update Lambda tests to mock Services layer
- Verify request routing tests still work
- Verify error handling tests still work

**Verification**:
- All Lambda integration tests pass
- Services.* functions are mocked
- Handler routing logic is tested

#### Phase 5: Low Priority Integration and Performance Tests (Week 3)
**Files to Update** (3 files):
1. `tests/integration/caching-integration.test.js`
2. `tests/integration/multi-source-integration.test.js`
3. `tests/performance/lambda-performance.test.js`

**Approach**:
- Update integration tests to test caching behavior separately
- Ensure performance tests still measure realistic scenarios
- May require creating new integration test patterns

**Verification**:
- Integration tests verify caching behavior
- Performance tests measure realistic execution time
- Tests clearly labeled as integration/performance

### Rollback Strategy

If issues arise during migration:

1. **Per-File Rollback**: Git revert specific file if tests fail
2. **Phase Rollback**: Revert entire phase if multiple files have issues
3. **Full Rollback**: Revert all changes if fundamental approach is flawed

**Rollback Triggers**:
- More than 3 files in a phase fail after update
- Test execution time increases by >50%
- Coverage drops by >10%
- Integration tests reveal production issues

### Verification Checklist

After updating each test file:

- [ ] File runs successfully: `npm test -- path/to/file.test.js`
- [ ] No CacheableDataAccess.getData() mocks present
- [ ] Appropriate layer mocked (Models for services, Services for controllers, AWS SDK for DAOs)
- [ ] All tests pass
- [ ] Test execution time reasonable (< 5 seconds per file)
- [ ] Coverage maintained or improved
- [ ] No console errors or warnings
- [ ] Tests follow pattern templates from this design
- [ ] beforeEach() includes jest.clearAllMocks()
- [ ] Assertions verify both function calls and results

### Documentation Plan

#### Design Document (This Document)
- Explains rationale for bypassing cache layer
- Provides test pattern templates for each layer
- Includes before/after examples
- Documents migration strategy

#### Migration Guide
Create `.kiro/specs/0-0-1-test-strategy-refactor-bypass-cache-layer/MIGRATION_GUIDE.md`:
- Step-by-step instructions for updating tests
- Common pitfalls and solutions
- Before/after examples for each test type
- Troubleshooting guide

#### Test Pattern Reference
Create `application-infrastructure/src/tests/TESTING_PATTERNS.md`:
- Quick reference for test patterns
- Mock setup examples
- Common assertions
- Best practices

#### Updated README
Update `application-infrastructure/src/tests/README.md`:
- Explain new testing strategy
- Link to pattern reference
- Explain why CacheableDataAccess is not mocked
- Provide examples of each test type

## Implementation Examples

### Before/After: Service Layer Test

#### Before (Brittle - Mocking Cache)
```javascript
// ❌ OLD PATTERN - Complex and brittle
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const Templates = require('../../../lambda/read/services/templates');
const { Config } = require('../../../lambda/read/config');

describe('Templates Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    Config.getConnCacheProfile.mockReturnValue({
      conn: { host: ['bucket1'], path: '/templates', parameters: {} },
      cacheProfile: { pathId: 'test', defaultExpirationInSeconds: 300 }
    });
    
    Config.settings.mockReturnValue({
      s3: { buckets: ['bucket1'] }
    });
    
    // Complex mock that must understand cache internals
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const body = await fetchFunction(conn, opts);
      return { body };
    });
  });
  
  it('should list templates', async () => {
    // This test is fragile - breaks when Config structure changes
    const result = await Templates.list({});
    expect(result).toBeDefined();
  });
});
```

#### After (Robust - Mocking DAO)
```javascript
// ✅ NEW PATTERN - Simple and robust
jest.mock('../../../lambda/read/models', () => ({
  S3Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn()
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));

const Templates = require('../../../lambda/read/services/templates');
const Models = require('../../../lambda/read/models');
const { Config } = require('../../../lambda/read/config');

describe('Templates Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    Config.getConnCacheProfile.mockReturnValue({
      conn: { host: ['bucket1'], path: '/templates', parameters: {} },
      cacheProfile: { pathId: 'test', defaultExpirationInSeconds: 300 }
    });
    
    Config.settings.mockReturnValue({
      s3: { buckets: ['bucket1'] }
    });
  });
  
  it('should list templates', async () => {
    // Simple mock - just return data
    Models.S3Templates.list.mockResolvedValue({
      templates: [
        { name: 'template1', category: 'storage' }
      ],
      errors: [],
      partialData: false
    });
    
    const result = await Templates.list({ category: 'storage' });
    
    // Verify DAO was called correctly
    expect(Models.S3Templates.list).toHaveBeenCalledWith(
      expect.objectContaining({
        host: ['bucket1'],
        parameters: expect.objectContaining({
          category: 'storage'
        })
      }),
      {}
    );
    
    // Verify result
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('template1');
  });
  
  it('should handle DAO errors', async () => {
    Models.S3Templates.list.mockRejectedValue(new Error('S3 access denied'));
    
    await expect(Templates.list({})).rejects.toThrow('S3 access denied');
  });
});
```

### Before/After: Controller Layer Test

#### Before (Mocking Cache)
```javascript
// ❌ OLD PATTERN
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  }
}));

// Complex setup required...
```

#### After (Mocking Services)
```javascript
// ✅ NEW PATTERN
jest.mock('../../../lambda/read/services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
  }
}));

jest.mock('../../../lambda/read/utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../lambda/read/utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

const TemplatesController = require('../../../lambda/read/controllers/templates');
const Services = require('../../../lambda/read/services');
const SchemaValidator = require('../../../lambda/read/utils/schema-validator');
const MCPProtocol = require('../../../lambda/read/utils/mcp-protocol');

describe('Templates Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should validate input and call service', async () => {
    const props = {
      body: {
        input: {
          category: 'storage'
        }
      }
    };
    
    SchemaValidator.validate.mockReturnValue({ valid: true });
    Services.Templates.list.mockResolvedValue({
      templates: [{ name: 'template1' }]
    });
    
    const result = await TemplatesController.list(props);
    
    expect(SchemaValidator.validate).toHaveBeenCalledWith('list_templates', props.body.input);
    expect(Services.Templates.list).toHaveBeenCalledWith({
      category: 'storage',
      version: undefined,
      versionId: undefined,
      s3Buckets: undefined
    });
    expect(MCPProtocol.successResponse).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
```

### Before/After: DAO Layer Test

DAO tests should already be correct (mocking AWS SDK), but here's the pattern:

```javascript
// ✅ CORRECT PATTERN (should already exist)
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');

const s3Mock = mockClient(S3Client);

const S3Templates = require('../../../lambda/read/models/s3-templates');

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));

describe('S3 Templates DAO', () => {
  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });
  
  it('should list templates from S3', async () => {
    s3Mock.on(ListObjectsV2Command, {
      Bucket: 'test-bucket',
      Delimiter: '/',
      MaxKeys: 100
    }).resolves({
      CommonPrefixes: [{ Prefix: 'atlantis/' }]
    });
    
    s3Mock.on(ListObjectsV2Command, {
      Bucket: 'test-bucket',
      Prefix: 'atlantis/templates/v2/'
    }).resolves({
      Contents: [
        {
          Key: 'atlantis/templates/v2/storage/template-s3.yml',
          LastModified: new Date('2024-01-01'),
          Size: 1024
        }
      ]
    });
    
    const connection = {
      host: 'test-bucket',
      path: 'templates/v2',
      parameters: {}
    };
    
    const result = await S3Templates.list(connection, {});
    
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('template-s3');
  });
});
```

## Summary

This design document provides a comprehensive strategy for refactoring 217 failing tests across 26 test files by bypassing the CacheableDataAccess.getData() cache layer and directly mocking DAO functions instead. The key benefits of this approach are:

1. **Simplicity**: Tests no longer need to understand cache internals
2. **Robustness**: Tests are resilient to Config refactoring
3. **Focus**: Tests verify business logic, not caching mechanism
4. **Maintainability**: Clear patterns for each test layer
5. **Production Safety**: Production code continues using cache for performance

The migration will be executed in 5 phases over 3 weeks, starting with high-priority service and controller tests, then moving to DAO and Lambda integration tests, and finally updating integration and performance tests. Each phase includes verification steps and rollback strategies to minimize risk.

The test patterns are organized by layer (Controllers mock Services, Services mock Models, Models mock AWS SDK, Lambda mocks Services), with clear examples and templates for each pattern. Documentation will be created to guide future test development and ensure consistency across the codebase.
