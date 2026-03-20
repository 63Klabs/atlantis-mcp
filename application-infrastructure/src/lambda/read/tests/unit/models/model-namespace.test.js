/**
 * Unit Tests for Model Layer Namespace Filtering
 *
 * Feature: add-namespace-filter-to-list-templates
 * Tests specific examples and edge cases for namespace filtering
 * in the S3 templates model layer.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

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

jest.mock('../../../utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

const S3Templates = require('../../../models/s3-templates');

describe('Model Layer Namespace Filtering', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  /* ---------------------------------------------------------------- */
  /*  list() namespace filtering                                       */
  /* ---------------------------------------------------------------- */

  describe('list() with namespace', () => {

    it('should use [namespace] directly when namespace is provided', async () => {
      // Only mock for template listing — no namespace discovery call expected
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'acme/templates/v2/storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { namespace: 'acme' }
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].namespace).toBe('acme');
      expect(result.templates[0].name).toBe('template-s3');

      // Verify no namespace discovery call (no Delimiter: '/')
      const calls = mockS3Send.mock.calls;
      const discoveryCall = calls.find(c => {
        const input = c[0]?.input || {};
        return input.Delimiter === '/' && !input.Prefix;
      });
      expect(discoveryCall).toBeUndefined();
    });

    it('should call getIndexedNamespaces when namespace is omitted', async () => {
      // First call: namespace discovery
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }, { Prefix: 'acme/' }]
      });
      // Second call: template listing for atlantis
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/templates/v2/storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          }
        ]
      });
      // Third call: template listing for acme
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'acme/templates/v2/network/template-vpc.yml',
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

      // First call should be namespace discovery
      const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(firstCallInput.Delimiter).toBe('/');
    });

    it('should search only specified namespace prefix', async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'turbo-kiln/templates/v2/storage/template-s3.yml',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          }
        ]
      });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { namespace: 'turbo-kiln' }
      };

      const result = await S3Templates.list(connection, {});

      // Verify the S3 prefix used the provided namespace
      const callInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(callInput.Prefix).toBe('turbo-kiln/templates/v2/');
    });

    it('should return empty templates for non-existent namespace', async () => {
      mockS3Send.mockResolvedValueOnce({ Contents: [] });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { namespace: 'nonexistent' }
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toEqual([]);
      expect(result.partialData).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  get() namespace filtering                                        */
  /* ---------------------------------------------------------------- */

  describe('get() with namespace', () => {

    it('should search only specified namespace when provided', async () => {
      // NoSuchKey for .yml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
      // NoSuchKey for .yaml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl', namespace: 'acme' }
      };

      await S3Templates.get(connection, {});

      // Verify calls used the provided namespace, not discovery
      const calls = mockS3Send.mock.calls;
      expect(calls).toHaveLength(2); // .yml and .yaml attempts only

      // Both calls should target acme namespace
      for (const call of calls) {
        const input = call[0]?.input || {};
        expect(input.Key).toMatch(/^acme\//);
      }
    });

    it('should call getIndexedNamespaces when namespace is omitted', async () => {
      // Namespace discovery
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // NoSuchKey for .yml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
      // NoSuchKey for .yaml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl' }
      };

      await S3Templates.get(connection, {});

      const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(firstCallInput.Delimiter).toBe('/');
    });

    it('should return null for non-existent namespace', async () => {
      mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl', namespace: 'nonexistent' }
      };

      const result = await S3Templates.get(connection, {});

      expect(result).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  listVersions() namespace filtering                               */
  /* ---------------------------------------------------------------- */

  describe('listVersions() with namespace', () => {

    it('should search only specified namespace when provided', async () => {
      // NoSuchKey for .yml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
      // NoSuchKey for .yaml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl', namespace: 'acme' }
      };

      await S3Templates.listVersions(connection, {});

      const calls = mockS3Send.mock.calls;
      expect(calls).toHaveLength(2); // .yml and .yaml attempts

      for (const call of calls) {
        const input = call[0]?.input || {};
        expect(input.Prefix).toMatch(/^acme\//);
      }
    });

    it('should call getIndexedNamespaces when namespace is omitted', async () => {
      // Namespace discovery
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // NoSuchKey for .yml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
      // NoSuchKey for .yaml
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl' }
      };

      await S3Templates.listVersions(connection, {});

      const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(firstCallInput.Delimiter).toBe('/');
    });

    it('should return empty versions for non-existent namespace', async () => {
      mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'templates/v2',
        parameters: { category: 'storage', templateName: 'tpl', namespace: 'nonexistent' }
      };

      const result = await S3Templates.listVersions(connection, {});

      expect(result.versions).toEqual([]);
      expect(result.templateName).toBe('tpl');
      expect(result.category).toBe('storage');
    });
  });
});
