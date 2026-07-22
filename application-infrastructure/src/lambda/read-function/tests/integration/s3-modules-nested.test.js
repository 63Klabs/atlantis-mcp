/**
 * S3 Modules Nested Directory Integration Tests
 *
 * Tests the complete template discovery pipeline for nested module templates
 * organized in subdirectories: modules/{subcategory}/{templateName}.yml
 *
 * These tests exercise the model layer (s3-templates.js) with mocked S3
 * responses containing both flat and nested templates, verifying that:
 * - list() discovers templates from nested subdirectories
 * - get() retrieves module templates from subdirectories
 * - listVersions() works for module templates
 * - parseTemplateMetadata() correctly handles nested paths
 * - deduplicateTemplates() distinguishes subcategories
 * - Backward compatibility for flat category operations is preserved
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 5.1, 5.2, 7.1, 7.2, 7.3, 7.4
 */

// Mock @63klabs/cache-data AWS.s3.client before requiring the model
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

jest.mock('../../utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

const S3TemplatesDAO = require('../../models/s3-templates');

/**
 * Inline helper that mirrors extractSubcategories() from services/templates.js.
 * We avoid importing the service layer directly because it pulls in
 * CacheableDataAccess and Config which require additional mocking.
 *
 * @param {Array<Object>} templates - Template metadata objects
 * @returns {Array<string>} Sorted unique subcategory names
 */
function extractSubcategories(templates) {
  const subcategorySet = new Set();
  for (const template of templates) {
    if (template.subcategory) {
      subcategorySet.add(template.subcategory);
    }
  }
  return Array.from(subcategorySet).sort();
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BUCKET = 'test-bucket';
const NAMESPACE = 'atlantis';
const BASE_PATH = 'templates/v2';

/**
 * Template content helper — produces minimal valid CloudFormation YAML
 * with an embedded Human_Readable_Version comment.
 */
function cfnContent(version = 'v1.0.0/2024-01-15', description = 'Test template') {
  return [
    `# Version: ${version}`,
    "AWSTemplateFormatVersion: '2010-09-09'",
    `Description: ${description}`,
    'Parameters:',
    '  Param1:',
    '    Type: String',
    'Outputs:',
    '  Out1:',
    '    Value: test'
  ].join('\n');
}

/** S3 object stub used in ListObjectsV2 responses */
function s3Object(key, lastModified = '2024-06-01', size = 2048) {
  return {
    Key: key,
    LastModified: new Date(lastModified),
    Size: size
  };
}

/**
 * Build a standard connection object for the model layer.
 *
 * When namespace is provided (the default), the model skips
 * getIndexedNamespaces() and uses [namespace] directly — so no
 * ListObjectsV2 call for namespace discovery is needed.
 */
function buildConnection(params = {}) {
  return {
    host: params.buckets || BUCKET,
    path: BASE_PATH,
    parameters: {
      category: params.category,
      templateName: params.templateName,
      version: params.version,
      versionId: params.versionId,
      namespace: params.namespace || NAMESPACE
    }
  };
}

// ---------------------------------------------------------------------------
// Fixtures: S3 objects representing a realistic bucket layout
// ---------------------------------------------------------------------------

/** Flat-category templates */
const FLAT_OBJECTS = [
  s3Object(`${NAMESPACE}/${BASE_PATH}/storage/template-storage-s3.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/storage/template-storage-dynamo.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/network/template-network-cloudfront.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/pipeline/template-pipeline-cicd.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/service-role/template-service-role-lambda.yml`)
];

/** Nested module templates in subdirectories */
const NESTED_MODULE_OBJECTS = [
  s3Object(`${NAMESPACE}/${BASE_PATH}/modules/vpc/module-vpc-endpoints.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/modules/vpc/module-vpc-flow-logs.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/modules/iam/module-iam-roles.yml`),
  s3Object(`${NAMESPACE}/${BASE_PATH}/modules/logging/module-cloudwatch-alarms.yml`)
];

/** All objects combined */
const ALL_OBJECTS = [...FLAT_OBJECTS, ...NESTED_MODULE_OBJECTS];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3 Modules Nested Directory Integration Tests', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // list_templates — modules category
  // Validates: Requirements 1.1, 1.2, 1.3, 1.4
  // =========================================================================
  describe('list_templates with category "modules"', () => {
    it('should return templates from nested subdirectories under modules', async () => {
      // With namespace provided, list() skips getIndexedNamespaces.
      // Only one S3 call: ListObjectsV2 for template listing.
      mockS3Send.mockResolvedValueOnce({
        Contents: NESTED_MODULE_OBJECTS
      });

      const connection = buildConnection({ category: 'modules' });
      const result = await S3TemplatesDAO.list(connection);

      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBe(4);

      // All templates should have category "modules"
      result.templates.forEach(t => {
        expect(t.category).toBe('modules');
      });

      // Verify subcategories are correctly extracted
      const subcategories = result.templates.map(t => t.subcategory);
      expect(subcategories).toContain('vpc');
      expect(subcategories).toContain('iam');
      expect(subcategories).toContain('logging');

      // Verify specific template metadata
      const vpcEndpoints = result.templates.find(t => t.name === 'module-vpc-endpoints');
      expect(vpcEndpoints).toBeDefined();
      expect(vpcEndpoints.subcategory).toBe('vpc');
      expect(vpcEndpoints.category).toBe('modules');
      expect(vpcEndpoints.namespace).toBe(NAMESPACE);
      expect(vpcEndpoints.bucket).toBe(BUCKET);
    });
  });

  // =========================================================================
  // list_templates — no category filter
  // Validates: Requirements 1.2, 7.1
  // =========================================================================
  describe('list_templates without category filter', () => {
    it('should return both flat and nested templates', async () => {
      // Single ListObjectsV2 call returning all objects
      mockS3Send.mockResolvedValueOnce({
        Contents: ALL_OBJECTS
      });

      const connection = buildConnection({ category: undefined });
      const result = await S3TemplatesDAO.list(connection);

      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBe(ALL_OBJECTS.length);

      // Flat templates should have subcategory null
      const storageTemplate = result.templates.find(t => t.name === 'template-storage-s3');
      expect(storageTemplate).toBeDefined();
      expect(storageTemplate.category).toBe('storage');
      expect(storageTemplate.subcategory).toBeNull();

      // Nested templates should have subcategory set
      const moduleTemplate = result.templates.find(t => t.name === 'module-vpc-endpoints');
      expect(moduleTemplate).toBeDefined();
      expect(moduleTemplate.category).toBe('modules');
      expect(moduleTemplate.subcategory).toBe('vpc');
    });
  });

  // =========================================================================
  // get_template — module template in subdirectory
  // Validates: Requirements 2.1, 2.2
  // =========================================================================
  describe('get_template for a module template in a subdirectory', () => {
    it('should return correct metadata including subcategory', async () => {
      const templateContent = cfnContent('v1.2.0/2024-06-01', 'VPC Endpoints module');

      // Call 1: findModuleTemplateKey — ListObjectsV2 for modules/ prefix
      mockS3Send.mockResolvedValueOnce({
        Contents: NESTED_MODULE_OBJECTS
      });
      // Call 2: GetObject for the discovered key
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => templateContent },
        VersionId: 'ver-abc-123',
        LastModified: new Date('2024-06-01'),
        ContentLength: templateContent.length
      });

      const connection = buildConnection({
        category: 'modules',
        templateName: 'module-vpc-endpoints'
      });
      const result = await S3TemplatesDAO.get(connection);

      expect(result).not.toBeNull();
      expect(result.name).toBe('module-vpc-endpoints');
      expect(result.category).toBe('modules');
      expect(result.subcategory).toBe('vpc');
      expect(result.version).toBe('v1.2.0/2024-06-01');
      expect(result.versionId).toBe('ver-abc-123');
      expect(result.description).toBe('VPC Endpoints module');
      expect(result.namespace).toBe(NAMESPACE);
      expect(result.bucket).toBe(BUCKET);
      expect(result.s3Path).toContain('modules/vpc/module-vpc-endpoints.yml');
    });

    it('should return null when module template is not found in any subdirectory', async () => {
      // findModuleTemplateKey — empty listing
      mockS3Send.mockResolvedValueOnce({
        Contents: []
      });

      const connection = buildConnection({
        category: 'modules',
        templateName: 'nonexistent-module'
      });
      const result = await S3TemplatesDAO.get(connection);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // list_template_versions — module template
  // Validates: Requirements 3.1
  // =========================================================================
  describe('list_template_versions for a module template', () => {
    it('should return version history for a nested module template', async () => {
      const v1Content = cfnContent('v1.0.0/2024-01-15', 'IAM Roles module v1');
      const v2Content = cfnContent('v2.0.0/2024-06-01', 'IAM Roles module v2');

      // Call 1: findModuleTemplateKey — ListObjectsV2 for modules/ prefix
      mockS3Send.mockResolvedValueOnce({
        Contents: NESTED_MODULE_OBJECTS
      });
      // Call 2: ListObjectVersions for the discovered key
      mockS3Send.mockResolvedValueOnce({
        Versions: [
          {
            Key: `${NAMESPACE}/${BASE_PATH}/modules/iam/module-iam-roles.yml`,
            VersionId: 'ver-2',
            LastModified: new Date('2024-06-01'),
            Size: 3072,
            IsLatest: true
          },
          {
            Key: `${NAMESPACE}/${BASE_PATH}/modules/iam/module-iam-roles.yml`,
            VersionId: 'ver-1',
            LastModified: new Date('2024-01-15'),
            Size: 2048,
            IsLatest: false
          }
        ]
      });
      // Calls 3-4: GetObject for each version (to extract Human_Readable_Version)
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => v2Content },
        VersionId: 'ver-2'
      });
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => v1Content },
        VersionId: 'ver-1'
      });

      const connection = buildConnection({
        category: 'modules',
        templateName: 'module-iam-roles'
      });
      const result = await S3TemplatesDAO.listVersions(connection);

      expect(result).toBeDefined();
      expect(result.templateName).toBe('module-iam-roles');
      expect(result.category).toBe('modules');
      expect(result.versions).toBeDefined();
      expect(result.versions.length).toBe(2);

      // Versions should be sorted newest first
      expect(result.versions[0].versionId).toBe('ver-2');
      expect(result.versions[0].version).toBe('v2.0.0/2024-06-01');
      expect(result.versions[0].isLatest).toBe(true);

      expect(result.versions[1].versionId).toBe('ver-1');
      expect(result.versions[1].version).toBe('v1.0.0/2024-01-15');
      expect(result.versions[1].isLatest).toBe(false);
    });
  });

  // =========================================================================
  // list_categories — subcategories for modules
  // Validates: Requirements 5.1, 5.2
  // =========================================================================
  describe('list_categories returns subcategories for modules', () => {
    it('should extract unique subcategories from module templates', () => {
      const templates = [
        { name: 'module-vpc-endpoints', category: 'modules', subcategory: 'vpc' },
        { name: 'module-vpc-flow-logs', category: 'modules', subcategory: 'vpc' },
        { name: 'module-iam-roles', category: 'modules', subcategory: 'iam' },
        { name: 'module-cloudwatch-alarms', category: 'modules', subcategory: 'logging' },
        { name: 'template-storage-s3', category: 'storage', subcategory: null }
      ];

      const subcategories = extractSubcategories(templates);

      expect(subcategories).toEqual(['iam', 'logging', 'vpc']);
    });

    it('should return empty array when no templates have subcategories', () => {
      const templates = [
        { name: 'template-storage-s3', category: 'storage', subcategory: null },
        { name: 'template-network-cf', category: 'network', subcategory: null }
      ];

      const subcategories = extractSubcategories(templates);

      expect(subcategories).toEqual([]);
    });
  });

  // =========================================================================
  // Backward compatibility — flat category operations unchanged
  // Validates: Requirements 7.1, 7.2, 7.3, 7.4
  // =========================================================================
  describe('backward compatibility — flat category operations', () => {
    it('list() for a flat category returns templates with subcategory null', async () => {
      // Single ListObjectsV2 call returning all objects (filter applied by model)
      mockS3Send.mockResolvedValueOnce({
        Contents: ALL_OBJECTS
      });

      const connection = buildConnection({ category: 'storage' });
      const result = await S3TemplatesDAO.list(connection);

      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBe(2); // two storage templates

      result.templates.forEach(t => {
        expect(t.category).toBe('storage');
        expect(t.subcategory).toBeNull();
      });
    });

    it('get() for a flat category template uses buildTemplateKey path', async () => {
      const templateContent = cfnContent('v1.0.0/2024-01-15', 'S3 storage template');

      // Call 1: GetObject for the flat key (.yml extension tried first)
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => templateContent },
        VersionId: 'flat-ver-1',
        LastModified: new Date('2024-01-15'),
        ContentLength: templateContent.length
      });

      const connection = buildConnection({
        category: 'storage',
        templateName: 'template-storage-s3'
      });
      const result = await S3TemplatesDAO.get(connection);

      expect(result).not.toBeNull();
      expect(result.name).toBe('template-storage-s3');
      expect(result.category).toBe('storage');
      // Flat templates should not have subcategory property set
      expect(result.subcategory).toBeUndefined();
      expect(result.version).toBe('v1.0.0/2024-01-15');
      expect(result.s3Path).toContain('storage/template-storage-s3');
    });

    it('listVersions() for a flat category template works correctly', async () => {
      const templateContent = cfnContent('v1.0.0/2024-01-15', 'Pipeline template');

      // Call 1: ListObjectVersions for the flat key (.yml tried first)
      mockS3Send.mockResolvedValueOnce({
        Versions: [
          {
            Key: `${NAMESPACE}/${BASE_PATH}/pipeline/template-pipeline-cicd.yml`,
            VersionId: 'pipe-ver-1',
            LastModified: new Date('2024-01-15'),
            Size: 1024,
            IsLatest: true
          }
        ]
      });
      // Call 2: GetObject for version content
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => templateContent },
        VersionId: 'pipe-ver-1'
      });

      const connection = buildConnection({
        category: 'pipeline',
        templateName: 'template-pipeline-cicd'
      });
      const result = await S3TemplatesDAO.listVersions(connection);

      expect(result).toBeDefined();
      expect(result.templateName).toBe('template-pipeline-cicd');
      expect(result.category).toBe('pipeline');
      expect(result.versions.length).toBe(1);
      expect(result.versions[0].version).toBe('v1.0.0/2024-01-15');
    });

    it('buildTemplateKey() produces correct flat key', () => {
      const key = S3TemplatesDAO.buildTemplateKey(
        NAMESPACE,
        BASE_PATH,
        'storage',
        'template-storage-s3',
        '.yml'
      );

      expect(key).toBe(`${NAMESPACE}/${BASE_PATH}/storage/template-storage-s3.yml`);
    });
  });

  // =========================================================================
  // parseTemplateMetadata — nested vs flat
  // Validates: Requirements 1.3, 1.4, 7.2
  // =========================================================================
  describe('parseTemplateMetadata integration', () => {
    it('should parse nested module template metadata correctly', () => {
      const s3Obj = s3Object(`${NAMESPACE}/${BASE_PATH}/modules/vpc/module-vpc-endpoints.yml`);
      const metadata = S3TemplatesDAO.parseTemplateMetadata(s3Obj, BUCKET, NAMESPACE);

      expect(metadata.name).toBe('module-vpc-endpoints');
      expect(metadata.category).toBe('modules');
      expect(metadata.subcategory).toBe('vpc');
      expect(metadata.namespace).toBe(NAMESPACE);
      expect(metadata.bucket).toBe(BUCKET);
      expect(metadata.s3Path).toBe(
        `s3://${BUCKET}/${NAMESPACE}/${BASE_PATH}/modules/vpc/module-vpc-endpoints.yml`
      );
    });

    it('should parse flat template metadata with subcategory null', () => {
      const s3Obj = s3Object(`${NAMESPACE}/${BASE_PATH}/storage/template-storage-s3.yml`);
      const metadata = S3TemplatesDAO.parseTemplateMetadata(s3Obj, BUCKET, NAMESPACE);

      expect(metadata.name).toBe('template-storage-s3');
      expect(metadata.category).toBe('storage');
      expect(metadata.subcategory).toBeNull();
      expect(metadata.namespace).toBe(NAMESPACE);
    });
  });

  // =========================================================================
  // deduplicateTemplates — subcategory awareness
  // Validates: Requirements 1.1, 1.2
  // =========================================================================
  describe('deduplicateTemplates with subcategories', () => {
    it('should keep templates with same name but different subcategories', () => {
      const templates = [
        { name: 'module-common', category: 'modules', subcategory: 'vpc', bucket: 'b1' },
        { name: 'module-common', category: 'modules', subcategory: 'iam', bucket: 'b2' }
      ];

      const result = S3TemplatesDAO.deduplicateTemplates(templates);

      expect(result.length).toBe(2);
    });

    it('should deduplicate templates with same name and same subcategory', () => {
      const templates = [
        { name: 'module-vpc-endpoints', category: 'modules', subcategory: 'vpc', bucket: 'b1' },
        { name: 'module-vpc-endpoints', category: 'modules', subcategory: 'vpc', bucket: 'b2' }
      ];

      const result = S3TemplatesDAO.deduplicateTemplates(templates);

      expect(result.length).toBe(1);
      expect(result[0].bucket).toBe('b1'); // first occurrence wins
    });

    it('should deduplicate flat templates normally', () => {
      const templates = [
        { name: 'template-storage-s3', category: 'storage', subcategory: null, bucket: 'b1' },
        { name: 'template-storage-s3', category: 'storage', subcategory: null, bucket: 'b2' }
      ];

      const result = S3TemplatesDAO.deduplicateTemplates(templates);

      expect(result.length).toBe(1);
    });

    it('should handle mixed flat and nested templates', () => {
      const templates = [
        { name: 'template-storage-s3', category: 'storage', subcategory: null, bucket: 'b1' },
        { name: 'module-vpc-endpoints', category: 'modules', subcategory: 'vpc', bucket: 'b1' },
        { name: 'module-iam-roles', category: 'modules', subcategory: 'iam', bucket: 'b1' },
        { name: 'template-storage-s3', category: 'storage', subcategory: null, bucket: 'b2' },
        { name: 'module-vpc-endpoints', category: 'modules', subcategory: 'vpc', bucket: 'b2' }
      ];

      const result = S3TemplatesDAO.deduplicateTemplates(templates);

      expect(result.length).toBe(3);
    });
  });
});
