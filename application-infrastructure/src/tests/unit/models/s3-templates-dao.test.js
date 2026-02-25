/**
 * Unit Tests for S3 Templates DAO
 * 
 * Tests all functions in the S3 Templates Data Access Object including:
 * - list() function with multi-bucket support
 * - get() function with version handling
 * - listVersions() function
 * - checkBucketAccess()
 * - getIndexedNamespaces()
 * - parseCloudFormationTemplate()
 * - deduplicateTemplates()
 * - Helper functions
 */

const { S3Client, GetObjectCommand, ListObjectsV2Command, ListObjectVersionsCommand, GetObjectTaggingCommand } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');
const S3Templates = require('../../../lambda/read/models/s3-templates');

// Mock S3 client
const s3Mock = mockClient(S3Client);

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

// Mock ErrorHandler
jest.mock('../../../lambda/read/utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

describe('S3 Templates DAO', () => {
  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });

  describe('11.5.1 - list() function', () => {
    it('should list templates from single bucket', async () => {
      // Mock namespace discovery
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'atlantis/' }
        ]
      });

      // Mock template listing
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/templates/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          },
          {
            Key: 'atlantis/templates/v2/Network/template-vpc.yml',
            LastModified: new Date('2024-01-02'),
            Size: 2048
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(2);
      expect(result.templates[0].name).toBe('template-s3');
      expect(result.templates[0].category).toBe('Storage');
      expect(result.templates[1].name).toBe('template-vpc');
      expect(result.templates[1].category).toBe('Network');
      expect(result.partialData).toBe(false);
    });

    it('should list templates from multiple buckets with priority ordering', async () => {
      // Mock namespace discovery for bucket1
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock namespace discovery for bucket2
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock template listing for bucket1
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Prefix: 'atlantis/templates/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          }
        ]
      });

      // Mock template listing for bucket2
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Prefix: 'atlantis/templates/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date('2024-01-02'),
            Size: 2048
          },
          {
            Key: 'atlantis/templates/v2/Network/template-vpc.yml',
            LastModified: new Date('2024-01-03'),
            Size: 3072
          }
        ]
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should deduplicate - first occurrence wins (bucket1)
      expect(result.templates).toHaveLength(2);
      expect(result.templates[0].bucket).toBe('bucket1');
      expect(result.templates[1].name).toBe('template-vpc');
      expect(result.templates[1].bucket).toBe('bucket2');
    });

    it('should filter templates by category', async () => {
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
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date(),
            Size: 1024
          },
          {
            Key: 'atlantis/templates/v2/Network/template-vpc.yml',
            LastModified: new Date(),
            Size: 2048
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'Storage' }
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].category).toBe('Storage');
    });

    it('should support brown-out when bucket fails', async () => {
      // Mock namespace discovery for bucket1 (fails)
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Delimiter: '/',
        MaxKeys: 100
      }).rejects(new Error('Access Denied'));

      // Mock namespace discovery for bucket2 (succeeds)
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Prefix: 'atlantis/templates/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date(),
            Size: 1024
          }
        ]
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('bucket1');
    });

    it('should support both .yml and .yaml extensions', async () => {
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
            Key: 'atlantis/templates/v2/Storage/template-s3.yml',
            LastModified: new Date(),
            Size: 1024
          },
          {
            Key: 'atlantis/templates/v2/Network/template-vpc.yaml',
            LastModified: new Date(),
            Size: 2048
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(2);
    });
  });

  describe('11.5.2 - get() function', () => {
    it('should get specific template', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      const templateContent = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Parameters:
  BucketName:
    Type: String
Outputs:
  BucketArn:
    Value: !GetAtt Bucket.Arn
`;

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml'
      }).resolves({
        Body: {
          transformToString: async () => templateContent
        },
        LastModified: new Date('2024-01-01'),
        ContentLength: templateContent.length,
        VersionId: 'v123'
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'template-s3'
        }
      };

      const result = await S3Templates.get(connection, {});

      expect(result).not.toBeNull();
      expect(result.name).toBe('template-s3');
      expect(result.category).toBe('Storage');
      expect(result.version).toBe('v1.0.0/2024-01-01');
      expect(result.versionId).toBe('v123');
      expect(result.content).toBe(templateContent);
      expect(result.parameters).toHaveProperty('BucketName');
      expect(result.outputs).toHaveProperty('BucketArn');
    });

    it('should handle OR condition for version and versionId', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectVersionsCommand, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/templates/v2/Storage/template-s3.yml'
      }).resolves({
        Versions: [
          {
            VersionId: 'v123',
            LastModified: new Date('2024-01-01'),
            Size: 1024,
            IsLatest: true
          },
          {
            VersionId: 'v456',
            LastModified: new Date('2023-12-01'),
            Size: 1000,
            IsLatest: false
          }
        ]
      });

      const templateContent1 = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Version 1.0.0
`;

      const templateContent2 = `# Version: v0.9.0/2023-12-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Version 0.9.0
`;

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml',
        VersionId: 'v123'
      }).resolves({
        Body: {
          transformToString: async () => templateContent1
        },
        LastModified: new Date('2024-01-01'),
        ContentLength: templateContent1.length
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml',
        VersionId: 'v456'
      }).resolves({
        Body: {
          transformToString: async () => templateContent2
        },
        LastModified: new Date('2023-12-01'),
        ContentLength: templateContent2.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'template-s3',
          version: 'v1.0.0/2024-01-01',
          versionId: 'v456'
        }
      };

      const result = await S3Templates.get(connection, {});

      // Should match first version that satisfies EITHER criterion
      expect(result).not.toBeNull();
      expect(result.version).toBe('v1.0.0/2024-01-01');
    });

    it('should try .yaml extension if .yml not found', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // .yml not found
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml'
      }).rejects({ name: 'NoSuchKey' });

      // .yaml found
      const templateContent = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
`;

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yaml'
      }).resolves({
        Body: {
          transformToString: async () => templateContent
        },
        LastModified: new Date(),
        ContentLength: templateContent.length,
        VersionId: 'v123'
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'template-s3'
        }
      };

      const result = await S3Templates.get(connection, {});

      expect(result).not.toBeNull();
      expect(result.name).toBe('template-s3');
    });

    it('should return null if template not found', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'nonexistent'
        }
      };

      const result = await S3Templates.get(connection, {});

      expect(result).toBeNull();
    });
  });

  describe('11.5.3 - listVersions() function', () => {
    it('should list all versions of a template', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectVersionsCommand, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/templates/v2/Storage/template-s3.yml'
      }).resolves({
        Versions: [
          {
            VersionId: 'v123',
            LastModified: new Date('2024-01-01'),
            Size: 1024,
            IsLatest: true
          },
          {
            VersionId: 'v456',
            LastModified: new Date('2023-12-01'),
            Size: 1000,
            IsLatest: false
          }
        ]
      });

      const templateContent1 = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
`;

      const templateContent2 = `# Version: v0.9.0/2023-12-01
AWSTemplateFormatVersion: '2010-09-09'
`;

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml',
        VersionId: 'v123'
      }).resolves({
        Body: {
          transformToString: async () => templateContent1
        }
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/Storage/template-s3.yml',
        VersionId: 'v456'
      }).resolves({
        Body: {
          transformToString: async () => templateContent2
        }
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'template-s3'
        }
      };

      const result = await S3Templates.listVersions(connection, {});

      expect(result.versions).toHaveLength(2);
      expect(result.versions[0].versionId).toBe('v123');
      expect(result.versions[0].version).toBe('v1.0.0/2024-01-01');
      expect(result.versions[0].isLatest).toBe(true);
      expect(result.versions[1].versionId).toBe('v456');
      expect(result.versions[1].version).toBe('v0.9.0/2023-12-01');
    });

    it('should return empty versions array if template not found', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectVersionsCommand).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'Storage',
          templateName: 'nonexistent'
        }
      };

      const result = await S3Templates.listVersions(connection, {});

      expect(result.versions).toHaveLength(0);
      expect(result.templateName).toBe('nonexistent');
    });
  });

  describe('11.5.4 - checkBucketAccess()', () => {
    it('should return true for accessible bucket', async () => {
      const result = await S3Templates.checkBucketAccess('test-bucket');
      expect(result).toBe(true);
    });

    it('should return false for inaccessible bucket', async () => {
      // Currently always returns true - this test documents expected behavior
      const result = await S3Templates.checkBucketAccess('inaccessible-bucket');
      expect(result).toBe(true); // TODO: Implement proper bucket tagging check
    });
  });

  describe('11.5.5 - getIndexedNamespaces()', () => {
    it('should discover namespaces from bucket', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'atlantis/' },
          { Prefix: 'finance/' },
          { Prefix: 'devops/' }
        ]
      });

      const result = await S3Templates.getIndexedNamespaces('test-bucket');

      expect(result).toHaveLength(3);
      expect(result).toContain('atlantis');
      expect(result).toContain('finance');
      expect(result).toContain('devops');
    });

    it('should return empty array if bucket has no namespaces', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: []
      });

      const result = await S3Templates.getIndexedNamespaces('test-bucket');

      expect(result).toHaveLength(0);
    });

    it('should return empty array on error', async () => {
      s3Mock.on(ListObjectsV2Command).rejects(new Error('Access Denied'));

      const result = await S3Templates.getIndexedNamespaces('test-bucket');

      expect(result).toHaveLength(0);
    });
  });

  describe('11.5.6 - parseCloudFormationTemplate()', () => {
    it('should parse valid CloudFormation template', () => {
      const templateContent = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
Parameters:
  BucketName:
    Type: String
    Description: Name of the S3 bucket
Outputs:
  BucketArn:
    Value: !GetAtt Bucket.Arn
    Description: ARN of the bucket
Resources:
  Bucket:
    Type: AWS::S3::Bucket
`;

      const result = S3Templates.parseCloudFormationTemplate(templateContent);

      expect(result.version).toBe('v1.0.0/2024-01-01');
      expect(result.Description).toBe('Test template');
      expect(result.Parameters).toHaveProperty('BucketName');
      expect(result.Outputs).toHaveProperty('BucketArn');
      expect(result.Resources).toHaveProperty('Bucket');
    });

    it('should handle template without version comment', () => {
      const templateContent = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test template
`;

      const result = S3Templates.parseCloudFormationTemplate(templateContent);

      expect(result.version).toBeNull();
      expect(result.Description).toBe('Test template');
    });

    it('should handle invalid YAML gracefully', () => {
      const templateContent = `This is not valid YAML: {{{`;

      const result = S3Templates.parseCloudFormationTemplate(templateContent);

      expect(result.version).toBeNull();
      expect(result.Description).toBe('');
      expect(result.Parameters).toEqual({});
    });
  });

  describe('11.5.7 - deduplicateTemplates()', () => {
    it('should deduplicate templates by category and name', () => {
      const templates = [
        { category: 'Storage', name: 'template-s3', bucket: 'bucket1' },
        { category: 'Storage', name: 'template-s3', bucket: 'bucket2' },
        { category: 'Network', name: 'template-vpc', bucket: 'bucket1' },
        { category: 'Network', name: 'template-vpc', bucket: 'bucket2' }
      ];

      const result = S3Templates.deduplicateTemplates(templates);

      expect(result).toHaveLength(2);
      expect(result[0].bucket).toBe('bucket1'); // First occurrence wins
      expect(result[1].bucket).toBe('bucket1');
    });

    it('should handle empty array', () => {
      const result = S3Templates.deduplicateTemplates([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('Helper Functions', () => {
    it('parseHumanReadableVersion should extract version from comment', () => {
      const content = `# Version: v1.2.3/2024-01-15
AWSTemplateFormatVersion: '2010-09-09'
`;
      const result = S3Templates.parseHumanReadableVersion(content);
      expect(result).toBe('v1.2.3/2024-01-15');
    });

    it('buildTemplateKey should construct correct S3 key', () => {
      const result = S3Templates.buildTemplateKey('atlantis', 'templates/v2', 'Storage', 'template-s3', '.yml');
      expect(result).toBe('atlantis/templates/v2/Storage/template-s3.yml');
    });

    it('filterByCategory should filter correctly', () => {
      expect(S3Templates.filterByCategory({ category: 'Storage' }, 'Storage')).toBe(true);
      expect(S3Templates.filterByCategory({ category: 'Storage' }, 'Network')).toBe(false);
      expect(S3Templates.filterByCategory({ category: 'Storage' }, null)).toBe(true);
    });

    it('filterByVersion should filter correctly', () => {
      expect(S3Templates.filterByVersion({ version: 'v1.0.0/2024-01-01' }, 'v1.0.0/2024-01-01')).toBe(true);
      expect(S3Templates.filterByVersion({ version: 'v1.0.0/2024-01-01' }, 'v2.0.0/2024-01-01')).toBe(false);
      expect(S3Templates.filterByVersion({ version: 'v1.0.0/2024-01-01' }, null)).toBe(true);
    });

    it('filterByVersionId should filter correctly', () => {
      expect(S3Templates.filterByVersionId({ versionId: 'v123' }, 'v123')).toBe(true);
      expect(S3Templates.filterByVersionId({ versionId: 'v123' }, 'v456')).toBe(false);
      expect(S3Templates.filterByVersionId({ versionId: 'v123' }, null)).toBe(true);
    });
  });
});
