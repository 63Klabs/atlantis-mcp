# Template Versioning with Dual Identifiers

## Overview

The Atlantis MCP Server supports template versioning using two complementary identifier systems:
1. **Human_Readable_Version**: Semantic version from template comments (e.g., v1.2.3/2026-01-29)
2. **S3_VersionId**: AWS S3 bucket versioning identifier (e.g., abc123def456)

This dual-identifier approach provides both human-friendly version references and immutable version tracking.

## Why Dual Identifiers?

### Human_Readable_Version Benefits
- **Semantic Meaning**: Conveys compatibility and change significance
- **Easy Communication**: "Use version 2.1.0" is clearer than "Use version abc123"
- **Documentation**: Can reference versions in guides and tutorials
- **Change Tracking**: Date component shows when version was created

### S3_VersionId Benefits
- **Immutability**: Cannot be changed or reused
- **Uniqueness**: Guaranteed unique across all versions
- **S3 Integration**: Direct S3 API support for retrieval
- **Audit Trail**: Complete version history in S3

### Combined Power
- **Flexibility**: Users can reference by either identifier
- **Precision**: S3_VersionId for exact version, Human_Readable_Version for semantic version
- **OR Condition**: When both provided, match either (useful for migration scenarios)

## Human_Readable_Version Format

### Format Specification

```
vMAJOR.MINOR.PATCH/YYYY-MM-DD
```

**Components**:
- `v`: Version prefix (required)
- `MAJOR.MINOR.PATCH`: Semantic version number
- `/`: Separator
- `YYYY-MM-DD`: ISO 8601 date

**Examples**:
- `v1.0.0/2026-01-15`
- `v2.3.1/2026-02-20`
- `v10.5.12/2026-12-31`

### Template Comment Format

Human_Readable_Version is extracted from template comments:

```yaml
# CloudFormation Template: S3 Bucket
# Version: v1.2.3/2026-01-29
# Description: Creates an S3 bucket with encryption and versioning
# Author: Platform Team
# Last Modified: 2026-01-29

AWSTemplateFormatVersion: '2010-09-09'
Description: S3 bucket with encryption and versioning

Parameters:
  # ...
```

### Parsing Logic

```javascript
// src/lambda/read/models/s3-templates.js

const parseHumanReadableVersion = (templateContent) => {
  // Match: # Version: vX.Y.Z/YYYY-MM-DD
  const versionRegex = /#\s*Version:\s*(v\d+\.\d+\.\d+\/\d{4}-\d{2}-\d{2})/i;
  const match = templateContent.match(versionRegex);
  
  if (match) {
    return match[1];  // e.g., "v1.2.3/2026-01-29"
  }
  
  return null;  // Version not found
};
```

### Semantic Versioning Rules

Follow semantic versioning for MAJOR.MINOR.PATCH:

| Change Type | Version Bump | Example |
|------------|--------------|---------|
| **Breaking Change** | MAJOR | v1.5.2 → v2.0.0 |
| **New Feature** | MINOR | v1.5.2 → v1.6.0 |
| **Bug Fix** | PATCH | v1.5.2 → v1.5.3 |

**Breaking Changes**:
- Parameter name changes
- Parameter type changes
- Output name changes
- Resource logical ID changes
- Required parameter additions

**New Features**:
- New optional parameters
- New outputs
- New resources (non-breaking)
- Enhanced functionality

**Bug Fixes**:
- Corrected default values
- Fixed resource properties
- Documentation updates

## S3_VersionId

### S3 Bucket Versioning

Enable versioning on template buckets:

```bash
aws s3api put-bucket-versioning \
  --bucket my-templates-bucket \
  --versioning-configuration Status=Enabled
```

### Version ID Format

S3 generates unique version IDs:
- Format: Alphanumeric string (e.g., `3/L4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY+MTRCxf3vjVBH40Nr8X8gdRQBpUMLUo`)
- Length: Variable (typically 32-100 characters)
- Uniqueness: Guaranteed unique within bucket

### Retrieving Specific Version

```javascript
// Get template by S3_VersionId
const getTemplateByVersionId = async (bucket, key, versionId) => {
  const response = await s3.getObject({
    Bucket: bucket,
    Key: key,
    VersionId: versionId
  });
  
  return {
    content: response.Body.toString('utf-8'),
    versionId: response.VersionId,
    lastModified: response.LastModified,
    etag: response.ETag
  };
};
```

## Dual Identifier API

### get_template Tool

The `get_template` tool accepts both identifiers:

```javascript
// Get by Human_Readable_Version
{
  "tool": "get_template",
  "input": {
    "templateName": "s3-bucket",
    "category": "storage",
    "version": "v1.2.3/2026-01-29"
  }
}

// Get by S3_VersionId
{
  "tool": "get_template",
  "input": {
    "templateName": "s3-bucket",
    "category": "storage",
    "versionId": "abc123def456"
  }
}

// Get by either (OR condition)
{
  "tool": "get_template",
  "input": {
    "templateName": "s3-bucket",
    "category": "storage",
    "version": "v1.2.3/2026-01-29",
    "versionId": "abc123def456"
  }
}
```

### OR Condition Logic

When both identifiers are provided, match either:

```javascript
// src/lambda/read/models/s3-templates.js

const get = async (connection, options = {}) => {
  const { category, templateName, version, versionId } = connection.parameters;
  
  // Build S3 key
  const key = `${namespace}/templates/v2/${category}/${templateName}.yml`;
  
  // If versionId specified, use it directly
  if (versionId) {
    const template = await getTemplateByVersionId(bucket, key, versionId);
    
    // If version also specified, check if it matches
    if (version) {
      const humanVersion = parseHumanReadableVersion(template.content);
      if (humanVersion === version || template.versionId === versionId) {
        return template;  // Either matches (OR condition)
      }
      return null;  // Neither matches
    }
    
    return template;  // Only versionId specified
  }
  
  // If only version specified, find matching version
  if (version) {
    return await findTemplateByVersion(bucket, key, version);
  }
  
  // Neither specified, get latest
  return await getLatestTemplate(bucket, key);
};
```

### Use Cases for OR Condition

1. **Migration**: Transitioning from version to versionId references
2. **Validation**: Verify version and versionId refer to same template
3. **Flexibility**: Allow users to specify either or both

## Version History

### list_template_versions Tool

List all versions of a template:

```javascript
{
  "tool": "list_template_versions",
  "input": {
    "templateName": "s3-bucket",
    "category": "storage"
  }
}
```

**Response**:
```json
{
  "tool": "list_template_versions",
  "result": {
    "templateName": "s3-bucket",
    "category": "storage",
    "versions": [
      {
        "humanReadableVersion": "v1.2.3/2026-01-29",
        "s3VersionId": "abc123def456",
        "lastModified": "2026-01-29T10:30:00Z",
        "size": 2048,
        "isLatest": true
      },
      {
        "humanReadableVersion": "v1.2.2/2026-01-15",
        "s3VersionId": "xyz789ghi012",
        "lastModified": "2026-01-15T14:20:00Z",
        "size": 2010,
        "isLatest": false
      }
    ]
  }
}
```

### Implementation

```javascript
// src/lambda/read/models/s3-templates.js

const listVersions = async (connection, options = {}) => {
  const { category, templateName } = connection.parameters;
  const key = `${namespace}/templates/v2/${category}/${templateName}.yml`;
  
  // Use S3 ListObjectVersions API
  const response = await s3.listObjectVersions({
    Bucket: bucket,
    Prefix: key
  });
  
  const versions = [];
  
  for (const version of response.Versions || []) {
    // Get template content to extract Human_Readable_Version
    const template = await s3.getObject({
      Bucket: bucket,
      Key: key,
      VersionId: version.VersionId
    });
    
    const content = template.Body.toString('utf-8');
    const humanVersion = parseHumanReadableVersion(content);
    
    versions.push({
      humanReadableVersion: humanVersion,
      s3VersionId: version.VersionId,
      lastModified: version.LastModified,
      size: version.Size,
      isLatest: version.IsLatest
    });
  }
  
  // Sort by lastModified (newest first)
  versions.sort((a, b) => 
    new Date(b.lastModified) - new Date(a.lastModified)
  );
  
  return { versions };
};
```

## Template Metadata

### Complete Metadata Structure

```javascript
{
  name: 's3-bucket',
  category: 'storage',
  version: 'v1.2.3/2026-01-29',           // Human_Readable_Version
  versionId: 'abc123def456',               // S3_VersionId
  namespace: 'atlantis',
  bucket: 'my-templates-bucket',
  s3Path: 's3://my-templates-bucket/atlantis/templates/v2/storage/s3-bucket.yml',
  lastModified: '2026-01-29T10:30:00Z',
  size: 2048,
  description: 'S3 bucket with encryption and versioning',
  parameters: { /* CloudFormation parameters */ },
  outputs: { /* CloudFormation outputs */ }
}
```

## Version Comparison

### Comparing Versions

```javascript
const compareVersions = (v1, v2) => {
  // Parse versions: v1.2.3/2026-01-29
  const parseVersion = (v) => {
    const match = v.match(/v(\d+)\.(\d+)\.(\d+)\/(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      date: match[4]
    };
  };
  
  const ver1 = parseVersion(v1);
  const ver2 = parseVersion(v2);
  
  if (!ver1 || !ver2) return 0;
  
  // Compare major.minor.patch
  if (ver1.major !== ver2.major) return ver1.major - ver2.major;
  if (ver1.minor !== ver2.minor) return ver1.minor - ver2.minor;
  if (ver1.patch !== ver2.patch) return ver1.patch - ver2.patch;
  
  // If versions equal, compare dates
  return ver1.date.localeCompare(ver2.date);
};

// Usage
if (compareVersions('v1.2.3/2026-01-29', 'v1.2.2/2026-01-15') > 0) {
  console.log('v1.2.3 is newer');
}
```

## Update Checking

### check_template_updates Tool

Check if newer version is available:

```javascript
{
  "tool": "check_template_updates",
  "input": {
    "templateName": "s3-bucket",
    "category": "storage",
    "currentVersion": "v1.2.2/2026-01-15"
  }
}
```

**Response**:
```json
{
  "tool": "check_template_updates",
  "result": {
    "updateAvailable": true,
    "currentVersion": "v1.2.2/2026-01-15",
    "latestVersion": "v1.2.3/2026-01-29",
    "changeType": "patch",
    "releaseDate": "2026-01-29",
    "changelog": "Fixed default encryption settings",
    "breakingChanges": false
  }
}
```

## Best Practices

### DO

✅ Include Human_Readable_Version in all template comments
✅ Follow semantic versioning rules
✅ Enable S3 bucket versioning
✅ Include both identifiers in responses
✅ Support OR condition for flexibility
✅ Document version changes in changelog
✅ Test version retrieval by both identifiers

### DON'T

❌ Reuse version numbers
❌ Skip version numbers (e.g., v1.0.0 → v1.0.2)
❌ Change version format
❌ Rely solely on S3_VersionId for user communication
❌ Forget to update version in template comments
❌ Use non-semantic version numbers
❌ Disable S3 bucket versioning

## Troubleshooting

### Issue: Version Not Found

**Symptoms**: Template exists but version not found

**Investigation**:
1. Check template comment format
2. Verify version string matches format
3. Check S3 bucket versioning enabled

**Solutions**:
- Fix version comment format
- Enable S3 bucket versioning
- Verify template uploaded correctly

### Issue: Version Mismatch

**Symptoms**: Human_Readable_Version doesn't match expected S3_VersionId

**Investigation**:
1. List all versions
2. Compare version metadata
3. Check for manual edits

**Solutions**:
- Use correct version identifier
- Re-upload template with correct version
- Update version in template comments

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Namespace Discovery](./namespace-discovery.md)
- [CloudFormation Parameters](../deployment/cloudformation-parameters.md)
