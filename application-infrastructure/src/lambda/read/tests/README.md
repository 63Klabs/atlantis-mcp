# Testing with Jest

This project uses Jest for testing. All tests are located in the `tests/` directory.

## Running Tests

```bash
npm test
```

## Test Structure

Tests are written using Jest's standard syntax:
- `describe()` - Groups related tests
- `test()` or `it()` - Individual test cases
- `beforeAll()` - Setup before all tests in a describe block
- `beforeEach()` - Setup before each test
- `afterAll()` - Cleanup after all tests
- `afterEach()` - Cleanup after each test

## AWS Resource Mocking

The project includes `aws-sdk-client-mock` for mocking AWS SDK v3 clients without requiring credentials.

### Example: Mocking DynamoDB

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

### Example: Mocking S3

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

### Example: Mocking SSM Parameter Store

```javascript
const { mockClient } = require('aws-sdk-client-mock');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const ssmMock = mockClient(SSMClient);

beforeEach(() => {
  ssmMock.reset();
});

test('should get parameter from SSM', async () => {
  ssmMock.on(GetParameterCommand).resolves({
    Parameter: {
      Name: '/my/parameter',
      Value: 'secret-value'
    }
  });

  // Your test code here
});
```

## Testing Config Module

### Config.settings() Pattern

The Config module uses a getter pattern for accessing settings. Tests should:

1. Call `Config.init()` in `beforeAll()` or `beforeEach()`
2. Access settings via `Config.settings()` getter
3. Mock settings by spying on the getter

Example:

```javascript
const { Config } = require('../lambda/read/config');

beforeAll(async () => {
  await Config.init();
});

test('should access settings', () => {
  const settings = Config.settings();
  expect(settings.s3.buckets).toBeDefined();
});
```

### Mocking Config.settings()

To mock settings in tests:

```javascript
const { Config } = require('../lambda/read/config');

// Spy on the settings getter
jest.spyOn(Config, 'settings', 'get').mockReturnValue({
  s3: { buckets: ['test-bucket'] },
  github: { userOrgs: ['test-org'] },
  rateLimits: {
    public: { limit: 100, window: 3600 }
  }
});

// Restore after test
afterEach(() => {
  jest.restoreAllMocks();
});
```

### Testing CachedSSMParameter

The `settings.github.token` is a CachedSSMParameter instance. To test:

```javascript
const { CachedSSMParameter } = require('@63klabs/cache-data');

test('should use CachedSSMParameter for token', () => {
  const settings = Config.settings();
  expect(settings.github.token).toBeInstanceOf(CachedSSMParameter);
});
```

### Integration Testing Config

Integration tests should verify:

1. Config.init() completes successfully
2. Config.getConnCacheProfile() returns valid profiles
3. Settings structure is complete and valid
4. CachedSSMParameter instances work correctly

Example:

```javascript
describe('Config Integration', () => {
  beforeAll(async () => {
    await Config.init();
  });

  test('should retrieve connection profiles', () => {
    const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
    expect(profile.defaultExpirationInSeconds).toBeGreaterThan(0);
  });
});
```

## Best Practices

1. **Reset mocks between tests** - Use `beforeEach()` to reset mocks
2. **Mock only what you need** - Don't mock the entire AWS SDK
3. **Test business logic** - Focus on your code, not AWS SDK behavior
4. **Use descriptive test names** - Make it clear what each test validates
5. **Keep tests isolated** - Each test should be independent
6. **Initialize Config before use** - Always call `Config.init()` before accessing settings
7. **Mock Config.settings() properly** - Use `jest.spyOn()` on the getter, not the module

## Coverage

To run tests with coverage:

```bash
npm test -- --coverage
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [aws-sdk-client-mock Documentation](https://github.com/m-radzikowski/aws-sdk-client-mock)
- [AWS SDK v3 Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
