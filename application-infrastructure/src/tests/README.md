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

## Best Practices

1. **Reset mocks between tests** - Use `beforeEach()` to reset mocks
2. **Mock only what you need** - Don't mock the entire AWS SDK
3. **Test business logic** - Focus on your code, not AWS SDK behavior
4. **Use descriptive test names** - Make it clear what each test validates
5. **Keep tests isolated** - Each test should be independent

## Coverage

To run tests with coverage:

```bash
npm test -- --coverage
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [aws-sdk-client-mock Documentation](https://github.com/m-radzikowski/aws-sdk-client-mock)
- [AWS SDK v3 Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
