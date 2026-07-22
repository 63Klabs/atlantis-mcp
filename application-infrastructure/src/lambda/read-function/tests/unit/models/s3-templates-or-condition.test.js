/**
 * Unit tests for S3 Templates DAO - OR condition support
 *
 * Tests that when both version and versionId are provided,
 * the get() function returns templates matching EITHER criterion.
 */

// Mock @63klabs/cache-data AWS.s3.client
const mockS3Send = jest.fn();
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      s3: {
        client: {
          send: mockS3Send
        }
      }
    }
  }
}));

// Mock ErrorHandler
jest.mock('../../../utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

const { Readable } = require('stream');

// Import module under test (it will use the mocked AWS.s3.client)
const S3Templates = require('../../../models/s3-templates');

describe('S3 Templates DAO - OR Condition', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  /**
   * Helper to create a readable stream from string
   */
  function createStream(content) {
    const stream = new Readable();
    stream.push(content);
    stream.push(null);
    
    // Add transformToString method for AWS SDK v3 compatibility
    stream.transformToString = async () => content;
    
    return stream;
  }

  /**
   * Helper to create template content with version
   */
  function createTemplateContent(version) {
    return `# Version: ${version}
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Parameters:
  TestParam:
    Type: String
Outputs:
  TestOutput:
    Value: test`;
  }

  it('should return template when version matches (both version and versionId provided)', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-999'
      }
    };

    // Mock namespace discovery (ListObjectsV2Command)
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'test-namespace/' }]
    });

    // Mock ListObjectVersions to return multiple versions (for .yml extension)
    mockS3Send.mockResolvedValueOnce({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false },
        { VersionId: 'version-id-789', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (matches version criterion)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v1.0.0/2024-01-15')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-15'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (in case first doesn't match)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-456',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-789 (in case second doesn't match)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.8.0/2024-01-05')),
      VersionId: 'version-id-789',
      LastModified: new Date('2024-01-05'),
      ContentLength: 100
    });

    // Mock ListObjectVersions for .yaml extension (no versions found)
    mockS3Send.mockResolvedValueOnce({
      Versions: []
    });

    const result = await S3Templates.get(connection);

    // Debug: Check how many times mockS3Send was called
    console.log('mockS3Send call count:', mockS3Send.mock.calls.length);

    expect(result).not.toBeNull();
    expect(result.version).toBe('v1.0.0/2024-01-15');
    expect(result.versionId).toBe('version-id-123');
    expect(result.name).toBe('test-template');
    expect(result.category).toBe('storage');
  });

  it('should return template when versionId matches (both version and versionId provided)', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-456'
      }
    };

    // Mock namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'test-namespace/' }]
    });

    // Mock ListObjectVersions
    mockS3Send.mockResolvedValueOnce({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false },
        { VersionId: 'version-id-789', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (doesn't match)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (matches versionId criterion)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.8.0/2024-01-05')),
      VersionId: 'version-id-456',
      LastModified: new Date('2024-01-05'),
      ContentLength: 100
    });

    const result = await S3Templates.get(connection);

    expect(result).not.toBeNull();
    expect(result.version).toBe('v0.8.0/2024-01-05');
    expect(result.versionId).toBe('version-id-456');
    expect(result.name).toBe('test-template');
  });

  it('should return null when neither version nor versionId matches', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-999'
      }
    };

    // Mock namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'test-namespace/' }]
    });

    // Mock ListObjectVersions
    mockS3Send.mockResolvedValueOnce({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (doesn't match)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (doesn't match)
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.8.0/2024-01-05')),
      VersionId: 'version-id-456',
      LastModified: new Date('2024-01-05'),
      ContentLength: 100
    });

    const result = await S3Templates.get(connection);

    expect(result).toBeNull();
  });

  it('should work with only version parameter (no versionId)', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15'
      }
    };

    // Mock namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'test-namespace/' }]
    });

    // Mock GetObject for latest version
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v1.0.0/2024-01-15')),
      VersionId: 'version-id-latest',
      LastModified: new Date('2024-01-15'),
      ContentLength: 100
    });

    const result = await S3Templates.get(connection);

    expect(result).not.toBeNull();
    expect(result.version).toBe('v1.0.0/2024-01-15');
  });

  it('should work with only versionId parameter (no version)', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'storage',
        templateName: 'test-template',
        versionId: 'version-id-456'
      }
    };

    // Mock namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'test-namespace/' }]
    });

    // Mock GetObject for specific version
    mockS3Send.mockResolvedValueOnce({
      Body: createStream(createTemplateContent('v0.8.0/2024-01-05')),
      VersionId: 'version-id-456',
      LastModified: new Date('2024-01-05'),
      ContentLength: 100
    });

    const result = await S3Templates.get(connection);

    expect(result).not.toBeNull();
    expect(result.versionId).toBe('version-id-456');
    expect(result.version).toBe('v0.8.0/2024-01-05');
  });
});
