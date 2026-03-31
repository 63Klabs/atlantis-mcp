/**
 * Unit tests for Version Resolver Service
 *
 * Tests Version Resolver format detection and resolution:
 * - detectFormat classifies Human_Readable_Version, Short_Version, and S3_VersionId
 * - resolve passes through Human_Readable_Version without calling listVersions
 * - resolve resolves Short_Version when match exists in version history
 * - resolve returns original Short_Version when no match exists
 * - resolve resolves S3_VersionId when match exists
 * - resolve throws VERSION_RESOLUTION_FAILED when S3_VersionId has no match
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
 */

// Mock services before requiring version-resolver
jest.mock('../../../services', () => ({
  Templates: {
    listVersions: jest.fn()
  }
}));

const {
  detectFormat,
  resolve,
  HUMAN_READABLE_VERSION,
  SHORT_VERSION,
  S3_VERSION_ID
} = require('../../../services/version-resolver');

const Services = require('../../../services');

describe('Version Resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectFormat', () => {
    it('should return HUMAN_READABLE_VERSION for v1.3.4/2024-01-10', () => {
      expect(detectFormat('v1.3.4/2024-01-10')).toBe(HUMAN_READABLE_VERSION);
    });

    it('should return SHORT_VERSION for v1.3.4', () => {
      expect(detectFormat('v1.3.4')).toBe(SHORT_VERSION);
    });

    it('should return S3_VERSION_ID for S3 version id strings', () => {
      expect(detectFormat('3sL4kqtJlcpXroDTDmJ.xUZJFfMREQ.m')).toBe(S3_VERSION_ID);
    });

    it('should return S3_VERSION_ID for random strings like abc123', () => {
      expect(detectFormat('abc123')).toBe(S3_VERSION_ID);
    });
  });

  describe('resolve', () => {
    const templateInfo = {
      category: 'storage',
      templateName: 'template-storage-s3-artifacts',
      s3Buckets: ['my-bucket'],
      namespace: 'default'
    };

    const mockVersionHistory = {
      templateName: 'template-storage-s3-artifacts',
      category: 'storage',
      versions: [
        { versionId: 'abc123', version: 'v1.3.4/2024-01-10', lastModified: new Date(), size: 4096, isLatest: false },
        { versionId: 'def456', version: 'v1.3.5/2024-01-15', lastModified: new Date(), size: 4096, isLatest: true }
      ]
    };

    it('should pass through Human_Readable_Version without calling listVersions', async () => {
      const result = await resolve('v1.3.4/2024-01-10', templateInfo);

      expect(result).toBe('v1.3.4/2024-01-10');
      expect(Services.Templates.listVersions).not.toHaveBeenCalled();
    });

    it('should resolve Short_Version when match exists in version history', async () => {
      Services.Templates.listVersions.mockResolvedValue(mockVersionHistory);

      const result = await resolve('v1.3.4', templateInfo);

      expect(result).toBe('v1.3.4/2024-01-10');
      expect(Services.Templates.listVersions).toHaveBeenCalledWith({
        category: 'storage',
        templateName: 'template-storage-s3-artifacts',
        s3Buckets: ['my-bucket'],
        namespace: 'default'
      });
    });

    it('should return original Short_Version when no match exists', async () => {
      Services.Templates.listVersions.mockResolvedValue(mockVersionHistory);

      const result = await resolve('v9.9.9', templateInfo);

      expect(result).toBe('v9.9.9');
    });

    it('should resolve S3_VersionId when match exists', async () => {
      Services.Templates.listVersions.mockResolvedValue(mockVersionHistory);

      const result = await resolve('def456', templateInfo);

      expect(result).toBe('v1.3.5/2024-01-15');
    });

    it('should throw VERSION_RESOLUTION_FAILED error when S3_VersionId has no match', async () => {
      Services.Templates.listVersions.mockResolvedValue(mockVersionHistory);

      await expect(resolve('nonexistent-id', templateInfo))
        .rejects
        .toThrow('Could not resolve version identifier to a known version');

      try {
        await resolve('nonexistent-id', templateInfo);
      } catch (error) {
        expect(error.code).toBe('VERSION_RESOLUTION_FAILED');
      }
    });
  });
});
