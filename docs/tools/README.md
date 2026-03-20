# MCP Tools Reference

This document provides detailed information about each MCP tool available in the Atlantis MCP Server Phase 1.

## Table of Contents

- [list_templates](#list_templates)
- [get_template](#get_template)
- [list_template_versions](#list_template_versions)
- [list_categories](#list_categories)
- [list_starters](#list_starters)
- [get_starter_info](#get_starter_info)
- [search_documentation](#search_documentation)
- [validate_naming](#validate_naming)
- [check_template_updates](#check_template_updates)

---

## list_templates

List all available CloudFormation templates from configured S3 buckets.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by template category (storage, network, pipeline, service-role, modules) |
| `version` | string | No | Filter by human-readable version (e.g., "v2.0.18") |
| `versionId` | string | No | Filter by S3 version ID |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |

### Output

Returns an array of template metadata objects:

```json
{
  "templates": [
    {
      "name": "template-pipeline.yml",
      "category": "pipeline",
      "version": "v2.0.18",
      "versionId": "abc123xyz",
      "description": "CodePipeline template for CI/CD",
      "namespace": "atlantis",
      "bucket": "my-templates-bucket",
      "s3Path": "s3://my-templates-bucket/atlantis/templates/v2/pipeline/template-pipeline.yml",
      "lastModified": "2025-01-15T10:30:00Z",
      "parameters": ["Prefix", "ProjectId", "StageId"],
      "outputs": ["PipelineArn", "ArtifactBucket"]
    }
  ],
  "partialData": false,
  "errors": []
}
```

### Example Usage

**List all templates:**
```
Ask your AI: "Show me all available CloudFormation templates"
```

**Filter by category:**
```
Ask your AI: "Show me storage templates"
```

**Filter by version:**
```
Ask your AI: "Show me templates version v2.0.18"
```

### Use Cases

- Discover available templates for your infrastructure needs
- Browse templates by category
- Find specific template versions
- Explore templates from multiple organizations

---

## get_template

Retrieve a specific CloudFormation template with full content and metadata.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template (e.g., "template-pipeline.yml") |
| `category` | string | Yes | Template category |
| `version` | string | No | Human-readable version to retrieve |
| `versionId` | string | No | S3 version ID to retrieve |
| `s3Buckets` | array[string] | No | Search specific S3 buckets only |

**Note:** If both `version` and `versionId` are provided, they are treated as an OR condition (returns template matching either).

### Output

Returns complete template details:

```json
{
  "name": "template-pipeline.yml",
  "category": "pipeline",
  "version": "v2.0.18",
  "versionId": "abc123xyz",
  "content": "AWSTemplateFormatVersion: '2010-09-09'...",
  "description": "CodePipeline template for CI/CD",
  "namespace": "atlantis",
  "bucket": "my-templates-bucket",
  "s3Path": "s3://my-templates-bucket/atlantis/templates/v2/pipeline/template-pipeline.yml",
  "lastModified": "2025-01-15T10:30:00Z",
  "size": 15234,
  "parameters": {
    "Prefix": {
      "Type": "String",
      "Description": "Resource naming prefix"
    },
    "ProjectId": {
      "Type": "String",
      "Description": "Project identifier"
    }
  },
  "outputs": {
    "PipelineArn": {
      "Description": "ARN of the CodePipeline",
      "Value": "!GetAtt Pipeline.Arn"
    }
  }
}
```

### Example Usage

**Get latest version:**
```
Ask your AI: "Get the pipeline template"
```

**Get specific version:**
```
Ask your AI: "Get template-pipeline.yml version v2.0.18"
```

**Get by S3 version ID:**
```
Ask your AI: "Get template with version ID abc123xyz"
```

### Use Cases

- Review template content before deployment
- Compare template versions
- Extract parameter definitions
- Understand template outputs

---

## list_template_versions

List all versions of a specific CloudFormation template.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template |
| `category` | string | Yes | Template category |
| `s3Buckets` | array[string] | No | Search specific S3 buckets only |

### Output

Returns version history:

```json
{
  "templateName": "template-pipeline.yml",
  "category": "pipeline",
  "versions": [
    {
      "version": "v2.0.18",
      "versionId": "abc123xyz",
      "lastModified": "2025-01-15T10:30:00Z",
      "size": 15234,
      "isLatest": true
    },
    {
      "version": "v2.0.17",
      "versionId": "def456uvw",
      "lastModified": "2024-12-10T14:20:00Z",
      "size": 14890,
      "isLatest": false
    }
  ]
}
```

### Example Usage

```
Ask your AI: "Show me all versions of the pipeline template"
```

### Use Cases

- Track template evolution over time
- Find specific versions for rollback
- Compare version metadata
- Audit template changes

---

## list_categories

List all available template categories.

### Input Parameters

None.

### Output

Returns category information:

```json
{
  "categories": [
    {
      "name": "storage",
      "description": "S3 buckets, DynamoDB tables, and storage resources",
      "templateCount": 12
    },
    {
      "name": "network",
      "description": "CloudFront, Route53, and networking resources",
      "templateCount": 8
    },
    {
      "name": "pipeline",
      "description": "CodePipeline and CI/CD templates",
      "templateCount": 6
    },
    {
      "name": "service-role",
      "description": "IAM roles and policies",
      "templateCount": 10
    },
    {
      "name": "modules",
      "description": "Reusable CloudFormation modules",
      "templateCount": 15
    }
  ]
}
```

### Example Usage

```
Ask your AI: "What template categories are available?"
```

### Use Cases

- Discover template organization
- Understand available infrastructure types
- Browse templates by category

---

## list_starters

List all available application starter code repositories.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ghusers` | array[string] | No | Filter to specific GitHub users/orgs from configured list |

### Output

Returns starter metadata:

```json
{
  "starters": [
    {
      "name": "atlantis-starter-02",
      "description": "Node.js Lambda starter with cache-data integration",
      "language": "Node.js",
      "framework": "AWS Lambda",
      "features": ["cache-data", "CloudFront", "DynamoDB", "S3"],
      "prerequisites": ["Node.js 20.x", "AWS SAM CLI"],
      "githubUrl": "https://github.com/63klabs/atlantis-starter-02",
      "author": "63Klabs",
      "license": "Proprietary",
      "hasCacheData": true,
      "hasCloudFront": true
    }
  ],
  "partialData": false,
  "errors": []
}
```

### Example Usage

**List all starters:**
```
Ask your AI: "Show me available application starters"
```

**Filter by organization:**
```
Ask your AI: "Show me starters from 63klabs"
```

### Use Cases

- Find starter code for new projects
- Discover pre-configured application templates
- Identify starters with specific integrations
- Bootstrap new serverless applications

---

## get_starter_info

Get detailed information about a specific application starter.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `starterName` | string | Yes | Name of the starter repository |
| `ghusers` | array[string] | No | Search specific GitHub users/orgs only |

### Output

Returns detailed starter information:

```json
{
  "name": "atlantis-starter-02",
  "description": "Node.js Lambda starter with cache-data integration",
  "language": "Node.js",
  "framework": "AWS Lambda",
  "features": ["cache-data", "CloudFront", "DynamoDB", "S3"],
  "prerequisites": ["Node.js 20.x", "AWS SAM CLI", "AWS Account"],
  "githubUrl": "https://github.com/63klabs/atlantis-starter-02",
  "author": "63Klabs",
  "license": "Proprietary",
  "hasCacheData": true,
  "hasCloudFront": true,
  "readme": "# Atlantis Starter 02\n\nThis starter provides...",
  "latestRelease": {
    "version": "v1.2.0",
    "releaseDate": "2025-01-10",
    "notes": "Added support for..."
  },
  "stats": {
    "stars": 45,
    "forks": 12,
    "lastUpdated": "2025-01-15T10:30:00Z"
  },
  "examples": [
    {
      "title": "Basic Lambda Handler",
      "code": "exports.handler = async (event) => { ... }"
    }
  ]
}
```

### Example Usage

```
Ask your AI: "Tell me about the atlantis-starter-02 repository"
```

### Use Cases

- Understand starter capabilities before using
- Review prerequisites and setup requirements
- Access example code snippets
- Check latest release information

---

## search_documentation

Search across Atlantis documentation, tutorials, and code patterns.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search keywords |
| `type` | string | No | Filter by type: "guide", "tutorial", "reference", "troubleshooting", "template pattern", "code example" |
| `ghusers` | array[string] | No | Search specific GitHub users/orgs only |

### Output

Returns search results:

```json
{
  "results": [
    {
      "title": "DynamoDB Caching with cache-data",
      "excerpt": "Learn how to implement DynamoDB caching using the cache-data package...",
      "type": "guide",
      "filePath": "docs/features/dynamodb-caching.md",
      "githubUrl": "https://github.com/63klabs/cache-data/blob/main/docs/features/dynamodb-caching.md",
      "relevanceScore": 0.95
    },
    {
      "title": "Cache Configuration Example",
      "excerpt": "const cache = new Cache({ table: 'my-cache-table' });",
      "type": "code example",
      "filePath": "examples/cache-setup.js",
      "githubUrl": "https://github.com/63klabs/cache-data/blob/main/examples/cache-setup.js",
      "lineNumbers": "15-25",
      "context": "// Initialize cache with DynamoDB\nconst cache = new Cache({\n  table: 'my-cache-table',\n  ttl: 3600\n});",
      "relevanceScore": 0.88
    }
  ],
  "suggestions": ["caching patterns", "DynamoDB setup", "cache-data examples"],
  "totalResults": 2
}
```

### Example Usage

**General search:**
```
Ask your AI: "Search documentation for DynamoDB caching"
```

**Filter by type:**
```
Ask your AI: "Find code examples for Lambda functions"
```

**Search specific topics:**
```
Ask your AI: "How do I implement CloudFront caching?"
```

### Use Cases

- Find implementation guidance
- Discover code patterns and examples
- Locate troubleshooting information
- Learn best practices
- Find CloudFormation resource patterns

---

## validate_naming

Validate resource names against Atlantis naming conventions.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resourceName` | string | Yes | Name to validate |
| `resourceType` | string | No | Type: "application", "s3", "dynamodb", "lambda", "cloudformation" |

### Output

Returns validation results:

```json
{
  "valid": true,
  "resourceName": "acme-person-api-test-GetPersonFunction",
  "resourceType": "application",
  "components": {
    "prefix": "acme",
    "projectId": "person-api",
    "stageId": "test",
    "resourceName": "GetPersonFunction"
  },
  "pattern": "Prefix-ProjectId-StageId-ResourceName",
  "suggestions": []
}
```

**Invalid name example:**

```json
{
  "valid": false,
  "resourceName": "my-invalid-name",
  "resourceType": "application",
  "errors": [
    "Missing StageId component",
    "ResourceName contains invalid characters"
  ],
  "suggestions": [
    "Use format: Prefix-ProjectId-StageId-ResourceName",
    "Example: acme-myapp-test-MyFunction"
  ]
}
```

### Example Usage

**Validate application resource:**
```
Ask your AI: "Validate this name: acme-person-api-test-GetPersonFunction"
```

**Validate S3 bucket:**
```
Ask your AI: "Is this S3 bucket name valid: acme-myapp-test-us-east-1-123456789012"
```

**Get naming suggestions:**
```
Ask your AI: "How should I name my Lambda function?"
```

### Use Cases

- Verify resource names before deployment
- Ensure naming convention compliance
- Get suggestions for correct naming
- Validate partial names during development

---

## check_template_updates

Check if CloudFormation templates have newer versions available.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template |
| `currentVersion` | string | Yes | Current version you're using |
| `category` | string | No | Template category |
| `s3Buckets` | array[string] | No | Search specific S3 buckets only |

### Output

Returns update information:

```json
{
  "templateName": "template-pipeline.yml",
  "currentVersion": "v2.0.17",
  "latestVersion": "v2.0.18",
  "updateAvailable": true,
  "releaseDate": "2025-01-15",
  "changelog": "- Enhanced CodeBuild environment\n- Added post-deployment validation\n- Fixed timeout configuration",
  "breakingChanges": false,
  "migrationGuide": null,
  "versionsBehind": 1
}
```

**With breaking changes:**

```json
{
  "templateName": "template-storage-s3-artifacts.yml",
  "currentVersion": "v1.3.5",
  "latestVersion": "v2.0.0",
  "updateAvailable": true,
  "releaseDate": "2025-01-20",
  "changelog": "- Restructured bucket naming\n- Removed legacy encryption parameter\n- Added new lifecycle policies",
  "breakingChanges": true,
  "migrationGuide": "https://github.com/63klabs/atlantis-templates/docs/migration/v1-to-v2.md",
  "deprecationDate": "2028-01-20",
  "versionsBehind": 5
}
```

### Example Usage

**Check single template:**
```
Ask your AI: "Check if template-pipeline.yml v2.0.17 has updates"
```

**Check multiple templates:**
```
Ask your AI: "Check for updates on all my templates"
```

### Use Cases

- Stay current with template improvements
- Plan template upgrades
- Identify breaking changes before upgrading
- Review changelogs and migration guides
- Maintain infrastructure currency

---

## Error Responses

All tools return errors in a consistent format:

```json
{
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "Template 'invalid-template.yml' not found",
    "details": {
      "availableTemplates": ["template-pipeline.yml", "template-storage.yml"]
    },
    "requestId": "abc-123-def-456"
  }
}
```

Common error codes:
- `INVALID_INPUT`: Input validation failed
- `TEMPLATE_NOT_FOUND`: Requested template doesn't exist
- `STARTER_NOT_FOUND`: Requested starter doesn't exist
- `RATE_LIMIT_EXCEEDED`: Too many requests (HTTP 429)
- `INTERNAL_ERROR`: Server error (HTTP 500)

---

## Rate Limiting

All tools are subject to rate limiting:

- Default: 100 requests per hour per IP
- Rate limit headers included in all responses
- HTTP 429 returned when exceeded

See [Troubleshooting Guide](../troubleshooting/README.md) for handling rate limits.

---

## Caching

Results are cached for performance:

- Template metadata: 1 hour
- Starter metadata: 1 hour
- Documentation index: 6 hours
- Full template content: 24 hours

Cached responses include cache metadata in headers.

---

## Next Steps

- [Integration Guides](../integration/) - Set up your AI assistant
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting](../troubleshooting/README.md) - Common issues and solutions
