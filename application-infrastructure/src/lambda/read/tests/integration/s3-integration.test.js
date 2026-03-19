/**
 * S3 Integration Tests
 * 
 * Tests S3 bucket access, namespace indexing, template versioning,
 * and sidecar metadata handling with mocked AWS SDK calls.
 */

const { S3Client, GetBucketTaggingCommand, ListObjectsV2Command, GetObjectCommand, ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');
const S3TemplatesDAO = require('../../models/s3-templates');
const S3StartersDAO = require('../../models/s3-starters');

const s3Mock = mockClient(S3Client);

// Skip these tests - they need AWS SDK v3 migration
describe.skip('S3 Integration Tests', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  describe('15.6.1 Test S3 bucket access checking (atlantis-mcp:Allow tag)', () => {
    it('should allow access when atlantis-mcp:Allow=true tag is present', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'Environment', Value: 'test' }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {}
      };

      const hasAccess = await S3TemplatesDAO.checkBucketAccess('test-bucket');
      expect(hasAccess).toBe(true);
    });

    it('should deny access when atlantis-mcp:Allow tag is missing', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'Environment', Value: 'test' }
        ]
      });

      const hasAccess = await S3TemplatesDAO.checkBucketAccess('test-bucket');
      expect(hasAccess).toBe(false);
    });

    it('should deny access when atlantis-mcp:Allow=false', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'false' }
        ]
      });

      const hasAccess = await S3TemplatesDAO.checkBucketAccess('test-bucket');
      expect(hasAccess).toBe(false);
    });

    it('should handle bucket tagging errors gracefully', async () => {
      s3Mock.on(GetBucketTaggingCommand).rejects(new Error('Access Denied'));

      const hasAccess = await S3TemplatesDAO.checkBucketAccess('test-bucket');
      expect(hasAccess).toBe(false);
    });

    it('should skip buckets without Allow tag in list operations', async () => {
      // First bucket has Allow tag
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'allowed-bucket' }).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      // Second bucket missing Allow tag
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'denied-bucket' }).resolves({
        TagSet: [
          { Key: 'Environment', Value: 'test' }
        ]
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'atlantis/templates/v2/storage/template.yml', LastModified: new Date(), Size: 1024 }
        ]
      });

      const connection = {
        host: ['allowed-bucket', 'denied-bucket'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3TemplatesDAO.list(connection);
      
      // Should only have templates from allowed-bucket
      expect(result.templates.length).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
      expect(result.errors.some(e => e.source === 'denied-bucket')).toBe(true);
    });
  });

  describe('15.6.2 Test namespace indexing (atlantis-mcp:IndexPriority tag)', () => {
    it('should index namespaces listed in IndexPriority tag', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis,finance,devops' }
        ]
      });

      const namespaces = await S3TemplatesDAO.getIndexedNamespaces('test-bucket');
      
      expect(namespaces).toEqual(['atlantis', 'finance', 'devops']);
    });

    it('should return empty array when IndexPriority tag is missing', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' }
        ]
      });

      const namespaces = await S3TemplatesDAO.getIndexedNamespaces('test-bucket');
      
      expect(namespaces).toEqual([]);
    });

    it('should handle single namespace in IndexPriority', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      const namespaces = await S3TemplatesDAO.getIndexedNamespaces('test-bucket');
      
      expect(namespaces).toEqual(['atlantis']);
    });

    it('should respect namespace priority order', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'priority1,priority2,priority3' }
        ]
      });

      const namespaces = await S3TemplatesDAO.getIndexedNamespaces('test-bucket');
      
      expect(namespaces[0]).toBe('priority1');
      expect(namespaces[1]).toBe('priority2');
      expect(namespaces[2]).toBe('priority3');
    });
  });

  describe('15.6.3 Test template version retrieval (Human_Readable_Version)', () => {
    it('should retrieve template by Human_Readable_Version', async () => {
      const templateContent = `# CloudFormation Template
# Version: v1.2.3/2024-01-15
# Description: Test template

AWSTemplateFormatVersion: '2010-09-09'
Description: Test template for version retrieval
Parameters:
  TestParam:
    Type: String
Outputs:
  TestOutput:
    Value: test`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'abc123',
        LastModified: new Date('2024-01-15'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v1.2.3/2024-01-15'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.version).toBe('v1.2.3/2024-01-15');
      expect(result.name).toBe('test-template');
      expect(result.category).toBe('storage');
    });

    it('should skip templates that do not match requested version', async () => {
      const templateContent = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'abc123'
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v2.0.0/2024-02-01'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      expect(result).toBeNull();
    });
  });

  describe('15.6.4 Test template version retrieval (S3_VersionId)', () => {
    it('should retrieve template by S3_VersionId', async () => {
      const templateContent = `# Version: v1.2.3/2024-01-15
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/storage/test-template.yml',
        VersionId: 'specific-version-id-123'
      }).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'specific-version-id-123',
        LastModified: new Date('2024-01-15'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          versionId: 'specific-version-id-123'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.versionId).toBe('specific-version-id-123');
      expect(result.name).toBe('test-template');
    });

    it('should list all versions using ListObjectVersions', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(ListObjectVersionsCommand).resolves({
        Versions: [
          {
            Key: 'atlantis/templates/v2/storage/test-template.yml',
            VersionId: 'version-3',
            LastModified: new Date('2024-03-01'),
            Size: 2048,
            IsLatest: true
          },
          {
            Key: 'atlantis/templates/v2/storage/test-template.yml',
            VersionId: 'version-2',
            LastModified: new Date('2024-02-01'),
            Size: 1536,
            IsLatest: false
          },
          {
            Key: 'atlantis/templates/v2/storage/test-template.yml',
            VersionId: 'version-1',
            LastModified: new Date('2024-01-01'),
            Size: 1024,
            IsLatest: false
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template'
        }
      };

      const result = await S3TemplatesDAO.listVersions(connection);
      
      expect(result.versions).toBeDefined();
      expect(result.versions.length).toBe(3);
      expect(result.versions[0].versionId).toBe('version-3');
      expect(result.versions[0].isLatest).toBe(true);
    });
  });

  describe('15.6.5 Test OR condition for version and versionId', () => {
    it('should return template when version matches (versionId does not)', async () => {
      const templateContent = `# Version: v1.2.3/2024-01-15
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'different-version-id',
        LastModified: new Date('2024-01-15'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v1.2.3/2024-01-15',
          versionId: 'requested-version-id'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      // Should return template because version matches (OR condition)
      expect(result).toBeDefined();
      expect(result.version).toBe('v1.2.3/2024-01-15');
    });

    it('should return template when versionId matches (version does not)', async () => {
      const templateContent = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/storage/test-template.yml',
        VersionId: 'matching-version-id'
      }).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'matching-version-id',
        LastModified: new Date('2024-01-01'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v2.0.0/2024-02-01',
          versionId: 'matching-version-id'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      // Should return template because versionId matches (OR condition)
      expect(result).toBeDefined();
      expect(result.versionId).toBe('matching-version-id');
    });

    it('should return template when both version and versionId match', async () => {
      const templateContent = `# Version: v1.2.3/2024-01-15
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/templates/v2/storage/test-template.yml',
        VersionId: 'matching-version-id'
      }).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'matching-version-id',
        LastModified: new Date('2024-01-15'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v1.2.3/2024-01-15',
          versionId: 'matching-version-id'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.version).toBe('v1.2.3/2024-01-15');
      expect(result.versionId).toBe('matching-version-id');
    });

    it('should return null when neither version nor versionId match', async () => {
      const templateContent = `# Version: v1.0.0/2024-01-01
AWSTemplateFormatVersion: '2010-09-09'
Description: Test template`;

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Buffer.from(templateContent),
        VersionId: 'different-version-id',
        LastModified: new Date('2024-01-01'),
        ContentLength: templateContent.length
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: {
          category: 'storage',
          templateName: 'test-template',
          version: 'v2.0.0/2024-02-01',
          versionId: 'requested-version-id'
        }
      };

      const result = await S3TemplatesDAO.get(connection);
      
      expect(result).toBeNull();
    });
  });

  describe('15.6.6 Test sidecar metadata retrieval', () => {
    it('should retrieve sidecar metadata for app starter', async () => {
      const sidecarMetadata = {
        name: 'test-starter',
        description: 'Test application starter',
        language: 'Node.js',
        framework: 'Express',
        features: ['cache-data', 'CloudFront'],
        prerequisites: ['Node.js 20+', 'AWS Account'],
        author: '63Klabs',
        license: 'MIT',
        githubUrl: 'https://github.com/63klabs/test-starter'
      };

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      // Mock ZIP file exists
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/test-starter.zip'
      }).resolves({
        Body: Buffer.from('mock-zip-content'),
        ContentLength: 1024
      });

      // Mock sidecar metadata exists
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/test-starter.json'
      }).resolves({
        Body: Buffer.from(JSON.stringify(sidecarMetadata)),
        ContentLength: JSON.stringify(sidecarMetadata).length
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'test-starter'
        }
      };

      const result = await S3StartersDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.name).toBe('test-starter');
      expect(result.description).toBe('Test application starter');
      expect(result.language).toBe('Node.js');
      expect(result.framework).toBe('Express');
      expect(result.features).toContain('cache-data');
      expect(result.features).toContain('CloudFront');
    });

    it('should include all metadata fields from sidecar', async () => {
      const sidecarMetadata = {
        name: 'full-metadata-starter',
        description: 'Starter with complete metadata',
        language: 'Python',
        framework: 'FastAPI',
        features: ['DynamoDB', 'S3', 'EventBridge'],
        prerequisites: ['Python 3.11+', 'AWS CLI'],
        author: '63Klabs Team',
        license: 'Apache-2.0',
        githubUrl: 'https://github.com/63klabs/full-metadata-starter',
        version: '1.0.0',
        lastUpdated: '2024-01-15'
      };

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/full-metadata-starter.json'
      }).resolves({
        Body: Buffer.from(JSON.stringify(sidecarMetadata)),
        ContentLength: JSON.stringify(sidecarMetadata).length
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'full-metadata-starter'
        }
      };

      const result = await S3StartersDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.name).toBe('full-metadata-starter');
      expect(result.author).toBe('63Klabs Team');
      expect(result.license).toBe('Apache-2.0');
      expect(result.version).toBe('1.0.0');
      expect(result.lastUpdated).toBe('2024-01-15');
    });

    it('should verify ZIP file name matches GitHub repository name', async () => {
      const sidecarMetadata = {
        name: 'repo-name-match',
        description: 'Test repository name matching',
        language: 'Node.js',
        githubUrl: 'https://github.com/63klabs/repo-name-match'
      };

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/repo-name-match.json'
      }).resolves({
        Body: Buffer.from(JSON.stringify(sidecarMetadata)),
        ContentLength: JSON.stringify(sidecarMetadata).length
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'repo-name-match'
        }
      };

      const result = await S3StartersDAO.get(connection);
      
      expect(result).toBeDefined();
      expect(result.name).toBe('repo-name-match');
      // ZIP file name should match repository name from GitHub URL
      expect(result.githubUrl).toContain('repo-name-match');
    });
  });

  describe('15.6.7 Test starter exclusion when sidecar metadata missing', () => {
    it('should skip starter when sidecar metadata file is missing', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      // ZIP file exists
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'atlantis/app-starters/v2/no-metadata-starter.zip', LastModified: new Date(), Size: 2048 }
        ]
      });

      // Sidecar metadata does not exist
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/no-metadata-starter.json'
      }).rejects({ name: 'NoSuchKey', message: 'The specified key does not exist.' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3StartersDAO.list(connection);
      
      // Should not include starter without sidecar metadata
      expect(result.starters).toBeDefined();
      expect(result.starters.find(s => s.name === 'no-metadata-starter')).toBeUndefined();
    });

    it('should log warning when starter is skipped due to missing metadata', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'atlantis/app-starters/v2/missing-metadata.zip', LastModified: new Date(), Size: 2048 }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/missing-metadata.json'
      }).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      await S3StartersDAO.list(connection);
      
      // Should log warning about missing sidecar metadata
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing-metadata')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should include starters with valid metadata and skip those without', async () => {
      const validMetadata = {
        name: 'valid-starter',
        description: 'Valid starter with metadata',
        language: 'Node.js'
      };

      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'atlantis/app-starters/v2/valid-starter.zip', LastModified: new Date(), Size: 2048 },
          { Key: 'atlantis/app-starters/v2/invalid-starter.zip', LastModified: new Date(), Size: 2048 }
        ]
      });

      // Valid starter has metadata
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/valid-starter.json'
      }).resolves({
        Body: Buffer.from(JSON.stringify(validMetadata)),
        ContentLength: JSON.stringify(validMetadata).length
      });

      // Invalid starter missing metadata
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/invalid-starter.json'
      }).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3StartersDAO.list(connection);
      
      expect(result.starters).toBeDefined();
      expect(result.starters.find(s => s.name === 'valid-starter')).toBeDefined();
      expect(result.starters.find(s => s.name === 'invalid-starter')).toBeUndefined();
    });

    it('should return null when getting starter without sidecar metadata', async () => {
      s3Mock.on(GetBucketTaggingCommand).resolves({
        TagSet: [
          { Key: 'atlantis-mcp:Allow', Value: 'true' },
          { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
        ]
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/no-metadata.json'
      }).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'no-metadata'
        }
      };

      const result = await S3StartersDAO.get(connection);
      
      expect(result).toBeNull();
    });
  });
});
