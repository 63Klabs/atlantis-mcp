# MCP Tools Reference

This document provides detailed information about each MCP tool available through the Atlantis MCP Server.

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
| `namespace` | string | No | Search specific namespaces only |

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

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
- Browse templates by category (pipeline, storage, network, etc.)
- Find specific template versions

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
| `namespace` | string | No | Search specific namespaces only |

> **Note:** If both `version` and `versionId` are provided, they are treated as an OR condition (returns template matching either).

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

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
| `namespace` | string | No | Search specific namespaces only |

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.


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
| `s3buckets` | array[string] | No | Filter to specific GitHub users/orgs from configured list |
| `namespace` | string | No | Search specific namespaces only |

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**List all starters:**
```
Ask your AI: "Show me available application starters"
```

**Filter by bucket and namespace:**
```
Ask your AI: "Show me starters from 63klabs atlantis"
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
| `s3buckets` | array[string] | No | Filter to specific GitHub users/orgs from configured list |
| `namespace` | string | No | Search specific namespaces only |

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

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
| `namespace` | string | No | Search specific namespaces only |

> **Note** `63klabs` is the only bucket, and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

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

- Default: 50 requests per hour per IP
- Rate limit headers included in all responses
- HTTP 429 returned when exceeded
- Rate limit resets on the hour (midnight UTC if every 24 hours)

---

## Next Steps

- [Integration Guides](../integration/) - Set up your AI assistant
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting](../troubleshooting/README.md) - Common issues and solutions
