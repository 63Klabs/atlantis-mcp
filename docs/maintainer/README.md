# Maintainer Documentation

## Overview

This directory contains comprehensive documentation for maintainers of the Atlantis MCP Server. These documents cover architecture, implementation details, operational procedures, and contribution guidelines.

## Documentation Index

### Architecture and Design

- **[Architecture Overview](./architecture.md)** - High-level architecture, component diagrams, and data flow
- **[Lambda Function Structure](./lambda-structure.md)** - Directory structure, layer responsibilities, and design patterns
- **[Caching Strategy](./caching-strategy.md)** - Multi-tier caching, TTL configuration, and performance optimization
- **[Brown-Out Support](./brown-out-support.md)** - Resilience patterns for partial source failures
- **[Namespace Discovery](./namespace-discovery.md)** - Multi-source configuration and priority ordering
- **[Template Versioning](./template-versioning.md)** - Dual identifier system (Human_Readable_Version and S3_VersionId)

### Implementation Details

- **[Code Pattern Indexing](#code-pattern-indexing)** - Documentation and code pattern search implementation
- **[Testing Procedures](#testing-procedures)** - Unit, integration, and property-based testing
- **[Release Process](#release-process)** - Version management and deployment procedures

### Contribution

- **[Contribution Guidelines](#contribution-guidelines)** - How to contribute to the project

## Quick Reference

### Key Concepts

| Concept | Description | Documentation |
|---------|-------------|---------------|
| **Multi-Tier Caching** | In-memory → DynamoDB → S3 → Source | [Caching Strategy](./caching-strategy.md) |
| **Brown-Out Support** | Continue on partial failures | [Brown-Out Support](./brown-out-support.md) |
| **Namespace Priority** | Bucket → Namespace → Deduplication | [Namespace Discovery](./namespace-discovery.md) |
| **Dual Versioning** | Human version + S3 version ID | [Template Versioning](./template-versioning.md) |
| **MVC Pattern** | Handler → Router → Controller → Service → Model | [Lambda Structure](./lambda-structure.md) |

### Common Tasks

| Task | Documentation |
|------|---------------|
| Add new MCP tool | [Lambda Structure](./lambda-structure.md#adding-new-tools) |
| Adjust cache TTLs | [Caching Strategy](./caching-strategy.md#ttl-configuration) |
| Configure multi-bucket | [Namespace Discovery](./namespace-discovery.md#configuration-examples) |
| Debug brown-out issues | [Brown-Out Support](./brown-out-support.md#troubleshooting) |
| Run tests | [Testing Procedures](#testing-procedures) |
| Create release | [Release Process](#release-process) |

---

## Code Pattern Indexing

### Overview

The documentation index provides searchable access to:
- Markdown documentation from GitHub repositories
- CloudFormation template patterns and examples
- Code examples from app starters
- cache-data package usage patterns

### Index Structure

```javascript
{
  documentation: [
    {
      title: 'S3 Bucket Configuration',
      type: 'guide',
      source: 'github',
      repository: 'atlantis-cfn-template-repo',
      filePath: 'docs/templates/storage/s3-bucket.md',
      excerpt: 'Configure S3 buckets with encryption...',
      url: 'https://github.com/63klabs/atlantis-cfn-template-repo/blob/main/docs/templates/storage/s3-bucket.md'
    }
  ],
  templatePatterns: [
    {
      title: 'S3 Bucket with Encryption',
      type: 'template-pattern',
      category: 'storage',
      templateName: 's3-bucket',
      section: 'Resources',
      code: 'MyBucket:\n  Type: AWS::S3::Bucket\n  Properties:...',
      description: 'S3 bucket with server-side encryption'
    }
  ],
  codeExamples: [
    {
      title: 'Cache-Data Usage',
      type: 'code-example',
      language: 'javascript',
      framework: 'cache-data',
      filePath: 'src/index.js',
      lineNumbers: '10-25',
      code: 'const result = await CacheableDataAccess.getData(...)',
      description: 'Using cache-data for S3 caching'
    }
  ]
}
```

### Building the Index

#### On Lambda Cold Start

```javascript
// src/lambda/read/config/index.js

const Config = {
  async init() {
    // ... other initialization
    
    // Build documentation index asynchronously (non-blocking)
    buildDocumentationIndex().catch(error => {
      DebugAndLog.warn('Failed to build documentation index', error);
    });
  }
};

const buildDocumentationIndex = async () => {
  // Index template repository documentation
  await Models.DocIndex.indexRepository('63klabs', 'atlantis-cfn-template-repo');
  
  // Index cache-data package documentation
  await Models.DocIndex.indexRepository('63klabs', 'cache-data');
  
  // Index is cached for subsequent requests
  DebugAndLog.info('Documentation index built successfully');
};
```

#### Indexing Strategy

1. **Template Repository**: Index on cold start (high priority)
2. **Cache-Data Package**: Index on cold start (high priority)
3. **App Starters**: Index on-demand or asynchronously (lower priority)

### Search Implementation

```javascript
// src/lambda/read/models/doc-index.js

const search = async (query, options = {}) => {
  const { type, limit = 10 } = options;
  
  // Load index from cache or build if needed
  const index = await loadIndex();
  
  // Tokenize query
  const tokens = tokenize(query);
  
  // Search across all indexed content
  const results = [];
  
  // Search documentation
  if (!type || type === 'documentation') {
    results.push(...searchDocumentation(index.documentation, tokens));
  }
  
  // Search template patterns
  if (!type || type === 'template-pattern') {
    results.push(...searchTemplatePatterns(index.templatePatterns, tokens));
  }
  
  // Search code examples
  if (!type || type === 'code-example') {
    results.push(...searchCodeExamples(index.codeExamples, tokens));
  }
  
  // Rank by relevance
  const ranked = rankResults(results, tokens);
  
  // Return top results
  return ranked.slice(0, limit);
};
```

### Relevance Ranking

```javascript
const rankResults = (results, tokens) => {
  return results.map(result => {
    let score = 0;
    
    // Title matches (highest weight)
    score += countMatches(result.title, tokens) * 10;
    
    // Description matches
    score += countMatches(result.description, tokens) * 5;
    
    // Code/content matches
    score += countMatches(result.code || result.excerpt, tokens) * 2;
    
    // Type-specific bonuses
    if (result.type === 'guide') score += 3;
    if (result.type === 'template-pattern') score += 2;
    
    return { ...result, relevanceScore: score };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
};
```

### Indexed Content Types

#### 1. Markdown Documentation

**Sources**:
- Template repository READMEs
- Deployment guides
- Troubleshooting docs
- API documentation

**Indexed Fields**:
- Headings (H1-H6)
- Paragraphs
- Code blocks
- Links

#### 2. CloudFormation Template Patterns

**Sources**:
- Template repository templates
- Example templates

**Indexed Sections**:
- Metadata
- Parameters
- Mappings
- Conditions
- Resources
- Outputs

**Example**:
```yaml
# Indexed as template pattern
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
```

#### 3. Code Examples

**Sources**:
- App starter source code
- cache-data package examples
- Lambda function examples

**Indexed Patterns**:
- Function definitions
- Class definitions
- cache-data usage
- AWS SDK usage
- Error handling patterns

**Example**:
```javascript
// Indexed as code example
const result = await CacheableDataAccess.getData(
  cacheProfile,
  fetchFunction,
  connection,
  options
);
```

### Cache Strategy for Index

```javascript
// Index is cached with long TTL
const cacheProfile = {
  hostId: 'doc-index',
  pathId: 'search',
  defaultExpirationInSeconds: 3600,  // 1 hour
  hostEncryption: 'public'
};
```

### Search Response Format

```json
{
  "tool": "search_documentation",
  "result": {
    "query": "s3 bucket encryption",
    "results": [
      {
        "title": "S3 Bucket with Encryption",
        "type": "template-pattern",
        "excerpt": "CloudFormation template for S3 bucket with server-side encryption",
        "url": "https://github.com/63klabs/atlantis-cfn-template-repo/blob/main/templates/v2/storage/s3-bucket.yml",
        "relevanceScore": 45,
        "codeSnippet": "BucketEncryption:\n  ServerSideEncryptionConfiguration:..."
      },
      {
        "title": "S3 Bucket Configuration Guide",
        "type": "documentation",
        "excerpt": "Learn how to configure S3 buckets with encryption...",
        "url": "https://github.com/63klabs/atlantis-cfn-template-repo/blob/main/docs/templates/storage/README.md",
        "relevanceScore": 38
      }
    ],
    "count": 2,
    "suggestions": ["s3 versioning", "s3 lifecycle policies"]
  }
}
```

---

## Contribution Guidelines

### Getting Started

1. **Fork the Repository**
   ```bash
   git clone https://github.com/63klabs/atlantis-mcp-server.git
   cd atlantis-mcp-server
   ```

2. **Install Dependencies**
   ```bash
   cd application-infrastructure/src/lambda/read
   npm install
   cd ../../../..
   ```

3. **Run Tests**
   ```bash
   npm test
   ```

### Development Workflow

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make Changes**
   - Follow existing code patterns
   - Add tests for new functionality
   - Update documentation

3. **Run Tests**
   ```bash
   npm test
   npm run lint
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/my-new-feature
   ```

### Code Standards

#### JavaScript Style

- Use ES6+ features
- Async/await for asynchronous code
- Destructuring for object/array access
- Template literals for strings
- Arrow functions for callbacks

#### Naming Conventions

- **Files**: kebab-case (e.g., `s3-templates.js`)
- **Functions**: camelCase (e.g., `listTemplates`)
- **Classes**: PascalCase (e.g., `TemplateService`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)

#### Documentation

- JSDoc for all public functions
- Inline comments for complex logic
- README updates for new features
- Architecture docs for design changes

### Testing Requirements

- Unit tests for all new functions
- Integration tests for API endpoints
- Property-based tests for validation logic
- Minimum 80% code coverage

### Pull Request Guidelines

**PR Title Format**:
```
<type>: <description>

Types: feat, fix, docs, style, refactor, test, chore
```

**PR Description**:
- What: Describe the changes
- Why: Explain the motivation
- How: Detail the implementation
- Testing: Describe test coverage
- Breaking Changes: List any breaking changes

**Review Process**:
1. Automated tests must pass
2. Code review by maintainer
3. Documentation review
4. Approval and merge

### Adding New MCP Tools

1. **Define JSON Schema** (`utils/schema-validator.js`)
2. **Create Controller** (`controllers/my-tool.js`)
3. **Create Service** (`services/my-tool.js`)
4. **Create Model** (if needed) (`models/my-dao.js`)
5. **Add Route** (`routes/index.js`)
6. **Add Tests** (`tests/unit/controllers/my-tool.test.js`)
7. **Update Documentation** (`docs/tools/README.md`)

---

## Testing Procedures

### Test Organization

```
tests/
├── unit/                    # Unit tests
│   ├── controllers/
│   ├── services/
│   ├── models/
│   └── utils/
├── integration/             # Integration tests
│   └── lambda/
└── property/                # Property-based tests
    └── naming-validation/
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/controllers/templates-controller.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

### Unit Testing

**Example**: Controller test

```javascript
describe('Templates Controller', () => {
  it('should list templates', async () => {
    // Mock service
    const mockTemplates = [
      { name: 'template1', category: 'storage' }
    ];
    jest.spyOn(Services.Templates, 'list').mockResolvedValue({
      templates: mockTemplates
    });
    
    // Call controller
    const result = await Controllers.Templates.list({
      body: { input: {} }
    });
    
    // Assert
    expect(result.result.templates).toEqual(mockTemplates);
  });
});
```

### Integration Testing

**Example**: Lambda handler test

```javascript
describe('Lambda Handler Integration', () => {
  it('should handle list_templates request', async () => {
    const event = {
      body: JSON.stringify({
        tool: 'list_templates',
        input: { category: 'storage' }
      })
    };
    
    const response = await handler(event, {});
    
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.templates).toBeDefined();
  });
});
```

### Property-Based Testing

**Example**: Naming validation

```javascript
import fc from 'fast-check';

describe('Naming Validation Properties', () => {
  it('Property: Valid names always pass validation', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z0-9-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z0-9-]+$/.test(s)),
        fc.constantFrom('test', 'prod'),
        (prefix, projectId, stageId) => {
          const name = `${prefix}-${projectId}-${stageId}-resource`;
          const result = validateNaming(name);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Test Coverage Requirements

- **Overall**: Minimum 80%
- **Controllers**: Minimum 90%
- **Services**: Minimum 85%
- **Models**: Minimum 80%
- **Utils**: Minimum 95%

### Continuous Integration

Tests run automatically on:
- Every push to any branch
- Every pull request
- Before deployment

---

## Release Process

### Version Management

Follow semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Checklist

#### 1. Pre-Release

- [ ] All tests passing
- [ ] Code coverage meets requirements
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json

#### 2. Create Release Branch

```bash
git checkout -b release/v1.2.3
```

#### 3. Update Version

```bash
# Update package.json
npm version patch  # or minor, or major

# Update CHANGELOG.md
# Move "Unreleased" section to new version with date
```

#### 4. Test Release

```bash
# Run full test suite
npm test

# Run integration tests
npm run test:integration

# Build Lambda package
sam build
```

#### 5. Create Release

```bash
# Commit version changes
git add .
git commit -m "chore: release v1.2.3"

# Create tag
git tag -a v1.2.3 -m "Release v1.2.3"

# Push to repository
git push origin release/v1.2.3
git push origin v1.2.3
```

#### 6. Deploy

Deployment is handled by CI/CD pipeline:
1. Push to `test` branch → Deploy to TEST environment
2. Test in TEST environment
3. Merge to `main` branch → Deploy to PROD environment

#### 7. Post-Release

- [ ] Verify deployment in TEST
- [ ] Verify deployment in PROD
- [ ] Update GitHub release notes
- [ ] Announce release to team
- [ ] Monitor CloudWatch for errors

### Hotfix Process

For critical bugs in production:

1. **Create Hotfix Branch**
   ```bash
   git checkout -b hotfix/v1.2.4 main
   ```

2. **Fix Bug**
   - Make minimal changes
   - Add regression test
   - Update CHANGELOG.md

3. **Test Thoroughly**
   ```bash
   npm test
   ```

4. **Release**
   ```bash
   npm version patch
   git commit -am "fix: critical bug"
   git tag v1.2.4
   git push origin hotfix/v1.2.4
   git push origin v1.2.4
   ```

5. **Merge Back**
   ```bash
   git checkout main
   git merge hotfix/v1.2.4
   git checkout dev
   git merge hotfix/v1.2.4
   ```

### Deployment Environments

| Environment | Branch | Purpose | Deployment |
|------------|--------|---------|------------|
| **TEST** | test | Testing and validation | Automatic on push |
| **PROD** | main | Production | Automatic on push |

### Rollback Procedure

If issues are detected after deployment:

1. **Identify Issue**
   - Check CloudWatch logs
   - Review error metrics
   - Confirm issue severity

2. **Rollback**
   ```bash
   # Revert to previous version
   git revert <commit-hash>
   git push origin main
   ```

3. **Verify**
   - Monitor CloudWatch
   - Test critical paths
   - Confirm issue resolved

4. **Post-Mortem**
   - Document issue
   - Identify root cause
   - Implement prevention measures

---

## Additional Resources

### External Documentation

- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [@63klabs/cache-data Package](https://github.com/63klabs/cache-data)

### Internal Documentation

- [User Documentation](../README.md)
- [Deployment Guide](../deployment/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)
- [API Reference](../tools/README.md)

### Support

- **Issues**: [GitHub Issues](https://github.com/63klabs/atlantis-mcp-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/63klabs/atlantis-mcp-server/discussions)
- **Email**: support@63klabs.com

---

## Maintainer Responsibilities

### Code Maintenance

- Review and merge pull requests
- Maintain code quality standards
- Update dependencies regularly
- Monitor security vulnerabilities

### Documentation

- Keep documentation up-to-date
- Review documentation PRs
- Create new docs for features
- Archive outdated documentation

### Community

- Respond to issues and questions
- Guide new contributors
- Maintain contribution guidelines
- Foster inclusive community

### Operations

- Monitor production metrics
- Respond to incidents
- Plan capacity and scaling
- Coordinate releases

---

## License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE.txt) file for details.
