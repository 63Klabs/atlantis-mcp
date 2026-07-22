/**
 * Unit Tests for findModuleTemplateKey() and modules-aware get()/listVersions()
 *
 * Feature: modules-nested-directory-support
 *
 * Tests the new findModuleTemplateKey() function that searches for module
 * templates across subdirectories by listing objects with a prefix and
 * filtering by template name.
 *
 * Requirements: 2.1, 3.1
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

const { findModuleTemplateKey } = require('../../../models/s3-templates');

describe('findModuleTemplateKey()', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  it('should find template in subdirectory and return correct subcategory', async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: [
        {
          Key: '63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml',
          LastModified: new Date('2024-01-01'),
          Size: 4096
        },
        {
          Key: '63klabs/templates/v2/modules/iam/module-iam-roles.yml',
          LastModified: new Date('2024-01-02'),
          Size: 2048
        }
      ]
    });

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-vpc-endpoints'
    );

    expect(result).not.toBeNull();
    expect(result.key).toBe('63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml');
    expect(result.subcategory).toBe('vpc');
    expect(result.extension).toBe('.yml');
  });

  it('should return null when template not found', async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: [
        {
          Key: '63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml',
          LastModified: new Date('2024-01-01'),
          Size: 4096
        }
      ]
    });

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'nonexistent-template'
    );

    expect(result).toBeNull();
  });

  it('should prefer .yml over .yaml when both exist', async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: [
        {
          Key: '63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yaml',
          LastModified: new Date('2024-01-01'),
          Size: 4096
        },
        {
          Key: '63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml',
          LastModified: new Date('2024-01-02'),
          Size: 2048
        }
      ]
    });

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-vpc-endpoints'
    );

    expect(result).not.toBeNull();
    expect(result.extension).toBe('.yml');
    expect(result.key).toBe('63klabs/templates/v2/modules/vpc/module-vpc-endpoints.yml');
  });

  it('should fall back to .yaml when .yml does not exist', async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: [
        {
          Key: '63klabs/templates/v2/modules/logging/module-cloudwatch.yaml',
          LastModified: new Date('2024-01-01'),
          Size: 3072
        }
      ]
    });

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-cloudwatch'
    );

    expect(result).not.toBeNull();
    expect(result.extension).toBe('.yaml');
    expect(result.subcategory).toBe('logging');
    expect(result.key).toBe('63klabs/templates/v2/modules/logging/module-cloudwatch.yaml');
  });

  it('should return null when S3 listing returns empty contents', async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: []
    });

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-vpc-endpoints'
    );

    expect(result).toBeNull();
  });

  it('should return null when S3 listing returns no Contents property', async () => {
    mockS3Send.mockResolvedValueOnce({});

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-vpc-endpoints'
    );

    expect(result).toBeNull();
  });

  it('should return null and log error on S3 failure', async () => {
    const ErrorHandler = require('../../../utils/error-handler');
    mockS3Send.mockRejectedValueOnce(new Error('Access Denied'));

    const result = await findModuleTemplateKey(
      'test-bucket',
      '63klabs',
      'templates/v2',
      'module-vpc-endpoints'
    );

    expect(result).toBeNull();
    expect(ErrorHandler.logS3Error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'ListObjectsV2',
        bucket: 'test-bucket'
      })
    );
  });

  it('should issue ListObjectsV2Command with correct prefix', async () => {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

    mockS3Send.mockResolvedValueOnce({ Contents: [] });

    await findModuleTemplateKey(
      'my-bucket',
      'myns',
      'templates/v2',
      'some-template'
    );

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    // Verify the command was called with the correct prefix
    const callArg = mockS3Send.mock.calls[0][0];
    expect(callArg.input).toEqual({
      Bucket: 'my-bucket',
      Prefix: 'myns/templates/v2/modules/'
    });
  });
});
