# CloudFormation Parameters Reference

## Overview

This document provides a comprehensive reference for all CloudFormation parameters used in the Atlantis MCP Server deployment. These parameters control the behavior, configuration, and resource naming of the deployed MCP server.

## Parameter Categories

Parameters are organized into the following categories:

1. [Naming Convention Parameters](#naming-convention-parameters)
2. [S3 Configuration Parameters](#s3-configuration-parameters)
3. [GitHub Configuration Parameters](#github-configuration-parameters)
4. [Rate Limiting Parameters](#rate-limiting-parameters)
5. [Cache TTL Parameters](#cache-ttl-parameters)
6. [IAM Configuration Parameters](#iam-configuration-parameters)
7. [Logging Parameters](#logging-parameters)

---

## Naming Convention Parameters

These parameters follow the Atlantis naming convention: `Prefix-ProjectId-StageId-ResourceName`

### Prefix

**Type:** String  
**Required:** Yes  
**Default:** None  
**Pattern:** `^[a-z0-9][a-z0-9-]{0,20}[a-z0-9]$`

**Description:** Organization or team identifier used as the first component of all resource names.

**Example Values:**
- `acme` - For Acme Corporation
- `finance` - For Finance team
- `devops` - For DevOps team

**Usage:**
```yaml
Prefix: acme
```

**Resulting Resource Names:**
- Lambda: `acme-mcp-server-test-ReadFunction`
- DynamoDB: `acme-mcp-server-test-CacheTable`
- S3: `acme-mcp-server-test-cache-bucket`

---

### ProjectId

**Type:** String  
**Required:** Yes  
**Default:** None  
**Pattern:** `^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$`

**Description:** Project identifier used as the second component of all resource names. Should be unique within your organization.

**Example Values:**
- `mcp-server` - For MCP Server project
- `api-gateway` - For API Gateway project
- `data-pipeline` - For Data Pipeline project

**Usage:**
```yaml
ProjectId: mcp-server
```

---

### StageId

**Type:** String  
**Required:** Yes  
**Default:** None  
**Allowed Values:** `test`, `beta`, `stage`, `prod`

**Description:** Deployment stage identifier used as the third component of all resource names. Determines environment-specific configurations.

**Stage Characteristics:**

| Stage | Environment | Deployment | Log Retention | Alarms | Dashboards |
|-------|-------------|------------|---------------|--------|------------|
| test | TEST | Immediate | 7 days | No | No |
| beta | PROD | Gradual | 30 days | Yes | Yes |
| stage | PROD | Gradual | 30 days | Yes | Yes |
| prod | PROD | Gradual | 90 days | Yes | Yes |

**Usage:**
```yaml
StageId: test
```

---

## S3 Configuration Parameters

### AtlantisS3Buckets

**Type:** CommaDelimitedList  
**Required:** Yes  
**Default:** None

**Description:** Comma-delimited list of S3 bucket names containing Atlantis templates and app starters. Buckets are searched in priority order (first bucket has highest priority).

**Requirements:**
- Each bucket must have the tag `atlantis-mcp:Allow=true`
- Each bucket must have the tag `atlantis-mcp:IndexPriority` with comma-delimited namespace list
- Bucket names must be valid S3 bucket names

**Example Values:**
```yaml
AtlantisS3Buckets: acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1,acme-devops-templates-us-east-1
```

**Priority Ordering:**
- First bucket (`acme-atlantis-templates-us-east-1`) has highest priority
- If a template exists in multiple buckets, the version from the first bucket is used
- Namespaces within each bucket are prioritized by the `atlantis-mcp:IndexPriority` tag

**See Also:**
- [S3 Bucket Tagging Guide](./s3-bucket-tagging.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)

---

## GitHub Configuration Parameters

### AtlantisGitHubUserOrgs

**Type:** CommaDelimitedList  
**Required:** Yes  
**Default:** None

**Description:** Comma-delimited list of GitHub usernames or organization names to search for repositories. Users/orgs are searched in priority order (first has highest priority).

**Requirements:**
- Repositories must have the custom property `atlantis_repository-type` set
- Valid repository types: `documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`
- Repositories without the custom property are excluded from discovery

**Example Values:**
```yaml
AtlantisGitHubUserOrgs: 63klabs,acme-org,finance-team
```

**Priority Ordering:**
- First user/org (`63klabs`) has highest priority
- If a repository exists in multiple orgs, the version from the first org is used

**See Also:**
- [GitHub Custom Properties Setup](./github-custom-properties.md)
- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)

---

### GitHubTokenParameter

**Type:** String  
**Required:** Yes (for private repositories)  
**Default:** None

**Description:** AWS Systems Manager Parameter Store path containing the GitHub Personal Access Token for accessing private repositories.

**Requirements:**
- Parameter must exist in SSM Parameter Store
- Parameter type should be `SecureString`
- Token must have required scopes: `repo`, `read:org`, `read:user`

**Example Values:**
```yaml
GitHubTokenParameter: /atlantis/mcp/github-token
```

**Creating the Parameter:**
```bash
aws ssm put-parameter \
  --name "/atlantis/mcp/github-token" \
  --value "ghp_your_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server"
```

**See Also:**
- [GitHub Token Setup Guide](./github-token-setup.md)

---

## Rate Limiting Parameters

### PublicRateLimit

**Type:** Number  
**Required:** No  
**Default:** `100`  
**Min Value:** `1`  
**Max Value:** `10000`

**Description:** Maximum number of requests per hour per IP address for unauthenticated (public) access. Enforced by API Gateway.

**Recommendations:**

| Use Case | Recommended Value | Rationale |
|----------|-------------------|-----------|
| Development/Testing | 100-500 | Allow frequent testing |
| Small Organization | 500-1000 | Support moderate usage |
| Large Organization | 1000-5000 | Support high usage |
| Public Service | 100-500 | Prevent abuse |

**Example Values:**
```yaml
PublicRateLimit: 100  # Default for public service
PublicRateLimit: 1000 # For organizational use
```

**Rate Limit Behavior:**
- Tracked per IP address
- Resets every hour
- Returns HTTP 429 when exceeded
- Includes `Retry-After` header in response

---

## Cache TTL Parameters

Cache Time-To-Live (TTL) parameters control how long data is cached before being refreshed. All values are in seconds.

### CacheTTLTemplateList

**Type:** Number  
**Required:** No  
**Default:** `3600` (1 hour)  
**Min Value:** `60`  
**Max Value:** `86400`

**Description:** TTL for template list cache. Controls how often the list of available templates is refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes) - Rapid iteration
- **Production:** 3600 (1 hour) - Balance freshness and cost

---

### CacheTTLTemplateDetail

**Type:** Number  
**Required:** No  
**Default:** `86400` (24 hours)  
**Min Value:** `300`  
**Max Value:** `604800`

**Description:** TTL for full template content cache. Controls how often individual template YAML files are refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes) - Rapid iteration
- **Production:** 86400 (24 hours) - Templates change infrequently

---

### CacheTTLTemplateVersions

**Type:** Number  
**Required:** No  
**Default:** `3600` (1 hour)  
**Min Value:** `60`  
**Max Value:** `86400`

**Description:** TTL for template version history cache. Controls how often version lists are refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 3600 (1 hour)

---

### CacheTTLStarterList

**Type:** Number  
**Required:** No  
**Default:** `3600` (1 hour)  
**Min Value:** `60`  
**Max Value:** `86400`

**Description:** TTL for app starter list cache. Controls how often the list of available starters is refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 3600 (1 hour)

---

### CacheTTLStarterDetail

**Type:** Number  
**Required:** No  
**Default:** `3600` (1 hour)  
**Min Value:** `300`  
**Max Value:** `86400`

**Description:** TTL for individual starter metadata cache. Controls how often starter details are refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 3600 (1 hour)

---

### CacheTTLDocumentationIndex

**Type:** Number  
**Required:** No  
**Default:** `21600` (6 hours)  
**Min Value:** `300`  
**Max Value:** `86400`

**Description:** TTL for documentation search index cache. Controls how often the documentation index is rebuilt.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 21600 (6 hours) - Documentation changes infrequently

---

### CacheTTLCodePatterns

**Type:** Number  
**Required:** No  
**Default:** `21600` (6 hours)  
**Min Value:** `300`  
**Max Value:** `86400`

**Description:** TTL for indexed code patterns cache. Controls how often code pattern indexes are refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 21600 (6 hours)

---

### CacheTTLGitHubMetadata

**Type:** Number  
**Required:** No  
**Default:** `1800` (30 minutes)  
**Min Value:** `60`  
**Max Value:** `3600`

**Description:** TTL for GitHub repository metadata cache. Controls how often repository information is refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 1800 (30 minutes) - Balance freshness and API rate limits

---

### CacheTTLGitHubProperties

**Type:** Number  
**Required:** No  
**Default:** `3600` (1 hour)  
**Min Value:** `300`  
**Max Value:** `86400`

**Description:** TTL for GitHub custom properties cache. Controls how often repository custom properties are refreshed.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 3600 (1 hour) - Properties change infrequently

---

### CacheTTLFullTemplateContent

**Type:** Number  
**Required:** No  
**Default:** `86400` (24 hours)  
**Min Value:** `300`  
**Max Value:** `604800`

**Description:** TTL for full template content stored in S3 cache. Controls how often large template files are refreshed in the cache.

**Recommendations:**
- **Test Environment:** 300 (5 minutes)
- **Production:** 86400 (24 hours) - Large files, infrequent changes

---

## IAM Configuration Parameters

### ReadLambdaExecRoleIncludeManagedPolicyArns

**Type:** CommaDelimitedList  
**Required:** No  
**Default:** Empty string

**Description:** Comma-delimited list of AWS Managed Policy ARNs to attach to the Read Lambda execution role. Use this to grant additional permissions without modifying the base template.

**Use Cases:**
- Accessing additional S3 buckets
- Reading from additional DynamoDB tables
- Accessing AWS Secrets Manager
- Custom organizational policies

**Example Values:**
```yaml
# Single policy
ReadLambdaExecRoleIncludeManagedPolicyArns: arn:aws:iam::123456789012:policy/CustomS3Access

# Multiple policies
ReadLambdaExecRoleIncludeManagedPolicyArns: arn:aws:iam::123456789012:policy/CustomS3Access,arn:aws:iam::123456789012:policy/CustomDynamoDBAccess
```

**Best Practices:**
- Create custom managed policies in a separate CloudFormation stack
- Follow least privilege principle
- Document why each policy is needed
- Use resource-scoped permissions in custom policies

**See Also:**
- [Atlantis IAM Best Practices](https://github.com/63Klabs/atlantis-cfn-template-repo-for-serverless-deployments/docs/iam-best-practices.md)

---

## Logging Parameters

### LogLevel

**Type:** String  
**Required:** No  
**Default:** `INFO`  
**Allowed Values:** `ERROR`, `WARN`, `INFO`, `DEBUG`, `DIAG`

**Description:** Logging level for the Lambda function. Controls the verbosity of logs written to CloudWatch.

**Log Levels:**

| Level | Description | Use Case |
|-------|-------------|----------|
| ERROR | Fatal errors only | Production (minimal logging) |
| WARN | Errors and warnings | Production (recommended) |
| INFO | Informational messages | Production/Test (default) |
| DEBUG | Detailed debugging | Test/Development |
| DIAG | Diagnostic information | Troubleshooting |

**Example Values:**
```yaml
LogLevel: INFO  # Production default
LogLevel: DEBUG # Development/troubleshooting
```

**Recommendations:**
- **Production:** `INFO` or `WARN` - Balance observability and cost
- **Test:** `DEBUG` - Detailed information for development
- **Troubleshooting:** `DIAG` - Maximum verbosity

**Log Retention:**
- Test environment: 7 days
- Production environment: 30-90 days (based on stage)

---

## Complete Parameter Example

Here's a complete example configuration for a test environment:

```yaml
# Naming Convention
Prefix: acme
ProjectId: mcp-server
StageId: test

# S3 Configuration
AtlantisS3Buckets: acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1

# GitHub Configuration
AtlantisGitHubUserOrgs: 63klabs,acme-org
GitHubTokenParameter: /atlantis/mcp/github-token

# Rate Limiting
PublicRateLimit: 500

# Cache TTL (Test Environment - Short TTLs)
CacheTTLTemplateList: 300
CacheTTLTemplateDetail: 300
CacheTTLTemplateVersions: 300
CacheTTLStarterList: 300
CacheTTLStarterDetail: 300
CacheTTLDocumentationIndex: 300
CacheTTLCodePatterns: 300
CacheTTLGitHubMetadata: 300
CacheTTLGitHubProperties: 300
CacheTTLFullTemplateContent: 300

# IAM Configuration
ReadLambdaExecRoleIncludeManagedPolicyArns: arn:aws:iam::123456789012:policy/CustomS3Access

# Logging
LogLevel: DEBUG
```

And for production:

```yaml
# Naming Convention
Prefix: acme
ProjectId: mcp-server
StageId: prod

# S3 Configuration
AtlantisS3Buckets: acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1

# GitHub Configuration
AtlantisGitHubUserOrgs: 63klabs,acme-org
GitHubTokenParameter: /atlantis/mcp/github-token

# Rate Limiting
PublicRateLimit: 1000

# Cache TTL (Production - Long TTLs)
CacheTTLTemplateList: 3600
CacheTTLTemplateDetail: 86400
CacheTTLTemplateVersions: 3600
CacheTTLStarterList: 3600
CacheTTLStarterDetail: 3600
CacheTTLDocumentationIndex: 21600
CacheTTLCodePatterns: 21600
CacheTTLGitHubMetadata: 1800
CacheTTLGitHubProperties: 3600
CacheTTLFullTemplateContent: 86400

# IAM Configuration
ReadLambdaExecRoleIncludeManagedPolicyArns: arn:aws:iam::123456789012:policy/CustomS3Access

# Logging
LogLevel: INFO
```

---

## Parameter Validation

CloudFormation validates parameters during stack creation/update. Common validation errors:

### Invalid Prefix Format

**Error:** `Parameter 'Prefix' must match pattern ^[a-z0-9][a-z0-9-]{0,20}[a-z0-9]$`

**Solution:** Use lowercase alphanumeric characters and hyphens only. Must start and end with alphanumeric.

### Invalid StageId

**Error:** `Parameter 'StageId' must be one of: test, beta, stage, prod`

**Solution:** Use only allowed stage values.

### Invalid S3 Bucket Names

**Error:** `S3 bucket does not exist or is not accessible`

**Solution:** Verify bucket names are correct and have required tags.

### Missing GitHub Token

**Error:** `SSM Parameter not found: /atlantis/mcp/github-token`

**Solution:** Create the SSM parameter before deploying.

---

## Environment-Specific Recommendations

### Test Environment

```yaml
StageId: test
PublicRateLimit: 500
LogLevel: DEBUG
# All Cache TTLs: 300 (5 minutes)
```

**Rationale:** Rapid iteration, detailed logging, frequent cache refreshes

### Beta/Stage Environment

```yaml
StageId: beta  # or stage
PublicRateLimit: 1000
LogLevel: INFO
# Cache TTLs: Production values
```

**Rationale:** Production-like configuration for final testing

### Production Environment

```yaml
StageId: prod
PublicRateLimit: 1000
LogLevel: INFO
# Cache TTLs: Production values (see defaults)
```

**Rationale:** Optimized for cost and performance

---

## Cost Optimization

Cache TTL parameters significantly impact costs:

**High TTL (Long Cache Duration):**
- ✅ Lower S3 API costs
- ✅ Lower GitHub API usage
- ✅ Faster response times
- ❌ Less fresh data

**Low TTL (Short Cache Duration):**
- ✅ Fresher data
- ❌ Higher S3 API costs
- ❌ Higher GitHub API usage
- ❌ Slower response times

**Recommendations:**
- Use long TTLs for infrequently changing data (templates, documentation)
- Use shorter TTLs for frequently changing data (GitHub metadata)
- Adjust based on actual usage patterns and cost analysis

---

## Related Documentation

- [Deployment Guide](./README.md)
- [S3 Bucket Tagging](./s3-bucket-tagging.md)
- [GitHub Token Setup](./github-token-setup.md)
- [GitHub Custom Properties](./github-custom-properties.md)
- [Multiple S3 Buckets](./multiple-s3-buckets.md)
- [Multiple GitHub Orgs](./multiple-github-orgs.md)
- [Self-Hosting Guide](./self-hosting.md)
