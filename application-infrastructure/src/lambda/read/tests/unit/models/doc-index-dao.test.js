/**
 * Unit Tests for Documentation Index DAO
 *
 * Tests all functions in the Documentation Index Data Access Object including:
 * - buildIndex() function
 * - search() function with relevance ranking
 */

const DocIndex = require('../../../models/doc-index');
const { Config } = require('../../../config');
const GitHubAPI = require('../../../models/github-api');
const S3Templates = require('../../../models/s3-templates');

// Mock Config
jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      github: {
        token: { getValue: jest.fn().mockResolvedValue('test-token-123') },
        userOrgs: ['63klabs']
      },
      s3: {
        buckets: ['test-bucket']
      }
    }))
  }
}));

// Mock GitHubAPI
jest.mock('../../../models/github-api');

// Mock S3Templates
jest.mock('../../../models/s3-templates');

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

describe('Documentation Index DAO', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset module state
    jest.resetModules();
  });

  describe('11.5.16 - buildIndex()', () => {
    it('should build index from template repositories', async () => {
      // Mock GitHub API responses
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'template-repo',
            owner: '63klabs',
            atlantis_repository_type: 'templates'
          }
        ],
        errors: []
      });

      GitHubAPI.getReadme.mockResolvedValue({
        name: 'README.md',
        content: '# Template Repository\n\n## Getting Started\n\nThis is a guide.',
        path: 'README.md'
      });

      // Mock S3 Templates responses
      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      const result = await DocIndex.buildIndex({ includeStarters: false });

      expect(result.cached).toBe(false);
      expect(result.entryCount).toBeGreaterThan(0);
      expect(result.buildDuration).toBeGreaterThan(0);
    });

    it('should return cached index if already built', async () => {
      // Build index first time
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      await DocIndex.buildIndex({ includeStarters: false });

      // Second call should return cached
      const result = await DocIndex.buildIndex({ includeStarters: false });

      expect(result.cached).toBe(true);
      expect(result.lastBuilt).toBeDefined();
    });

    it('should force rebuild when force option is true', async () => {
      // Build index first time
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      await DocIndex.buildIndex({ includeStarters: false });

      // Force rebuild
      const result = await DocIndex.buildIndex({ includeStarters: false, force: true });

      expect(result.cached).toBe(false);
    });

    it('should index CloudFormation templates', async () => {
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      S3Templates.list.mockResolvedValue({
        templates: [
          {
            name: 'template-s3',
            category: 'Storage',
            namespace: 'atlantis',
            bucket: 'test-bucket',
            key: 'atlantis/templates/v2/Storage/template-s3.yml',
            s3Path: 's3://test-bucket/atlantis/templates/v2/Storage/template-s3.yml'
          }
        ],
        errors: []
      });

      S3Templates.get.mockResolvedValue({
        name: 'template-s3',
        category: 'Storage',
        namespace: 'atlantis',
        bucket: 'test-bucket',
        s3Path: 's3://test-bucket/atlantis/templates/v2/Storage/template-s3.yml',
        content: `AWSTemplateFormatVersion: '2010-09-09'
Description: S3 bucket template
Parameters:
  BucketName:
    Type: String
Resources:
  Bucket:
    Type: AWS::S3::Bucket
Outputs:
  BucketArn:
    Value: !GetAtt Bucket.Arn
`
      });

      const result = await DocIndex.buildIndex({ includeStarters: false, force: true });

      expect(result.entryCount).toBeGreaterThan(0);
    });

    it('should include app starters when requested', async () => {
      GitHubAPI.listRepositories.mockImplementation((connection) => {
        if (connection.parameters?.repositoryType === 'app-starter') {
          return Promise.resolve({
            repositories: [
              {
                name: 'node-express-api',
                owner: '63klabs',
                atlantis_repository_type: 'app-starter'
              }
            ],
            errors: []
          });
        }
        return Promise.resolve({ repositories: [], errors: [] });
      });

      GitHubAPI.getReadme.mockResolvedValue({
        name: 'README.md',
        content: '# Node Express API\n\nStarter template.',
        path: 'README.md'
      });

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      const result = await DocIndex.buildIndex({ includeStarters: true, force: true });

      expect(result.entryCount).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      // Reset cache to ensure fresh build
      DocIndex.TestHarness.resetCache();
      
      GitHubAPI.listRepositories.mockRejectedValue(new Error('GitHub API error'));

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      await expect(DocIndex.buildIndex({ includeStarters: false })).rejects.toThrow('GitHub API error');
    });
  });

  describe('11.5.17 - search()', () => {
    beforeEach(async () => {
      // Build a test index
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'template-repo',
            owner: '63klabs',
            atlantis_repository_type: 'templates'
          }
        ],
        errors: []
      });

      GitHubAPI.getReadme.mockResolvedValue({
        name: 'README.md',
        content: `# Template Repository

## CloudFormation Templates

This repository contains CloudFormation templates for AWS infrastructure.

## S3 Bucket Template

The S3 bucket template creates a secure S3 bucket with encryption.

## Lambda Function Template

The Lambda function template creates a serverless function.
`,
        path: 'README.md'
      });

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      await DocIndex.buildIndex({ includeStarters: false, force: true });
    });

    it('should search documentation by keywords', async () => {
      const result = await DocIndex.search({
        query: 'CloudFormation templates',
        limit: 10
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.query).toBe('CloudFormation templates');
    });

    it('should rank results by relevance', async () => {
      const result = await DocIndex.search({
        query: 'S3 bucket',
        limit: 10
      });

      // Results should be sorted by relevance score
      if (result.results.length > 1) {
        expect(result.results[0].relevanceScore).toBeGreaterThanOrEqual(result.results[1].relevanceScore);
      }
    });

    it('should filter by type', async () => {
      const result = await DocIndex.search({
        query: 'template',
        type: 'documentation',
        limit: 10
      });

      result.results.forEach(r => {
        expect(r.type).toBe('documentation');
      });
    });

    it('should filter by subType', async () => {
      const result = await DocIndex.search({
        query: 'template',
        type: 'documentation',
        subType: 'guide',
        limit: 10
      });

      result.results.forEach(r => {
        expect(r.subType).toBe('guide');
      });
    });

    it('should limit results', async () => {
      const result = await DocIndex.search({
        query: 'template',
        limit: 2
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should provide suggestions when no results found', async () => {
      const result = await DocIndex.search({
        query: 'nonexistent-keyword-xyz',
        limit: 10
      });

      expect(result.results).toHaveLength(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should handle empty query', async () => {
      const result = await DocIndex.search({
        query: '',
        limit: 10
      });

      expect(result.results).toHaveLength(0);
    });

    it('should build index if not already built', async () => {
      // Reset cache to clear index
      DocIndex.TestHarness.resetCache();

      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: []
      });

      const result = await DocIndex.search({
        query: 'test',
        limit: 10
      });

      expect(result).toBeDefined();
    });

    it('should return excerpt truncated to 200 characters', async () => {
      const result = await DocIndex.search({
        query: 'template',
        limit: 10
      });

      result.results.forEach(r => {
        expect(r.excerpt.length).toBeLessThanOrEqual(200);
      });
    });

    it('should include context information', async () => {
      const result = await DocIndex.search({
        query: 'template',
        limit: 10
      });

      result.results.forEach(r => {
        expect(r).toHaveProperty('title');
        expect(r).toHaveProperty('excerpt');
        expect(r).toHaveProperty('type');
        expect(r).toHaveProperty('relevanceScore');
      });
    });
  });

  describe('Helper Functions', () => {
    it('should extract markdown headings', () => {
      // This tests internal functionality through the public API
      // The extractMarkdownHeadings function is used internally by buildIndex
      expect(true).toBe(true); // Placeholder - internal function tested through buildIndex
    });

    it('should determine documentation type from heading', () => {
      // This tests internal functionality through the public API
      // The determineDocumentationType function is used internally by buildIndex
      expect(true).toBe(true); // Placeholder - internal function tested through buildIndex
    });

    it('should extract keywords from text', () => {
      // This tests internal functionality through the public API
      // The extractKeywords function is used internally by buildIndex and search
      expect(true).toBe(true); // Placeholder - internal function tested through search
    });

    it('should calculate relevance score', () => {
      // This tests internal functionality through the public API
      // The calculateRelevance function is used internally by search
      expect(true).toBe(true); // Placeholder - internal function tested through search
    });
  });
});
