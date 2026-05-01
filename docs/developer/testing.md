# Testing Guide

This guide covers how to run, write, and maintain tests for the Atlantis MCP Server.

## Prerequisites

- Node.js 24+ (see `application-infrastructure/src/.nvmrc`)
- Dependencies installed: run `npm install` from `application-infrastructure/src/`

## Running Tests

All test commands run from the `application-infrastructure/src/` directory.

### Full suite

```bash
npm test
```

This invokes Jest across all four Lambda functions (read, indexer, auth, cleanup). The CI/CD pipeline runs this command — if any test fails, deployment is blocked.

### By category

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Performance tests only (excluded from default suite)
npm run test:performance
```

### Single file

```bash
npx jest lambda/read/tests/unit/utils/naming-validation.test.js
```

### Pattern matching

```bash
# All property tests for the read lambda
npx jest lambda/read/tests/property/

# All auth tests
npx jest lambda/auth/tests/
```

### With coverage

```bash
npx jest --coverage
```

### Verbose output

```bash
npx jest --verbose
```

## Test Structure

Tests live alongside each Lambda function under a `tests/` directory:

```
application-infrastructure/src/
└── lambda/
    ├── read/tests/
    │   ├── unit/            # ~70 files, organized by source module
    │   │   ├── config/
    │   │   ├── controllers/
    │   │   ├── lambda/
    │   │   ├── models/
    │   │   ├── routes/
    │   │   ├── services/
    │   │   └── utils/
    │   ├── property/        # ~17 files, correctness properties via fast-check
    │   ├── integration/     # ~7 files, cross-module interaction tests
    │   └── performance/     # 1 file, excluded from default suite
    ├── indexer/tests/
    │   ├── unit/
    │   └── property/
    ├── auth/tests/
    │   ├── unit/
    │   └── property/
    └── cleanup/tests/
        ├── unit/
        └── property/
```

### File naming

All test files use the `.test.js` extension. The naming convention reflects the test category:

| Category | Pattern | Example |
|----------|---------|---------|
| Unit | `{module-name}.test.js` | `naming-validation.test.js` |
| Property | `{feature}.property.test.js` | `error-codes.property.test.js` |
| Integration | `{feature}-integration.test.js` | `s3-integration.test.js` |
| Performance | `{feature}-performance.test.js` | `lambda-performance.test.js` |

## Jest Configuration

The Jest config lives at `application-infrastructure/src/jest.config.js`:

- **Test environment**: Node
- **Test match**: `**/lambda/{read,indexer,auth,cleanup}/tests/**/*.test.js`
- **Excluded from default run**: `tests/performance/`
- **Module resolution**: Each Lambda's `node_modules` is included so local dependencies resolve correctly

## Test Categories

### Unit tests

Test individual functions and methods in isolation. Mock external dependencies (AWS SDK, other modules). These should be fast and deterministic.

```javascript
'use strict';

const mockRouteDispatcher = jest.fn();

jest.mock('../../routes/index', () => ({
    route: mockRouteDispatcher
}));

const { handler } = require('../../index');

describe('Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 200 for valid requests', async () => {
        mockRouteDispatcher.mockResolvedValue({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: 'ok' })
        });

        const event = { httpMethod: 'GET', path: '/test', headers: {} };
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(mockRouteDispatcher).toHaveBeenCalledTimes(1);
    });
});
```

### Property-based tests

Use [fast-check](https://github.com/dubzzz/fast-check) to validate correctness properties across many randomly generated inputs. These tests express universal invariants that must hold for all valid inputs.

```javascript
const fc = require('fast-check');
const { validateNaming } = require('../../utils/naming-rules');

describe('Naming validation properties', () => {
    it('should never crash on arbitrary string input', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 200 }),
                (name) => {
                    const result = validateNaming(name);
                    // Must always return a result object, never throw
                    expect(result).toHaveProperty('valid');
                    expect(result).toHaveProperty('errors');
                }
            ),
            { numRuns: 100 }
        );
    });
});
```

Guidelines for property tests:

- Use at least 100 runs (`numRuns: 100`) for standard properties
- Limit to 3-10 runs for tests that spawn child processes
- Log the seed on failure for reproducibility (`verbose: true`)
- Set timeouts for expensive properties (60s max for standard, 120s for subprocess tests)

### Integration tests

Test interactions between modules with mocked AWS services. These verify that components work together correctly.

```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Mock = mockClient(S3Client);

describe('S3 integration', () => {
    beforeEach(() => {
        s3Mock.reset();
    });

    it('should retrieve and parse template from S3', async () => {
        s3Mock.on(GetObjectCommand).resolves({
            Body: '{"AWSTemplateFormatVersion": "2010-09-09"}'
        });

        // Test the full flow from request to parsed response
        const result = await getTemplate('my-template', 'storage');
        expect(result.content).toBeDefined();
    });
});
```

### Performance tests

Excluded from the default test suite (configured in `jest.config.js`). Run explicitly with:

```bash
npm run test:performance
```

## Mocking AWS Services

The project uses [aws-sdk-client-mock](https://github.com/m-radzikowski/aws-sdk-client-mock) for mocking AWS SDK v3 clients.

### DynamoDB

```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
    ddbMock.reset();
});

test('should get item from DynamoDB', async () => {
    ddbMock.on(GetCommand).resolves({
        Item: { id: '123', name: 'Test' }
    });

    // Your test code here
});
```

### S3

```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Mock = mockClient(S3Client);

beforeEach(() => {
    s3Mock.reset();
});

test('should get object from S3', async () => {
    s3Mock.on(GetObjectCommand).resolves({
        Body: 'test content'
    });

    // Your test code here
});
```

### SSM Parameter Store

```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const ssmMock = mockClient(SSMClient);

beforeEach(() => {
    ssmMock.reset();
});

test('should get parameter from SSM', async () => {
    ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Name: '/my/parameter', Value: 'secret-value' }
    });

    // Your test code here
});
```

## Mocking Getter Properties

Some classes use getter properties that return new objects on each access (e.g., `AWS.dynamo`). You cannot mock the returned object directly — you must spy on the getter itself:

```javascript
const { jest } = require('@jest/globals');

const tools = await import('../../lib/tools/index.js');

const mockGet = jest.fn().mockResolvedValue({ Item: { id: '123' } });

jest.spyOn(tools.default.AWS, 'dynamo', 'get').mockReturnValue({
    client: {},
    get: mockGet,
    put: jest.fn(),
    scan: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    sdk: {}
});

afterEach(() => {
    jest.restoreAllMocks();
});
```

## Writing New Tests

### Checklist

1. Place the test file in the correct category directory (`unit/`, `property/`, `integration/`)
2. Mirror the source module structure for unit tests (e.g., `utils/naming-rules.js` → `tests/unit/utils/naming-validation.test.js`)
3. Use `jest.mock()` for external dependencies
4. Reset mocks in `beforeEach()` and restore in `afterEach()`
5. Use descriptive test names that explain the expected behavior
6. Test both success and failure paths
7. For property tests, document which requirements or correctness properties are being validated

### Test isolation

Each test must be independent. Avoid shared mutable state between tests:

- Reset mocks with `jest.clearAllMocks()` or `jest.restoreAllMocks()`
- Don't rely on test execution order
- Clean up timers, connections, and temporary files
- Use unique identifiers in tests to avoid collisions

### Prototype pollution guard

When looking up values in plain objects using dynamic keys (e.g., user-provided resource types), always guard against inherited properties:

```javascript
// Safe lookup — won't match "constructor", "toString", etc.
const rules = Object.hasOwn(rulesMap, key) ? rulesMap[key] : undefined;
```

This prevents `TypeError` crashes when fast-check generates strings like `"constructor"` or `"__proto__"`.

## Debugging Failing Tests

### Run a single test with verbose output

```bash
npx jest lambda/read/tests/unit/utils/naming-validation.test.js --verbose
```

### Reproduce a property test failure

Property test failures include a seed value. Reproduce with:

```bash
FC_SEED=1234567890 npx jest lambda/read/tests/property/error-codes.property.test.js
```

### Check for runaway processes

If tests hang or seem to loop:

```bash
# Check for orphaned test processes
ps aux | grep -E "(jest|node.*test)" | grep -v grep

# Kill them if needed
pkill -f "jest"
```

## CI/CD

The pipeline runs `npm test` during the build phase. All tests must pass for deployment to proceed. Performance tests are excluded from the default suite and do not block deployment.

The test suite runs across all branches:

| Branch | Stage | Environment |
|--------|-------|-------------|
| test | test | TEST |
| beta | beta | PROD |
| main | prod | PROD |

## Resources

- [Jest documentation](https://jestjs.io/)
- [fast-check documentation](https://github.com/dubzzz/fast-check)
- [aws-sdk-client-mock documentation](https://github.com/m-radzikowski/aws-sdk-client-mock)
- [AWS SDK v3 documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
