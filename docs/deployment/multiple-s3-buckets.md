# Multiple S3 Bucket Configuration

## Overview

The Atlantis MCP Server supports multiple S3 buckets for templates and app starters, allowing organizations to use custom templates alongside 63klabs templates with priority ordering. This guide explains how to configure and manage multiple S3 buckets.

## Use Cases

Multiple S3 bucket support enables:

1. **Organization-specific templates**: Use custom templates alongside 63klabs templates
2. **Department isolation**: Separate templates by department (finance, devops, engineering)
3. **Environment separation**: Different buckets for test and production templates
4. **Multi-tenant deployments**: Support multiple organizations from a single MCP server
5. **Gradual migration**: Migrate from one bucket to another while maintaining access to both

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Atlantis MCP Server                        │
│                                                              │
│  AtlantisS3Buckets: "bucket1,bucket2,bucket3"              │
│                                                              │
│  Priority Order: 1 → 2 → 3                                  │
└──────────────────┬───────────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Bucket 1 │ │ Bucket 2 │ │ Bucket 3 │
│ Priority │ │ Priority │ │ Priority │
│    1     │ │    2     │ │    3     │
└──────────┘ └──────────┘ └──────────┘
│          │ │          │ │          │
│ atlantis │ │ finance  │ │ devops   │
│ finance  │ │ devops   │ │ custom   │
└──────────┘ └──────────┘ └──────────┘
```

## Configuration

### CloudFormation Parameter

Configure multiple S3 buckets using the `AtlantisS3Buckets` parameter:

```yaml
Parameters:
  AtlantisS3Buckets:
    Type: CommaDelimitedList
    Default: "acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1,acme-devops-templates-us-east-1"
    Description: Comma-delimited list of S3 buckets containing templates and starters
```

### Priority Ordering

The order of buckets in the comma-delimited list determines search priority:

```
Bucket 1 (highest priority) → Bucket 2 → Bucket 3 (lowest priority)
```

When searching for templates or starters:
1. MCP server searches Bucket 1 first
2. If not found, searches Bucket 2
3. If not found, searches Bucket 3
4. If found in multiple buckets, uses the version from the highest priority bucket

## Bucket Requirements

### Required Tags

Each S3 bucket MUST have these tags:

#### 1. atlantis-mcp:Allow

Grants permission for the MCP server to access the bucket:

```bash
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[{Key=atlantis-mcp:Allow,Value=true}]'
```

**Without this tag, the bucket will be skipped.**

#### 2. atlantis-mcp:IndexPriority

Specifies which namespaces to index and their priority order:

```bash
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance,devops"}
  ]'
```

**Format**: Comma-delimited list of namespace names (no spaces)

**Priority**: Order in the list determines namespace priority within the bucket

### Bucket Structure

Each bucket must follow the Atlantis directory structure:

```
s3://bucket-name/
├── atlantis/                          # Namespace
│   ├── templates/v2/
│   │   ├── storage/
│   │   │   └── template-storage-s3.yml
│   │   ├── network/
│   │   └── pipeline/
│   └── app-starters/v2/
│       ├── atlantis-starter-express.zip
│       └── atlantis-starter-express.json
├── finance/                           # Namespace
│   ├── templates/v2/
│   └── app-starters/v2/
└── devops/                            # Namespace
    ├── templates/v2/
    └── app-starters/v2/
```

## Configuration Examples

### Example 1: Organization + 63klabs Templates

Use organization-specific templates with 63klabs templates as fallback:

```yaml
AtlantisS3Buckets: "acme-templates-us-east-1,63klabs-atlantis-templates-us-east-1"
```

**Bucket 1** (acme-templates-us-east-1):
```bash
aws s3api put-bucket-tagging \
  --bucket acme-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="acme,finance,devops"}
  ]'
```

**Bucket 2** (63klabs-atlantis-templates-us-east-1):
```bash
aws s3api put-bucket-tagging \
  --bucket 63klabs-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis"}
  ]'
```

**Result**: Organization templates take priority, 63klabs templates used as fallback

### Example 2: Department-Specific Buckets

Separate buckets for different departments:

```yaml
AtlantisS3Buckets: "acme-finance-templates-us-east-1,acme-devops-templates-us-east-1,acme-engineering-templates-us-east-1"
```

**Finance Bucket**:
```bash
aws s3api put-bucket-tagging \
  --bucket acme-finance-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="finance,shared"}
  ]'
```

**DevOps Bucket**:
```bash
aws s3api put-bucket-tagging \
  --bucket acme-devops-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="devops,shared"}
  ]'
```

**Engineering Bucket**:
```bash
aws s3api put-bucket-tagging \
  --bucket acme-engineering-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="engineering,shared"}
  ]'
```

### Example 3: Test and Production Separation

Different buckets for test and production environments:

```yaml
# Test environment
AtlantisS3Buckets: "acme-templates-test-us-east-1,63klabs-atlantis-templates-us-east-1"

# Production environment
AtlantisS3Buckets: "acme-templates-prod-us-east-1,63klabs-atlantis-templates-us-east-1"
```

### Example 4: Multi-Region Buckets

Use buckets from multiple regions (requires cross-region access):

```yaml
AtlantisS3Buckets: "acme-templates-us-east-1,acme-templates-eu-west-1,acme-templates-ap-southeast-1"
```

**Note**: Ensure Lambda execution role has permissions for all regions.

## Namespace Priority

### Per-Bucket Namespace Priority

The `atlantis-mcp:IndexPriority` tag defines namespace priority WITHIN each bucket:

```
Bucket 1: atlantis-mcp:IndexPriority = "finance,devops,atlantis"
  Priority: finance (1) → devops (2) → atlantis (3)

Bucket 2: atlantis-mcp:IndexPriority = "atlantis,finance"
  Priority: atlantis (1) → finance (2)
```

### Cross-Bucket Priority

When the same namespace exists in multiple buckets, bucket priority takes precedence:

```
Bucket 1 (priority 1): namespaces = "finance,devops"
Bucket 2 (priority 2): namespaces = "finance,atlantis"

Search order for "finance" namespace:
  1. Bucket 1 / finance (highest priority)
  2. Bucket 2 / finance (lower priority)
```

### Combined Priority Example

```yaml
AtlantisS3Buckets: "bucket-a,bucket-b,bucket-c"
```

**Bucket A** (priority 1):
- Namespaces: "acme,finance" (acme=1, finance=2)

**Bucket B** (priority 2):
- Namespaces: "finance,devops" (finance=1, devops=2)

**Bucket C** (priority 3):
- Namespaces: "atlantis" (atlantis=1)

**Effective search order**:
1. Bucket A / acme
2. Bucket A / finance
3. Bucket B / finance
4. Bucket B / devops
5. Bucket C / atlantis

## Template Deduplication

When the same template exists in multiple buckets, the MCP server uses the version from the highest priority bucket:

```
Bucket 1: templates/v2/storage/template-storage-s3.yml (v2.0.5)
Bucket 2: templates/v2/storage/template-storage-s3.yml (v2.0.3)

Result: Uses v2.0.5 from Bucket 1 (higher priority)
```

**Deduplication rules**:
- Templates are identified by: `{namespace}/{category}/{templateName}`
- First occurrence (highest priority bucket) wins
- Lower priority versions are ignored
- Metadata includes source bucket information

## IAM Permissions

### Lambda Execution Role

The Lambda execution role must have permissions for ALL configured buckets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:GetBucketTagging"
      ],
      "Resource": [
        "arn:aws:s3:::acme-templates-us-east-1",
        "arn:aws:s3:::acme-templates-us-east-1/*",
        "arn:aws:s3:::acme-finance-templates-us-east-1",
        "arn:aws:s3:::acme-finance-templates-us-east-1/*",
        "arn:aws:s3:::63klabs-atlantis-templates-us-east-1",
        "arn:aws:s3:::63klabs-atlantis-templates-us-east-1/*"
      ]
    }
  ]
}
```

### Cross-Account Access

For buckets in different AWS accounts, configure bucket policies:

**Bucket Policy** (in bucket account):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/acme-mcp-server-prod-ReadLambdaExecRole"
      },
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:ListBucket",
        "s3:GetBucketTagging"
      ],
      "Resource": [
        "arn:aws:s3:::shared-templates-bucket",
        "arn:aws:s3:::shared-templates-bucket/*"
      ]
    }
  ]
}
```

## Brown-Out Support

The MCP server implements brown-out support for partial data availability:

### Behavior

When one or more buckets fail:
- MCP server continues searching remaining buckets
- Returns available data from working buckets
- Includes error information in response
- Logs detailed error information to CloudWatch

### Example Response

```json
{
  "templates": [
    {
      "name": "template-storage-s3.yml",
      "namespace": "atlantis",
      "bucket": "acme-templates-us-east-1",
      "version": "v2.0.5"
    }
  ],
  "errors": [
    {
      "bucket": "acme-finance-templates-us-east-1",
      "error": "Access Denied",
      "message": "Bucket does not have atlantis-mcp:Allow tag"
    }
  ],
  "partial": true
}
```

### Monitoring

Monitor brown-out scenarios using CloudWatch Logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/acme-mcp-server-prod-ReadFunction \
  --filter-pattern "WARN" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

## Filtering by Bucket

### Service Layer Filtering

Services support optional `s3Buckets` filtering:

```javascript
// List templates from specific buckets only
const templates = await TemplatesService.list({
  s3Buckets: ['acme-templates-us-east-1', 'acme-finance-templates-us-east-1']
});
```

### MCP Tool Usage

Users can filter by bucket when calling MCP tools:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "list_templates",
    "arguments": {
      "s3Buckets": ["acme-templates-us-east-1"]
    }
  }
}
```

## Testing Multiple Buckets

### Verify Bucket Access

Test bucket access and tag configuration:

```bash
# Check bucket 1
aws s3api get-bucket-tagging --bucket acme-templates-us-east-1

# Check bucket 2
aws s3api get-bucket-tagging --bucket acme-finance-templates-us-east-1

# List objects in bucket 1
aws s3 ls s3://acme-templates-us-east-1/atlantis/templates/v2/ --recursive

# List objects in bucket 2
aws s3 ls s3://acme-finance-templates-us-east-1/finance/templates/v2/ --recursive
```

### Test Priority Ordering

Create test templates in multiple buckets:

```bash
# Upload to bucket 1 (higher priority)
aws s3 cp test-template-v2.yml s3://acme-templates-us-east-1/atlantis/templates/v2/storage/test-template.yml

# Upload to bucket 2 (lower priority)
aws s3 cp test-template-v1.yml s3://acme-finance-templates-us-east-1/atlantis/templates/v2/storage/test-template.yml

# Query MCP server - should return v2 from bucket 1
curl -X POST https://your-api-endpoint/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_template",
      "arguments": {
        "templateName": "test-template.yml",
        "category": "storage"
      }
    }
  }'
```

## Troubleshooting

### Issue: Bucket is skipped

**Symptoms**: Templates from a bucket are not returned

**Solutions**:
1. Verify `atlantis-mcp:Allow=true` tag exists:
   ```bash
   aws s3api get-bucket-tagging --bucket your-bucket-name
   ```

2. Check CloudWatch Logs for warnings:
   ```bash
   aws logs tail /aws/lambda/your-function-name --follow
   ```

3. Verify Lambda execution role has S3 permissions

### Issue: Wrong template version returned

**Symptoms**: Lower priority template is returned instead of higher priority

**Solutions**:
1. Verify bucket order in `AtlantisS3Buckets` parameter
2. Check namespace priority in `atlantis-mcp:IndexPriority` tag
3. Verify template exists in higher priority bucket

### Issue: Access Denied errors

**Symptoms**: Brown-out responses with "Access Denied" errors

**Solutions**:
1. Verify Lambda execution role has permissions for all buckets
2. For cross-account buckets, verify bucket policy allows access
3. Check bucket encryption settings (KMS key permissions)

### Issue: Namespace not indexed

**Symptoms**: Templates in a namespace are not returned

**Solutions**:
1. Verify namespace is listed in `atlantis-mcp:IndexPriority` tag
2. Check namespace directory exists in S3 bucket
3. Verify namespace name matches exactly (case-sensitive)

## Best Practices

1. **Use descriptive bucket names**: Include organization, purpose, and region
2. **Document bucket purpose**: Add description tags to buckets
3. **Monitor bucket access**: Set up CloudWatch alarms for access errors
4. **Test priority ordering**: Verify templates are returned from correct buckets
5. **Use versioning**: Enable S3 versioning on all template buckets
6. **Implement lifecycle policies**: Archive old template versions
7. **Regular audits**: Review bucket configurations quarterly
8. **Document namespace structure**: Maintain documentation of namespace purposes

## Next Steps

- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)
- [S3 Bucket Tagging](./s3-bucket-tagging.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- Documentation: [README.md](../../README.md)
