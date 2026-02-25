/**
 * Unit tests for S3 Templates DAO - OR condition support
 *
 * Tests that when both version and versionId are provided,
 * the get() function returns templates matching EITHER criterion.
 */

const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand, ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');

// Mock S3 client
const s3Mock = mockClient(S3Client);

// Import module under test
const S3Templates = require('../../../lambda/read/models/s3-templates');

describe('S3 Templates DAO - OR Condition', () => {
  beforeEach(() => {
    s3Mock.reset();

    // Mock checkBucketAccess to always return true
    jest.spyOn(S3Templates, 'checkBucketAccess').mockResolvedValue(true);

    // Mock getIndexedNamespaces to return test namespace
    jest.spyOn(S3Templates, 'getIndexedNamespaces').mockResolvedValue(['test-namespace']);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Helper to create a readable stream from string
   */
  function createStream(content) {
    const stream = new Readable();
    stream.push(content);
    stream.push(null);
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
        category: 'Storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-999'
      }
    };

    // Mock ListObjectVersions to return multiple versions
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false },
        { VersionId: 'version-id-789', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (matches version criterion)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-123'
    }).resolves({
      Body: createStream(createTemplateContent('v1.0.0/2024-01-15')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-15'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (doesn't match)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-456'
    }).resolves({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-456',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    const result = await S3Templates.get(connection);

    expect(result).not.toBeNull();
    expect(result.version).toBe('v1.0.0/2024-01-15');
    expect(result.versionId).toBe('version-id-123');
    expect(result.name).toBe('test-template');
    expect(result.category).toBe('Storage');
  });

  it('should return template when versionId matches (both version and versionId provided)', async () => {
    const connection = {
      host: ['test-bucket'],
      path: 'templates/v2',
      parameters: {
        category: 'Storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-456'
      }
    };

    // Mock ListObjectVersions
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false },
        { VersionId: 'version-id-789', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (doesn't match)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-123'
    }).resolves({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (matches versionId criterion)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-456'
    }).resolves({
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
        category: 'Storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15',
        versionId: 'version-id-999'
      }
    };

    // Mock ListObjectVersions
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { VersionId: 'version-id-123', IsLatest: true },
        { VersionId: 'version-id-456', IsLatest: false }
      ]
    });

    // Mock GetObject for version-id-123 (doesn't match)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-123'
    }).resolves({
      Body: createStream(createTemplateContent('v0.9.0/2024-01-10')),
      VersionId: 'version-id-123',
      LastModified: new Date('2024-01-10'),
      ContentLength: 100
    });

    // Mock GetObject for version-id-456 (doesn't match)
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-456'
    }).resolves({
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
        category: 'Storage',
        templateName: 'test-template',
        version: 'v1.0.0/2024-01-15'
      }
    };

    // Mock GetObject for latest version
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml'
    }).resolves({
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
        category: 'Storage',
        templateName: 'test-template',
        versionId: 'version-id-456'
      }
    };

    // Mock GetObject for specific version
    s3Mock.on(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-namespace/templates/v2/Storage/test-template.yml',
      VersionId: 'version-id-456'
    }).resolves({
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
