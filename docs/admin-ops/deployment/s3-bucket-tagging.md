# S3 Bucket Tagging Guide

## Overview

The Atlantis MCP Server uses S3 bucket tags to control access and configure namespace indexing. Two tags are required for the MCP server to discover and index templates and starters from S3 buckets.

## Required Tags

### atlantis-mcp:Allow

**Purpose:** Controls whether the MCP server can access the bucket

**Required:** Yes  
**Type:** String  
**Allowed Values:** `true`, `false`

**Behavior:**
- `true` - MCP server will access this bucket
- `false` or missing - MCP server will skip this bucket and log a warning

**Use Cases:**
- Enable access to organizational template buckets
- Disable access to buckets under maintenance
- Control which buckets are indexed in different environments

---

### atlantis-mcp:IndexPriority

**Purpose:** Defines which namespaces to index and their priority order

**Required:** Yes (if `atlantis-mcp:Allow=true`)  
**Type:** String (comma-delimited list)  
**Format:** `namespace1,namespace2,namespace3`

**Behavior:**
- Only namespaces listed in this tag are indexed
- Order determines priority (first = highest priority)
- Namespaces not listed are skipped
- Empty or missing tag results in no namespaces being indexed

**Example Values:**
```
atlantis,finance,devops
```

**Priority Ordering:**
- `atlantis` - Highest priority (searched first)
- `finance` - Medium priority
- `devops` - Lowest priority

---

## Namespace Structure

Namespaces are root-level directories in S3 buckets that organize templates and starters:

```
s3://acme-atlantis-templates-us-east-1/
├── atlantis/
│   ├── templates/v2/
│   │   ├── storage/
│   │   ├── network/
│   │   └── pipeline/
│   └── app-starters/v2/
│       ├── atlantis-starter-01.zip
│       └── atlantis-starter-01.json
├── finance/
│   ├── templates/v2/
│   └── app-starters/v2/
└── devops/
    ├── templates/v2/
    └── app-starters/v2/
```

**Namespace Guidelines:**
- Use lowercase names
- Use hyphens for multi-word names
- Keep names short and descriptive
- Common namespaces: `atlantis`, `finance`, `devops`, `engineering`, `operations`

---

## Setting Bucket Tags

### Using AWS CLI

```bash
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance,devops"}
  ]'
```

### Using AWS Console

1. Navigate to **S3** in AWS Console
2. Select your bucket (e.g., `acme-atlantis-templates-us-east-1`)
3. Click **Properties** tab
4. Scroll to **Tags** section
5. Click **Edit**
6. Add tags:
   - Key: `atlantis-mcp:Allow`, Value: `true`
   - Key: `atlantis-mcp:IndexPriority`, Value: `atlantis,finance,devops`
7. Click **Save changes**

### Using CloudFormation

```yaml
Resources:
  TemplatesBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub ${Prefix}-atlantis-templates-${AWS::Region}
      Tags:
        - Key: atlantis-mcp:Allow
          Value: true
        - Key: atlantis-mcp:IndexPriority
          Value: atlantis,finance,devops
```

---

## Verifying Bucket Tags

### Using AWS CLI

```bash
# Get all tags for a bucket
aws s3api get-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1

# Check specific tag
aws s3api get-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --query 'TagSet[?Key==`atlantis-mcp:Allow`].Value' \
  --output text
```

Expected output:
```json
{
  "TagSet": [
    {
      "Key": "atlantis-mcp:Allow",
      "Value": "true"
    },
    {
      "Key": "atlantis-mcp:IndexPriority",
      "Value": "atlantis,finance,devops"
    }
  ]
}
```

---

## Multi-Bucket Configuration

When using multiple S3 buckets, configure tags on each bucket:

```bash
# Bucket 1: Primary Atlantis templates
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis"}
  ]'

# Bucket 2: Finance team templates
aws s3api put-bucket-tagging \
  --bucket acme-finance-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="finance"}
  ]'

# Bucket 3: DevOps team templates
aws s3api put-bucket-tagging \
  --bucket acme-devops-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="devops"}
  ]'
```

**Priority Ordering:**
- Bucket priority is determined by order in `AtlantisS3Buckets` CloudFormation parameter
- Namespace priority within each bucket is determined by `atlantis-mcp:IndexPriority` tag
- If a template exists in multiple buckets/namespaces, the first occurrence is used

---

## Common Scenarios

### Scenario 1: Single Bucket, Multiple Namespaces

**Use Case:** Organization with multiple teams sharing one bucket

**Configuration:**
```bash
aws s3api put-bucket-tagging \
  --bucket acme-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance,devops,engineering"}
  ]'
```

**CloudFormation Parameter:**
```yaml
AtlantisS3Buckets: acme-templates-us-east-1
```

---

### Scenario 2: Multiple Buckets, Single Namespace Each

**Use Case:** Separate buckets per team

**Configuration:**
```bash
# Atlantis bucket
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis"}
  ]'

# Finance bucket
aws s3api put-bucket-tagging \
  --bucket acme-finance-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="finance"}
  ]'
```

**CloudFormation Parameter:**
```yaml
AtlantisS3Buckets: acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1
```

---

### Scenario 3: Temporarily Disable Bucket

**Use Case:** Bucket under maintenance or migration

**Configuration:**
```bash
aws s3api put-bucket-tagging \
  --bucket acme-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=false},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis"}
  ]'
```

**Behavior:** MCP server will skip this bucket and log a warning

---

## IAM Permissions

The Lambda execution role needs permissions to read bucket tags:

```yaml
- Effect: Allow
  Action:
    - s3:GetBucketTagging
  Resource:
    - arn:aws:s3:::acme-atlantis-templates-us-east-1
    - arn:aws:s3:::acme-finance-templates-us-east-1
```

---

## Troubleshooting

### MCP Server Not Finding Templates

**Symptom:** Templates exist in S3 but MCP server returns empty list

**Diagnosis:**
```bash
# Check if bucket has required tags
aws s3api get-bucket-tagging --bucket your-bucket-name

# Check Lambda logs for warnings
aws logs tail /aws/lambda/acme-mcp-server-test-ReadFunction --follow
```

**Common Causes:**
1. Missing `atlantis-mcp:Allow=true` tag
2. Missing `atlantis-mcp:IndexPriority` tag
3. Namespace not listed in `IndexPriority` tag
4. Lambda role lacks `s3:GetBucketTagging` permission

**Solutions:**
```bash
# Add missing tags
aws s3api put-bucket-tagging \
  --bucket your-bucket-name \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis"}
  ]'
```

---

### Bucket Skipped with Warning

**Symptom:** CloudWatch logs show "Bucket does not have atlantis-mcp:Allow=true tag, skipping"

**Solution:**
```bash
# Verify tag value (case-sensitive)
aws s3api get-bucket-tagging --bucket your-bucket-name

# Correct tag value must be exactly "true" (lowercase)
aws s3api put-bucket-tagging \
  --bucket your-bucket-name \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true}
  ]'
```

---

### No Namespaces Indexed

**Symptom:** CloudWatch logs show "Bucket has no namespaces in IndexPriority tag, skipping"

**Solution:**
```bash
# Add IndexPriority tag with namespace list
aws s3api put-bucket-tagging \
  --bucket your-bucket-name \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance"}
  ]'
```

---

## Best Practices

### Tag Management

- ✅ Set tags during bucket creation
- ✅ Document namespace purposes
- ✅ Use consistent namespace names across buckets
- ✅ Review and audit tags quarterly
- ❌ Don't change namespace order frequently (affects caching)

### Namespace Organization

- ✅ Use team or department names for namespaces
- ✅ Keep namespace names short and descriptive
- ✅ Document namespace ownership
- ✅ Use separate namespaces for different template versions

### Security

- ✅ Limit who can modify bucket tags
- ✅ Use CloudFormation to manage tags (infrastructure as code)
- ✅ Audit tag changes using CloudTrail
- ❌ Don't expose sensitive information in namespace names

---

## Automation

### Bulk Tag Assignment Script

```bash
#!/bin/bash
# bulk-tag-buckets.sh

# Array of buckets and their configurations
declare -A BUCKETS=(
  ["acme-atlantis-templates-us-east-1"]="atlantis"
  ["acme-finance-templates-us-east-1"]="finance"
  ["acme-devops-templates-us-east-1"]="devops"
)

# Apply tags to all buckets
for bucket in "${!BUCKETS[@]}"; do
  namespaces="${BUCKETS[$bucket]}"
  echo "Tagging $bucket with namespaces: $namespaces"
  
  aws s3api put-bucket-tagging \
    --bucket "$bucket" \
    --tagging "TagSet=[
      {Key=atlantis-mcp:Allow,Value=true},
      {Key=atlantis-mcp:IndexPriority,Value=\"$namespaces\"}
    ]"
  
  echo "Done: $bucket"
done
```

Usage:
```bash
chmod +x bulk-tag-buckets.sh
./bulk-tag-buckets.sh
```

---

## Related Documentation

- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [CloudFormation Parameters Reference](./cloudformation-parameters.md)
- [Deployment Guide](./README.md)

## External Resources

- [AWS S3 Bucket Tagging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [AWS CLI S3 API Reference](https://docs.aws.amazon.com/cli/latest/reference/s3api/)
