# Namespace Discovery and Priority Ordering

## Overview

The Atlantis MCP Server supports multiple S3 buckets and GitHub organizations with namespace-based organization and priority ordering. This document details how namespaces are discovered, how priority ordering works, and how to configure multi-source deployments.

## Namespace Concept

### What is a Namespace?

A **namespace** is a root-level directory in an S3 bucket that organizes templates and starters by department, team, or purpose.

**Example S3 bucket structure**:
```
my-templates-bucket/
├── atlantis/                    # Namespace: atlantis
│   ├── templates/v2/
│   │   ├── storage/
│   │   ├── network/
│   │   └── pipeline/
│   └── app-starters/v2/
├── finance/                     # Namespace: finance
│   ├── templates/v2/
│   │   └── storage/
│   └── app-starters/v2/
└── devops/                      # Namespace: devops
    ├── templates/v2/
    │   ├── pipeline/
    │   └── modules/
    └── app-starters/v2/
```

### Why Namespaces?

1. **Organization**: Separate templates by department or purpose
2. **Access Control**: Different teams can manage their own namespaces
3. **Customization**: Organizations can add custom templates alongside standard ones
4. **Isolation**: Changes in one namespace don't affect others
5. **Priority**: Control which templates take precedence

## S3 Bucket Configuration

### Bucket Tagging Requirements

For a bucket to be indexed by the MCP server, it must have two tags:

#### 1. atlantis-mcp:Allow Tag

**Purpose**: Explicitly allow the MCP server to access the bucket

**Format**: `atlantis-mcp:Allow=true`

**Example**:
```bash
aws s3api put-bucket-tagging \
  --bucket my-templates-bucket \
  --tagging 'TagSet=[{Key=atlantis-mcp:Allow,Value=true}]'
```

**Behavior**:
- If tag is missing or value is not `true`, bucket is skipped
- Warning is logged when bucket is skipped
- Error is added to response (brown-out support)

#### 2. atlantis-mcp:IndexPriority Tag

**Purpose**: Specify which namespaces to index and their priority order

**Format**: `atlantis-mcp:IndexPriority=namespace1,namespace2,namespace3`

**Example**:
```bash
aws s3api put-bucket-tagging \
  --bucket my-templates-bucket \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value=devops,finance,atlantis}
  ]'
```

**Behavior**:
- Only namespaces listed in this tag are indexed
- Order determines priority (first = highest priority)
- If tag is missing, bucket is skipped
- Warning is logged when tag is missing

### Checking Bucket Access

```javascript
// src/lambda/read/models/s3-templates.js

const checkBucketAccess = async (bucket) => {
  try {
    const { TagSet } = await s3.getBucketTagging({ Bucket: bucket });
    
    const allowTag = TagSet.find(tag => 
      tag.Key === 'atlantis-mcp:Allow' && tag.Value === 'true'
    );
    
    if (!allowTag) {
      DebugAndLog.warn(`Bucket ${bucket} missing atlantis-mcp:Allow=true tag`);
      return false;
    }
    
    return true;
  } catch (error) {
    if (error.code === 'NoSuchTagSet') {
      DebugAndLog.warn(`Bucket ${bucket} has no tags`);
      return false;
    }
    throw error;
  }
};
```

### Getting Indexed Namespaces

```javascript
const getIndexedNamespaces = async (bucket) => {
  try {
    const { TagSet } = await s3.getBucketTagging({ Bucket: bucket });
    
    const priorityTag = TagSet.find(tag => 
      tag.Key === 'atlantis-mcp:IndexPriority'
    );
    
    if (!priorityTag) {
      DebugAndLog.warn(`Bucket ${bucket} missing atlantis-mcp:IndexPriority tag`);
      return [];
    }
    
    // Parse comma-delimited list
    const namespaces = priorityTag.Value
      .split(',')
      .map(ns => ns.trim())
      .filter(ns => ns.length > 0);
    
    DebugAndLog.info(`Bucket ${bucket} namespaces: ${namespaces.join(', ')}`);
    return namespaces;
    
  } catch (error) {
    DebugAndLog.error(`Failed to get namespaces for bucket ${bucket}: ${error.message}`);
    return [];
  }
};
```

## Priority Ordering

### Multi-Level Priority

The MCP server uses a three-level priority system:

```
1. Bucket Priority (from ATLANTIS_S3_BUCKETS order)
   └─> 2. Namespace Priority (from atlantis-mcp:IndexPriority tag)
       └─> 3. Template Deduplication (first occurrence wins)
```

### Level 1: Bucket Priority

**Configuration**: Order of buckets in `ATLANTIS_S3_BUCKETS` environment variable

**Example**:
```bash
ATLANTIS_S3_BUCKETS=org-templates,team-templates,63klabs-templates
```

**Priority**: `org-templates` > `team-templates` > `63klabs-templates`

**Behavior**:
- Buckets are searched in order
- First bucket has highest priority
- If template exists in multiple buckets, first occurrence wins

### Level 2: Namespace Priority

**Configuration**: Order of namespaces in `atlantis-mcp:IndexPriority` tag

**Example**:
```
atlantis-mcp:IndexPriority=devops,finance,atlantis
```

**Priority**: `devops` > `finance` > `atlantis`

**Behavior**:
- Within each bucket, namespaces are searched in order
- First namespace has highest priority
- If template exists in multiple namespaces, first occurrence wins

### Level 3: Template Deduplication

**Logic**: First occurrence of a template (by name and category) wins

**Example**:
```
Bucket 1, Namespace devops: storage/s3-bucket.yml (v1.0.0)
Bucket 1, Namespace finance: storage/s3-bucket.yml (v1.1.0)  ← Skipped (duplicate)
Bucket 2, Namespace atlantis: storage/s3-bucket.yml (v2.0.0) ← Skipped (duplicate)

Result: storage/s3-bucket.yml v1.0.0 from Bucket 1, Namespace devops
```

### Priority Example

**Configuration**:
```bash
# Environment variable
ATLANTIS_S3_BUCKETS=acme-templates,63klabs-templates

# acme-templates bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=custom,atlantis

# 63klabs-templates bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=atlantis
```

**Search Order**:
1. acme-templates / custom
2. acme-templates / atlantis
3. 63klabs-templates / atlantis

**Template Resolution**:
```
Template: storage/s3-bucket.yml

Search:
1. acme-templates/custom/templates/v2/storage/s3-bucket.yml → Found! (v1.5.0)
2. acme-templates/atlantis/templates/v2/storage/s3-bucket.yml → Skipped (duplicate)
3. 63klabs-templates/atlantis/templates/v2/storage/s3-bucket.yml → Skipped (duplicate)

Result: v1.5.0 from acme-templates/custom
```

## Implementation

### Listing Templates with Priority

```javascript
// src/lambda/read/models/s3-templates.js

const list = async (connection, options = {}) => {
  const buckets = Array.isArray(connection.host) 
    ? connection.host 
    : [connection.host];
  
  const allTemplates = [];
  const errors = [];
  
  // Level 1: Iterate buckets in priority order
  for (const bucket of buckets) {
    try {
      // Check access
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        errors.push({ source: bucket, error: 'Access not allowed' });
        continue;
      }
      
      // Level 2: Get namespaces in priority order
      const namespaces = await getIndexedNamespaces(bucket);
      if (namespaces.length === 0) {
        errors.push({ source: bucket, error: 'No namespaces configured' });
        continue;
      }
      
      // Iterate namespaces in priority order
      for (const namespace of namespaces) {
        const prefix = `${namespace}/${connection.path}`;
        
        const response = await s3.listObjectsV2({
          Bucket: bucket,
          Prefix: prefix
        });
        
        const templates = (response.Contents || [])
          .filter(obj => obj.Key.endsWith('.yml') || obj.Key.endsWith('.yaml'))
          .map(obj => parseTemplateMetadata(obj, bucket, namespace));
        
        allTemplates.push(...templates);
      }
      
    } catch (error) {
      DebugAndLog.warn(`Failed to list from bucket ${bucket}: ${error.message}`);
      errors.push({ source: bucket, error: error.message });
    }
  }
  
  // Level 3: Deduplicate (first occurrence wins)
  const uniqueTemplates = deduplicateTemplates(allTemplates);
  
  return {
    templates: uniqueTemplates,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};
```

### Deduplication Logic

```javascript
const deduplicateTemplates = (templates) => {
  const seen = new Set();
  const unique = [];
  
  for (const template of templates) {
    // Create unique key from category and name
    const key = `${template.category}/${template.name}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(template);
    } else {
      DebugAndLog.debug(`Skipping duplicate template: ${key}`);
    }
  }
  
  return unique;
};
```

## GitHub Organization Priority

### Configuration

**Environment Variable**: `ATLANTIS_GITHUB_USER_ORGS`

**Format**: Comma-delimited list of GitHub users/orgs

**Example**:
```bash
ATLANTIS_GITHUB_USER_ORGS=acme-org,63klabs
```

**Priority**: `acme-org` > `63klabs`

### Implementation

```javascript
// src/lambda/read/models/github-api.js

const listRepositories = async (connection, options = {}) => {
  const orgs = Array.isArray(connection.host) 
    ? connection.host 
    : [connection.host];
  
  const allRepos = [];
  const errors = [];
  
  // Iterate orgs in priority order
  for (const org of orgs) {
    try {
      const repos = await fetchRepositories(org);
      allRepos.push(...repos);
    } catch (error) {
      DebugAndLog.warn(`Failed to list repos from org ${org}: ${error.message}`);
      errors.push({ source: org, error: error.message });
    }
  }
  
  // Deduplicate by repository name
  const uniqueRepos = deduplicateRepositories(allRepos);
  
  return {
    repositories: uniqueRepos,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};
```

## Configuration Examples

### Single Organization Deployment

**Use Case**: Small organization with one template bucket

**Configuration**:
```bash
# Environment variables
ATLANTIS_S3_BUCKETS=my-templates
ATLANTIS_GITHUB_USER_ORGS=my-org

# Bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=atlantis
```

**Behavior**:
- Single bucket, single namespace
- No priority conflicts
- Simple configuration

### Multi-Department Deployment

**Use Case**: Large organization with department-specific templates

**Configuration**:
```bash
# Environment variables
ATLANTIS_S3_BUCKETS=shared-templates
ATLANTIS_GITHUB_USER_ORGS=my-org

# Bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=finance,engineering,hr,atlantis
```

**Behavior**:
- Single bucket, multiple namespaces
- Department templates override standard templates
- Clear priority order

### Hybrid Deployment

**Use Case**: Organization templates + 63Klabs standard templates

**Configuration**:
```bash
# Environment variables
ATLANTIS_S3_BUCKETS=acme-templates,63klabs-templates
ATLANTIS_GITHUB_USER_ORGS=acme-org,63klabs

# acme-templates bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=custom,atlantis

# 63klabs-templates bucket tags
atlantis-mcp:Allow=true
atlantis-mcp:IndexPriority=atlantis
```

**Behavior**:
- Organization templates take priority
- Fall back to 63Klabs templates
- Custom namespace for organization-specific templates

## Namespace Metadata in Responses

### Template Metadata

Templates include namespace and bucket information:

```json
{
  "name": "s3-bucket",
  "category": "storage",
  "version": "v1.5.0",
  "namespace": "custom",
  "bucket": "acme-templates",
  "s3Path": "s3://acme-templates/custom/templates/v2/storage/s3-bucket.yml"
}
```

### Why Include Namespace?

1. **Transparency**: Users know where template came from
2. **Debugging**: Helps troubleshoot priority issues
3. **Auditing**: Track which templates are being used
4. **Documentation**: Reference correct source in docs

## Testing Priority Ordering

### Unit Tests

```javascript
describe('Priority ordering', () => {
  it('should prioritize first bucket', async () => {
    // Mock S3 with same template in multiple buckets
    mockS3.listObjectsV2
      .mockResolvedValueOnce({
        Contents: [{ Key: 'atlantis/templates/v2/storage/s3-bucket.yml' }]
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'atlantis/templates/v2/storage/s3-bucket.yml' }]
      });
    
    const result = await Models.S3Templates.list({
      host: ['bucket-1', 'bucket-2'],
      path: 'templates/v2'
    });
    
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].bucket).toBe('bucket-1');
  });
  
  it('should prioritize first namespace', async () => {
    // Mock S3 with same template in multiple namespaces
    mockS3.listObjectsV2.mockResolvedValueOnce({
      Contents: [
        { Key: 'custom/templates/v2/storage/s3-bucket.yml' },
        { Key: 'atlantis/templates/v2/storage/s3-bucket.yml' }
      ]
    });
    
    mockS3.getBucketTagging.mockResolvedValueOnce({
      TagSet: [
        { Key: 'atlantis-mcp:Allow', Value: 'true' },
        { Key: 'atlantis-mcp:IndexPriority', Value: 'custom,atlantis' }
      ]
    });
    
    const result = await Models.S3Templates.list({
      host: 'bucket-1',
      path: 'templates/v2'
    });
    
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].namespace).toBe('custom');
  });
});
```

## Troubleshooting

### Issue: Templates Not Found

**Symptoms**: Expected templates not appearing in list

**Investigation**:
1. Check bucket has `atlantis-mcp:Allow=true` tag
2. Check namespace is in `atlantis-mcp:IndexPriority` tag
3. Verify template path matches expected structure
4. Check CloudWatch logs for warnings

**Solutions**:
- Add missing tags to bucket
- Add namespace to IndexPriority tag
- Verify template directory structure
- Check bucket permissions

### Issue: Wrong Template Version

**Symptoms**: Getting older version instead of newer version

**Investigation**:
1. Check which bucket/namespace has priority
2. Verify template exists in expected location
3. Check deduplication logic

**Solutions**:
- Adjust bucket order in ATLANTIS_S3_BUCKETS
- Adjust namespace order in IndexPriority tag
- Remove duplicate from lower-priority source

### Issue: Bucket Skipped

**Symptoms**: Bucket not being searched

**Investigation**:
1. Check CloudWatch logs for warnings
2. Verify bucket tags
3. Check bucket permissions

**Solutions**:
- Add `atlantis-mcp:Allow=true` tag
- Add `atlantis-mcp:IndexPriority` tag with namespaces
- Grant Lambda function read permissions to bucket

## Best Practices

### DO

✅ Use descriptive namespace names (finance, engineering, custom)
✅ Document namespace purpose and ownership
✅ Set clear priority order in IndexPriority tag
✅ Test priority ordering with duplicate templates
✅ Include namespace in template metadata
✅ Log namespace discovery for debugging
✅ Use consistent namespace names across buckets

### DON'T

❌ Use generic namespace names (ns1, ns2, temp)
❌ Change namespace order frequently
❌ Forget to add IndexPriority tag
❌ Assume alphabetical ordering
❌ Mix namespace purposes (templates + other data)
❌ Create deeply nested namespace structures
❌ Use special characters in namespace names

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Brown-Out Support](./brown-out-support.md)
- [S3 Bucket Tagging](../deployment/s3-bucket-tagging.md)
- [Multiple S3 Buckets Configuration](../deployment/multiple-s3-buckets.md)
