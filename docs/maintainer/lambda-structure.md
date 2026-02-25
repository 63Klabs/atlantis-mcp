# Lambda Function Structure and Organization

## Overview

The Atlantis MCP Server uses a multi-function Lambda architecture with clear separation between read and write operations. This document details the structure, organization, and design patterns used in the Lambda functions.

## Directory Structure

```
application-infrastructure/
├── src/
│   └── lambda/
│       ├── read/                          # Read-only operations (Phase 1)
│       │   ├── index.js                   # Handler entry point
│       │   ├── package.json               # Function dependencies
│       │   ├── package-lock.json          # Locked dependencies
│       │   ├── config/                    # Configuration
│       │   │   ├── index.js               # Config initialization
│       │   │   ├── connections.js         # Cache-data connections
│       │   │   └── settings.js            # Application settings
│       │   ├── routes/                    # Request routing
│       │   │   └── index.js               # Route dispatcher
│       │   ├── controllers/               # Request handlers
│       │   │   ├── index.js               # Controller exports
│       │   │   ├── templates.js           # Template operations
│       │   │   ├── starters.js            # Starter operations
│       │   │   ├── documentation.js       # Documentation search
│       │   │   ├── validation.js          # Naming validation
│       │   │   └── updates.js             # Update checking
│       │   ├── services/                  # Business logic
│       │   │   ├── index.js               # Service exports
│       │   │   ├── templates.js           # Template service
│       │   │   ├── starters.js            # Starter service
│       │   │   ├── documentation.js       # Documentation service
│       │   │   └── validation.js          # Validation service
│       │   ├── models/                    # Data access
│       │   │   ├── index.js               # Model exports
│       │   │   ├── s3-templates.js        # S3 template DAO
│       │   │   ├── s3-starters.js         # S3 starter DAO
│       │   │   ├── github-api.js          # GitHub API DAO
│       │   │   └── doc-index.js           # Documentation index DAO
│       │   ├── views/                     # Response formatting
│       │   │   └── mcp-response.js        # MCP protocol formatter
│       │   └── utils/                     # Utilities
│       │       ├── mcp-protocol.js        # MCP protocol helpers
│       │       ├── schema-validator.js    # JSON Schema validation
│       │       ├── naming-rules.js        # Naming rules
│       │       ├── error-handler.js       # Error handling
│       │       └── rate-limiter.js        # Rate limiting
│       └── write/                         # Write operations (Phase 2)
│           └── .gitkeep                   # Placeholder
└── tests/                                 # Tests at repository root
    ├── unit/
    ├── integration/
    └── property/
```

## Design Principles

### 1. Self-Contained Functions

Each Lambda function is completely self-contained:
- All code in its own directory (`src/lambda/read/`, `src/lambda/write/`)
- Own `package.json` with all dependencies
- No shared code directories (until Phase 2 shows actual duplication)
- Relative imports within function directory

**Rationale**: Avoids premature abstraction, simplifies deployment, reduces coupling.

### 2. Layered Architecture

Functions follow MVC pattern with clear layer separation:

```
Handler → Router → Controller → Service → Model → Data Source
```

Each layer has specific responsibilities and dependencies flow downward only.

### 3. YAGNI Principle

"You Aren't Gonna Need It" - Don't create shared infrastructure until multiple functions need it.

**Current State**: Single read function, no shared code.
**Future State**: When write function is added, extract common code to shared layer if duplication is significant.

### 4. Import Pattern

All imports use relative paths within the function:

```javascript
// Good - relative imports
const Config = require('./config');
const Services = require('./services');
const Models = require('./models');

// Bad - absolute imports (don't work in Lambda)
const Config = require('src/lambda/read/config');
```

## Layer Details

### Handler Layer (`index.js`)

**Purpose**: Lambda entry point and initialization.

**Structure**:
```javascript
const Config = require('./config');
const Routes = require('./routes');
const { tools: { Response } } = require('@63klabs/cache-data');

exports.handler = async (event, context) => {
  // Cold start initialization
  await Config.init();
  
  // Delegate to router
  const response = await Routes.process(event, context);
  
  // Return API Gateway response
  return response.toAPIGateway();
};
```

**Responsibilities**:
- Cold start detection and initialization
- Config.init() invocation (once per container)
- Request delegation
- Top-level error handling
- API Gateway response formatting

**Key Patterns**:
- Async initialization on cold start
- Minimal logic (delegate to router)
- Structured error handling

### Configuration Layer (`config/`)

**Purpose**: Centralized configuration management.

**Files**:
- `index.js` - Config initialization and exports
- `settings.js` - Application settings from environment variables
- `connections.js` - Cache-data connection and cache profile definitions

**Structure** (`config/index.js`):
```javascript
const settings = require('./settings');
const connections = require('./connections');
const { cache: { Cache } } = require('@63klabs/cache-data');

let initialized = false;

const Config = {
  async init() {
    if (initialized) return;
    
    // Initialize cache-data
    await Cache.init({
      dynamoDbTable: settings.cache.dynamoDbTable,
      s3Bucket: settings.cache.s3Bucket,
      // ... other config
    });
    
    // Load secrets from SSM
    // Build documentation index (async, non-blocking)
    
    initialized = true;
  },
  
  settings() {
    return settings;
  },
  
  getConnCacheProfile(connectionName, profileName) {
    return {
      conn: connections[connectionName],
      cacheProfile: connections.cacheProfiles[profileName]
    };
  }
};

module.exports = Config;
```

**Key Patterns**:
- Singleton initialization
- Lazy loading of expensive resources
- Environment variable parsing
- Secret management

### Routing Layer (`routes/`)

**Purpose**: Route requests to appropriate controllers.

**Structure** (`routes/index.js`):
```javascript
const { tools: { ClientRequest, Response } } = require('@63klabs/cache-data');
const Controllers = require('../controllers');

const process = async (event, context) => {
  const REQ = new ClientRequest(event, context);
  const RESP = new Response(REQ);
  
  if (!REQ.isValid()) {
    return RESP.reset({statusCode: 400});
  }
  
  const props = REQ.getProps();
  const tool = props.body?.tool || props.queryStringParameters?.tool;
  
  switch (tool) {
    case 'list_templates':
      RESP.setBody(await Controllers.Templates.list(props));
      break;
    case 'get_template':
      RESP.setBody(await Controllers.Templates.get(props));
      break;
    // ... other tools
    default:
      RESP.reset({statusCode: 404});
  }
  
  return RESP;
};

module.exports = { process };
```

**Key Patterns**:
- Switch statement for routing (clear and performant)
- ClientRequest/Response from cache-data
- 404 for unknown tools
- 405 for unsupported methods

### Controller Layer (`controllers/`)

**Purpose**: Handle requests, validate inputs, orchestrate services.

**Structure** (example: `controllers/templates.js`):
```javascript
const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');

const list = async (props) => {
  // 1. Validate input
  const input = props.body?.input || {};
  const validation = SchemaValidator.validate('list_templates', input);
  if (!validation.valid) {
    return MCPProtocol.errorResponse('INVALID_INPUT', validation.errors);
  }
  
  // 2. Extract parameters
  const { category, version, versionId, s3Buckets } = input;
  
  // 3. Call service
  const templates = await Services.Templates.list({ 
    category, 
    version, 
    versionId, 
    s3Buckets 
  });
  
  // 4. Format response
  return MCPProtocol.successResponse('list_templates', templates);
};

const get = async (props) => {
  // Similar pattern
};

module.exports = { list, get };
```

**Key Patterns**:
- Input validation first (fail fast)
- Parameter extraction
- Service orchestration
- Error handling with context
- MCP protocol response formatting

### Service Layer (`services/`)

**Purpose**: Business logic and caching.

**Structure** (example: `services/templates.js`):
```javascript
const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const Config = require('../config');
const Models = require('../models');

const list = async (options = {}) => {
  const { category, version, versionId, s3Buckets } = options;
  
  // Get connection and cache profile
  const { conn, cacheProfile } = Config.getConnCacheProfile(
    's3-templates', 
    'templates-list'
  );
  
  // Determine buckets to search
  let bucketsToSearch = s3Buckets || Config.settings().atlantisS3Buckets;
  
  // Set connection properties for cache key
  conn.host = bucketsToSearch;
  conn.parameters = { category, version, versionId };
  
  // Define fetch function
  const fetchFunction = async (connection, opts) => {
    return await Models.S3Templates.list(connection, opts);
  };
  
  // Use cache-data pass-through caching
  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}
  );
  
  return result.body;
};

module.exports = { list };
```

**Key Patterns**:
- Cache-data integration
- Connection and cache profile from config
- Fetch function for cache misses
- Parameter-based cache keys
- Business logic transformation

### Model Layer (`models/`)

**Purpose**: Data access and external API calls.

**Structure** (example: `models/s3-templates.js`):
```javascript
const { tools: { AWS, DebugAndLog } } = require('@63klabs/cache-data');

const list = async (connection, options = {}) => {
  const { category, version, versionId } = connection.parameters || {};
  const buckets = Array.isArray(connection.host) 
    ? connection.host 
    : [connection.host];
  
  const allTemplates = [];
  const errors = [];
  
  // Iterate through buckets in priority order
  for (const bucket of buckets) {
    try {
      // Check bucket access
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        DebugAndLog.warn(`Bucket ${bucket} access not allowed`);
        errors.push({ source: bucket, error: 'Access denied' });
        continue;
      }
      
      // Get namespaces
      const namespaces = await getIndexedNamespaces(bucket);
      
      // List templates from each namespace
      for (const namespace of namespaces) {
        const templates = await listTemplatesFromNamespace(
          bucket, 
          namespace, 
          connection.path
        );
        allTemplates.push(...templates);
      }
    } catch (error) {
      // Brown-out support: log and continue
      DebugAndLog.warn(`Failed to list from ${bucket}: ${error.message}`);
      errors.push({ source: bucket, error: error.message });
    }
  }
  
  // Deduplicate
  const uniqueTemplates = deduplicateTemplates(allTemplates);
  
  return {
    templates: uniqueTemplates,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};

module.exports = { list };
```

**Key Patterns**:
- AWS SDK v3 usage
- Multi-source iteration with priority
- Brown-out support (continue on errors)
- Error collection and reporting
- Data transformation

### View Layer (`views/`)

**Purpose**: Format responses per MCP protocol.

**Structure** (`views/mcp-response.js`):
```javascript
const formatToolResponse = (toolName, data) => {
  switch (toolName) {
    case 'list_templates':
      return {
        tool: toolName,
        result: {
          templates: data.templates,
          count: data.templates.length,
          partialData: data.partialData,
          errors: data.errors
        },
        description: 'List of available CloudFormation templates',
        examples: [
          '// List all templates',
          'const templates = await mcp.listTemplates();'
        ]
      };
    // ... other tools
  }
};

module.exports = { formatToolResponse };
```

**Key Patterns**:
- MCP protocol compliance
- Tool descriptions for AI
- Usage examples
- Consistent response structure

### Utility Layer (`utils/`)

**Purpose**: Shared utilities within function.

**Files**:
- `mcp-protocol.js` - MCP protocol helpers (successResponse, errorResponse)
- `schema-validator.js` - JSON Schema validation
- `naming-rules.js` - Atlantis naming convention validation
- `error-handler.js` - Error handling utilities
- `rate-limiter.js` - Rate limiting logic

**Key Patterns**:
- Pure functions (no side effects)
- Well-tested utilities
- Clear interfaces

## Module Export Pattern

Each directory has an `index.js` that exports all modules:

```javascript
// controllers/index.js
const Templates = require('./templates');
const Starters = require('./starters');
const Documentation = require('./documentation');
const Validation = require('./validation');
const Updates = require('./updates');

module.exports = {
  Templates,
  Starters,
  Documentation,
  Validation,
  Updates
};
```

**Benefits**:
- Single import point: `const Controllers = require('./controllers')`
- Clear module boundaries
- Easy to add new modules

## Dependency Management

### package.json Structure

```json
{
  "name": "atlantis-mcp-read-function",
  "version": "1.0.0",
  "description": "Read-only operations for Atlantis MCP Server",
  "main": "index.js",
  "dependencies": {
    "@63klabs/cache-data": "^1.3.6",
    "@aws-sdk/client-s3": "^3.x.x",
    "@aws-sdk/client-dynamodb": "^3.x.x",
    "@aws-sdk/client-ssm": "^3.x.x"
  },
  "devDependencies": {
    "jest": "^29.x.x"
  }
}
```

### Dependency Guidelines

**Include**:
- @63klabs/cache-data (caching, routing, AWS SDK integration)
- AWS SDK v3 clients (specific services only)
- Minimal third-party libraries

**Exclude**:
- AWS SDK v2 (use v3)
- Large libraries (lodash, moment, etc.)
- Unnecessary dependencies

## Build and Deployment

### Build Process

```yaml
# buildspec.yml
phases:
  install:
    runtime-versions:
      nodejs: 24
  build:
    commands:
      - cd application-infrastructure/src/lambda/read
      - npm ci --production
      - cd ../../../..
      - sam build
artifacts:
  files:
    - template.yml
    - application-infrastructure/src/lambda/read/**/*
```

### Deployment Package

The deployment package includes:
- All JavaScript files
- node_modules (production only)
- package.json and package-lock.json

**Excluded**:
- Tests
- Development dependencies
- Documentation
- .git directory

## Testing Strategy

Tests are located at repository root, not within Lambda functions:

```
tests/
├── unit/
│   ├── controllers/
│   ├── services/
│   ├── models/
│   └── utils/
├── integration/
│   └── lambda/
└── property/
    └── naming-validation/
```

**Rationale**: Tests don't need to be deployed with function code.

## Cold Start Optimization

### Strategies

1. **Minimal Dependencies**: Reduce package size
2. **Lazy Loading**: Load expensive resources on demand
3. **Connection Pooling**: Reuse AWS SDK clients
4. **Async Initialization**: Non-blocking config init
5. **Container Reuse**: Cache data across invocations

### Cold Start Flow

```javascript
// Global scope - runs once per container
const Config = require('./config');
let configInitialized = false;

exports.handler = async (event, context) => {
  // Initialize on first invocation
  if (!configInitialized) {
    await Config.init();
    configInitialized = true;
  }
  
  // Handle request
  // ...
};
```

## Error Handling

### Error Categories

1. **Client Errors (4xx)**: Invalid input, not found, rate limited
2. **Server Errors (5xx)**: Internal errors, service unavailable
3. **Partial Errors**: Some sources failed (brown-out)

### Error Response Format

```javascript
{
  error: {
    code: 'TEMPLATE_NOT_FOUND',
    message: 'Template not found: storage/s3-bucket',
    details: {
      availableTemplates: ['storage/s3-artifacts', 'storage/s3-oac']
    },
    requestId: 'abc-123-def-456'
  }
}
```

## Logging

### Log Levels

- **ERROR**: Fatal errors, exceptions
- **WARN**: Non-fatal errors, brown-out scenarios
- **INFO**: Request/response, important events
- **DEBUG**: Detailed debugging information
- **DIAG**: Diagnostic information

### Log Format

```javascript
{
  timestamp: '2026-01-29T12:34:56.789Z',
  level: 'INFO',
  requestId: 'abc-123-def-456',
  tool: 'list_templates',
  duration: 234,
  cacheHit: true,
  message: 'Request completed successfully'
}
```

## Performance Monitoring

### Key Metrics

- Lambda duration
- Cache hit rate
- Source failure rate
- Error rate
- Cold start frequency

### CloudWatch Metrics

```javascript
// Custom metrics
await cloudwatch.putMetricData({
  Namespace: 'AtlantisMCP',
  MetricData: [{
    MetricName: 'CacheHitRate',
    Value: cacheHitRate,
    Unit: 'Percent'
  }]
});
```

## Future Enhancements

### Phase 2: Write Function

When adding write function:
1. Create `src/lambda/write/` directory
2. Follow same structure as read function
3. Extract common code to shared layer if duplication is significant
4. Update buildspec.yml to build both functions

### Shared Code Layer

If duplication becomes significant:
1. Create `src/lambda/shared/` directory
2. Move common utilities
3. Update imports in both functions
4. Deploy as Lambda Layer

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Caching Strategy](./caching-strategy.md)
- [Testing Procedures](./testing.md)
- [Deployment Guide](../deployment/README.md)
