# Brown-Out Support Implementation

## Overview

Brown-out support is a resilience pattern that allows the Atlantis MCP Server to continue operating and return partial data when some data sources fail. Instead of failing completely when one S3 bucket or GitHub organization is unavailable, the system logs the error, continues processing other sources, and returns available data with error information.

This document details the implementation, patterns, and best practices for brown-out support.

## What is Brown-Out Support?

### Traditional Fail-Fast Approach

```javascript
// ❌ Fail-fast: One failure stops everything
const fetchFromAllSources = async (sources) => {
  const results = [];
  for (const source of sources) {
    const data = await fetchFromSource(source);  // Throws on error
    results.push(data);
  }
  return results;
};

// If source 2 fails, user gets nothing
```

### Brown-Out Approach

```javascript
// ✅ Brown-out: Continue on failures, return partial data
const fetchFromAllSources = async (sources) => {
  const results = [];
  const errors = [];
  
  for (const source of sources) {
    try {
      const data = await fetchFromSource(source);
      results.push(data);
    } catch (error) {
      // Log error but continue
      DebugAndLog.warn(`Source ${source} failed: ${error.message}`);
      errors.push({ source, error: error.message });
    }
  }
  
  return {
    data: results,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};

// If source 2 fails, user still gets data from sources 1 and 3
```

## Why Brown-Out Support?

### Benefits

1. **Improved Availability**: Service remains available even when some sources fail
2. **Better User Experience**: Users get partial results instead of complete failure
3. **Graceful Degradation**: System degrades gracefully under partial failures
4. **Operational Visibility**: Errors are logged for investigation without blocking users
5. **Multi-Source Resilience**: Particularly valuable with multiple S3 buckets and GitHub orgs

### Use Cases

- **S3 Bucket Unavailable**: One bucket has permission issues, others work fine
- **GitHub API Rate Limited**: One org is rate limited, others still accessible
- **Network Issues**: Transient network errors to specific sources
- **Configuration Errors**: One bucket misconfigured, others configured correctly
- **Partial Outages**: AWS regional issues affecting some buckets but not others

## Implementation Pattern

### Model Layer (DAO) Implementation

The model layer implements brown-out support when fetching from multiple sources:

```javascript
// src/lambda/read/models/s3-templates.js

const list = async (connection, options = {}) => {
  const buckets = Array.isArray(connection.host) 
    ? connection.host 
    : [connection.host];
  
  const allTemplates = [];
  const errors = [];
  
  // Iterate through buckets in priority order
  for (const bucket of buckets) {
    try {
      // Check bucket access
      const allowAccess = await checkBucketAccess(bucket);
      if (!allowAccess) {
        DebugAndLog.warn(`Bucket ${bucket} does not have atlantis-mcp:Allow=true tag`);
        errors.push({
          source: bucket,
          sourceType: 's3',
          error: 'Bucket access not allowed',
          timestamp: new Date().toISOString()
        });
        continue;  // Continue to next bucket
      }
      
      // Get namespaces
      const namespaces = await getIndexedNamespaces(bucket);
      if (namespaces.length === 0) {
        DebugAndLog.warn(`Bucket ${bucket} has no namespaces in IndexPriority tag`);
        continue;
      }
      
      // List templates from each namespace
      for (const namespace of namespaces) {
        const templates = await listTemplatesFromNamespace(bucket, namespace);
        allTemplates.push(...templates);
      }
      
    } catch (error) {
      // Brown-out support: log error but continue with other buckets
      DebugAndLog.warn(`Failed to list templates from bucket ${bucket}: ${error.message}`);
      errors.push({
        source: bucket,
        sourceType: 's3',
        error: error.message,
        errorCode: error.code,
        timestamp: new Date().toISOString()
      });
      // Continue to next bucket instead of throwing
    }
  }
  
  // Deduplicate templates (first occurrence wins due to priority ordering)
  const uniqueTemplates = deduplicateTemplates(allTemplates);
  
  // Return results with error information
  return {
    templates: uniqueTemplates,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};
```

### Key Implementation Elements

1. **Try-Catch Per Source**: Wrap each source fetch in try-catch
2. **Continue on Error**: Use `continue` instead of `throw` when source fails
3. **Error Collection**: Collect errors in array for reporting
4. **Partial Data Flag**: Set flag when any source fails
5. **Logging**: Log warnings for failed sources
6. **Error Details**: Include source, error message, timestamp

## Error Information Structure

### Error Object Format

```javascript
{
  source: 'bucket-name' | 'github-org-name',
  sourceType: 's3' | 'github',
  error: 'Human-readable error message',
  errorCode: 'AWS_ERROR_CODE' | 'GITHUB_ERROR_CODE',
  timestamp: '2026-01-29T12:34:56.789Z'
}
```

### Response Format with Errors

```javascript
{
  templates: [
    { name: 'template1', ... },
    { name: 'template2', ... }
  ],
  errors: [
    {
      source: 'bucket-2',
      sourceType: 's3',
      error: 'Access Denied',
      errorCode: 'AccessDenied',
      timestamp: '2026-01-29T12:34:56.789Z'
    }
  ],
  partialData: true
}
```

## Logging Strategy

### Log Levels

Use appropriate log levels for brown-out scenarios:

```javascript
// ERROR: Use for fatal errors that prevent all data retrieval
DebugAndLog.error('All sources failed', { errors });

// WARN: Use for non-fatal errors where partial data is available
DebugAndLog.warn('Source failed but continuing', { source, error });

// INFO: Use for informational messages about source status
DebugAndLog.info('Source skipped due to configuration', { source, reason });
```

### Log Format

```javascript
DebugAndLog.warn('S3 bucket access failed', {
  bucket: 'my-bucket',
  error: error.message,
  errorCode: error.code,
  operation: 'listTemplates',
  timestamp: Date.now()
});
```

### What to Log

**DO Log**:
- Source identifier (bucket name, org name)
- Error message
- Error code
- Operation being performed
- Timestamp

**DON'T Log**:
- Sensitive credentials
- Full stack traces in production (use debug level)
- User-identifiable information
- Internal implementation details

## Service Layer Handling

The service layer passes through error information from models:

```javascript
// src/lambda/read/services/templates.js

const list = async (options = {}) => {
  // ... cache setup ...
  
  const fetchFunction = async (connection, opts) => {
    return await Models.S3Templates.list(connection, opts);
  };
  
  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}
  );
  
  // result.body contains { templates, errors, partialData }
  return result.body;
};
```

**Note**: Service layer doesn't need special handling - just passes through the error information from the model layer.

## Controller Layer Handling

The controller layer includes error information in MCP responses:

```javascript
// src/lambda/read/controllers/templates.js

const list = async (props) => {
  // ... validation ...
  
  const result = await Services.Templates.list({ category, version });
  
  // Format MCP response with error information
  return MCPProtocol.successResponse('list_templates', {
    templates: result.templates,
    count: result.templates.length,
    partialData: result.partialData,
    errors: result.errors
  });
};
```

## MCP Protocol Response Format

### Success with Partial Data

```json
{
  "tool": "list_templates",
  "result": {
    "templates": [
      { "name": "template1", "category": "storage" },
      { "name": "template2", "category": "network" }
    ],
    "count": 2,
    "partialData": true,
    "errors": [
      {
        "source": "bucket-2",
        "sourceType": "s3",
        "error": "Access Denied",
        "timestamp": "2026-01-29T12:34:56.789Z"
      }
    ]
  },
  "status": "success"
}
```

### Complete Failure (All Sources Failed)

```json
{
  "tool": "list_templates",
  "error": {
    "code": "ALL_SOURCES_FAILED",
    "message": "All data sources failed",
    "details": {
      "errors": [
        {
          "source": "bucket-1",
          "sourceType": "s3",
          "error": "Access Denied"
        },
        {
          "source": "bucket-2",
          "sourceType": "s3",
          "error": "Bucket not found"
        }
      ]
    }
  },
  "status": "error"
}
```

## GitHub API Brown-Out Support

### GitHub-Specific Considerations

```javascript
// src/lambda/read/models/github-api.js

const listRepositories = async (connection, options = {}) => {
  const orgs = Array.isArray(connection.host) 
    ? connection.host 
    : [connection.host];
  
  const allRepos = [];
  const errors = [];
  
  for (const org of orgs) {
    try {
      // Check rate limits before making request
      const rateLimit = await checkRateLimit();
      if (rateLimit.remaining === 0) {
        DebugAndLog.warn(`GitHub API rate limit exceeded for org ${org}`);
        errors.push({
          source: org,
          sourceType: 'github',
          error: 'Rate limit exceeded',
          resetTime: new Date(rateLimit.reset * 1000).toISOString()
        });
        continue;
      }
      
      // Fetch repositories
      const repos = await fetchRepositories(org);
      allRepos.push(...repos);
      
    } catch (error) {
      // Handle GitHub-specific errors
      if (error.status === 404) {
        DebugAndLog.warn(`GitHub org ${org} not found`);
        errors.push({
          source: org,
          sourceType: 'github',
          error: 'Organization not found',
          errorCode: 'NOT_FOUND'
        });
      } else if (error.status === 403) {
        DebugAndLog.warn(`GitHub API rate limited for org ${org}`);
        errors.push({
          source: org,
          sourceType: 'github',
          error: 'Rate limit exceeded',
          errorCode: 'RATE_LIMITED'
        });
      } else {
        DebugAndLog.warn(`GitHub API error for org ${org}: ${error.message}`);
        errors.push({
          source: org,
          sourceType: 'github',
          error: error.message,
          errorCode: error.status
        });
      }
    }
  }
  
  return {
    repositories: allRepos,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};
```

### GitHub Rate Limiting

When GitHub API is rate limited:
1. Log warning with reset time
2. Add error to errors array
3. Continue with other orgs
4. Return cached data if available (via cache-data)

## Testing Brown-Out Support

### Unit Tests

```javascript
// Test partial failure scenario
describe('Brown-out support', () => {
  it('should return partial data when one bucket fails', async () => {
    // Mock S3 to fail for bucket-2
    mockS3.listObjectsV2
      .mockResolvedValueOnce({ Contents: [/* bucket-1 data */] })
      .mockRejectedValueOnce(new Error('Access Denied'))
      .mockResolvedValueOnce({ Contents: [/* bucket-3 data */] });
    
    const result = await Models.S3Templates.list(connection, {});
    
    expect(result.templates).toHaveLength(2);  // Data from bucket-1 and bucket-3
    expect(result.partialData).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('bucket-2');
  });
  
  it('should fail completely when all buckets fail', async () => {
    // Mock S3 to fail for all buckets
    mockS3.listObjectsV2.mockRejectedValue(new Error('Access Denied'));
    
    const result = await Models.S3Templates.list(connection, {});
    
    expect(result.templates).toHaveLength(0);
    expect(result.partialData).toBe(true);
    expect(result.errors).toHaveLength(3);  // All 3 buckets failed
  });
});
```

### Integration Tests

```javascript
// Test with real AWS services (mocked)
describe('Integration: Brown-out support', () => {
  it('should handle mixed success and failure', async () => {
    // Set up test buckets with different states
    // bucket-1: accessible
    // bucket-2: access denied
    // bucket-3: accessible
    
    const response = await handler({
      body: JSON.stringify({
        tool: 'list_templates',
        input: {}
      })
    });
    
    const result = JSON.parse(response.body);
    
    expect(result.result.partialData).toBe(true);
    expect(result.result.errors).toBeDefined();
    expect(result.result.templates.length).toBeGreaterThan(0);
  });
});
```

## Monitoring and Alerting

### CloudWatch Metrics

Track brown-out occurrences:

```javascript
// Emit custom metric for partial data responses
await cloudwatch.putMetricData({
  Namespace: 'AtlantisMCP',
  MetricData: [{
    MetricName: 'PartialDataResponses',
    Value: 1,
    Unit: 'Count',
    Dimensions: [{
      Name: 'Tool',
      Value: toolName
    }]
  }]
});
```

### CloudWatch Alarms

Set alarms for high brown-out rates:

```yaml
# CloudFormation
PartialDataAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: !Sub '${Prefix}-${ProjectId}-${StageId}-PartialDataRate'
    MetricName: PartialDataResponses
    Namespace: AtlantisMCP
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
    AlarmDescription: 'Alert when partial data rate is high'
```

### Operational Dashboards

Create dashboards showing:
- Partial data response rate
- Failed sources by type (S3, GitHub)
- Most common error codes
- Error trends over time

## Best Practices

### DO

✅ Continue processing when one source fails
✅ Log warnings for failed sources
✅ Include error information in responses
✅ Set partialData flag when errors occur
✅ Deduplicate results from successful sources
✅ Test brown-out scenarios
✅ Monitor partial data rates
✅ Document which operations support brown-out

### DON'T

❌ Throw exceptions for single source failures
❌ Hide errors from users
❌ Return incomplete data without indicating it's partial
❌ Log errors at ERROR level for brown-out scenarios
❌ Retry failed sources indefinitely
❌ Cache error responses
❌ Expose sensitive error details to users

## When NOT to Use Brown-Out

Brown-out support is not appropriate for:

1. **Single Source Operations**: When only one source is configured
2. **Critical Data**: When partial data is worse than no data
3. **Transactional Operations**: When all-or-nothing is required
4. **Write Operations**: When consistency is critical (Phase 2)

For these cases, use traditional fail-fast approach:

```javascript
const get = async (connection, options = {}) => {
  // For single template retrieval, fail fast
  const template = await fetchTemplate(bucket, key);
  if (!template) {
    throw new Error('Template not found');
  }
  return template;
};
```

## Troubleshooting

### Issue: Too Many Partial Data Responses

**Symptoms**: High rate of partialData: true in responses

**Investigation**:
1. Check CloudWatch logs for error patterns
2. Identify which sources are failing most often
3. Review error codes and messages

**Solutions**:
- Fix configuration issues (tags, permissions)
- Remove consistently failing sources
- Increase retry logic for transient errors
- Contact source administrators

### Issue: Users Not Aware of Partial Data

**Symptoms**: Users report missing data

**Investigation**:
1. Check if partialData flag is being displayed
2. Review error information in responses
3. Verify logging is capturing failures

**Solutions**:
- Improve error messaging in responses
- Add UI indicators for partial data
- Document partial data behavior for users
- Consider adding warnings in responses

## Related Documentation

- [Architecture Overview](./architecture.md)
- [Lambda Function Structure](./lambda-structure.md)
- [Error Handling](./error-handling.md)
- [Testing Procedures](./testing.md)
