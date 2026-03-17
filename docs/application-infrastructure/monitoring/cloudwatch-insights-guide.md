# CloudWatch Logs Insights Query Guide

## Overview

This guide provides CloudWatch Logs Insights queries for troubleshooting and monitoring the Atlantis MCP Server. These queries help identify issues, analyze performance, and understand system behavior.

## Log Retention Configuration

Log retention is automatically configured based on the deployment environment:

- **Production (PROD)**: Configurable via `LogRetentionInDaysForPROD` parameter (default: 180 days)
- **Test/Dev (TEST/DEV)**: Configurable via `LogRetentionInDaysForDEVTEST` parameter (default: 7 days)

The retention settings are applied to:
- Read Lambda execution logs: `/aws/lambda/${Prefix}-${ProjectId}-${StageId}-ReadFunction`
- API Gateway access logs: `/aws/apigateway/${Prefix}-${ProjectId}-${StageId}-WebApi-access-logs`
- API Gateway execution logs: `API-Gateway-Execution-Logs_${WebApi}/${ApiPathBase}`

## Log Groups

The MCP Server creates the following CloudWatch Log Groups:

1. **Read Lambda Execution Logs**
   - Path: `/aws/lambda/${Prefix}-${ProjectId}-${StageId}-ReadFunction`
   - Contains: Lambda function execution logs, errors, and application logs

2. **API Gateway Access Logs** (if enabled)
   - Path: `/aws/apigateway/${Prefix}-${ProjectId}-${StageId}-WebApi-access-logs`
   - Contains: Request/response metadata, IP addresses, status codes

3. **API Gateway Execution Logs** (if enabled)
   - Path: `API-Gateway-Execution-Logs_${WebApi}/${ApiPathBase}`
   - Contains: API Gateway internal execution details

## Using CloudWatch Insights Queries

### Accessing CloudWatch Insights

1. Open the AWS Console
2. Navigate to CloudWatch → Logs → Insights
3. Select the appropriate log group(s)
4. Paste the query from this guide
5. Select the time range
6. Click "Run query"

### Query Syntax

CloudWatch Insights uses a SQL-like query language with the following structure:

```
fields @timestamp, @message, field1, field2
| filter condition
| parse @message /regex pattern/
| stats aggregation by grouping_field
| sort field desc
| limit number
```

## Available Queries

### 1. Rate Limit Violations

**Purpose**: Find all rate limit violations with IP addresses and timestamps

**Log Groups**: Read Lambda, API Gateway Access Logs

**Query**:
```
fields @timestamp, @message, ip, requestId, status
| filter status = 429 or @message like /rate limit/i or @message like /too many requests/i
| sort @timestamp desc
| limit 100
```

**Use Cases**:
- Identify IPs hitting rate limits
- Determine if rate limits need adjustment
- Detect potential abuse or bot traffic

**Expected Output**:
- Timestamp of rate limit violation
- IP address of requester
- Request ID for correlation
- HTTP status code (429)

---

### 2. Brown-Out Scenarios

**Purpose**: Identify partial data returns when some sources fail

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /brown-out/i or @message like /partial data/i or @message like /source failed/i or @message like /bucket.*skipped/i or @message like /user.*org.*failed/i
| parse @message /bucket[:\s]+(?<failedBucket>[^\s,]+)/
| parse @message /user\/org[:\s]+(?<failedOrg>[^\s,]+)/
| stats count() as failureCount by failedBucket, failedOrg
| sort failureCount desc
```

**Use Cases**:
- Identify unreliable S3 buckets or GitHub orgs
- Determine which sources are causing partial data returns
- Prioritize fixing the most frequently failing sources

**Expected Output**:
- Failed bucket or GitHub org name
- Count of failures
- Sorted by most frequent failures

---

### 3. Cache Performance Analysis

**Purpose**: Analyze cache hit/miss rates and performance metrics

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /cache/i
| parse @message /cache[:\s]+(?<cacheStatus>hit|miss)/i
| parse @message /duration[:\s]+(?<duration>\d+)/
| parse @message /tool[:\s]+(?<tool>[^\s,]+)/
| stats count() as totalRequests, 
        sum(cacheStatus = "hit") as cacheHits, 
        sum(cacheStatus = "miss") as cacheMisses,
        avg(duration) as avgDuration,
        max(duration) as maxDuration
        by tool
| fields tool, totalRequests, cacheHits, cacheMisses, 
         (cacheHits / totalRequests * 100) as hitRate,
         avgDuration, maxDuration
| sort hitRate desc
```

**Use Cases**:
- Evaluate cache effectiveness
- Identify tools with low cache hit rates
- Optimize TTL settings based on hit rates
- Detect cache performance issues

**Expected Output**:
- Tool name
- Total requests
- Cache hits and misses
- Hit rate percentage
- Average and max duration

---

### 4. Error Analysis by Type

**Purpose**: Categorize and count errors by type and source

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /error/i or @message like /exception/i or @message like /failed/i
| parse @message /error[:\s]+(?<errorType>[^:]+):/i
| parse @message /(?<errorCode>TEMPLATE_NOT_FOUND|INVALID_INPUT|BUCKET_ACCESS_DENIED|GITHUB_RATE_LIMIT|S3_ERROR|DYNAMODB_ERROR)/
| stats count() as errorCount by coalesce(errorCode, errorType, "Unknown")
| sort errorCount desc
```

**Use Cases**:
- Identify most common error types
- Prioritize error fixes
- Detect systemic issues
- Monitor error trends over time

**Expected Output**:
- Error type or code
- Count of occurrences
- Sorted by most frequent errors

---

### 5. Request Latency by Tool

**Purpose**: Analyze request latency for each MCP tool

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, @duration, requestId
| filter @message like /tool[:\s]+/
| parse @message /tool[:\s]+(?<tool>[^\s,]+)/
| parse @message /duration[:\s]+(?<requestDuration>\d+)/
| stats count() as requestCount,
        avg(@duration) as avgLambdaDuration,
        max(@duration) as maxLambdaDuration,
        avg(requestDuration) as avgRequestDuration,
        max(requestDuration) as maxRequestDuration,
        pct(@duration, 95) as p95Duration,
        pct(@duration, 99) as p99Duration
        by tool
| sort avgLambdaDuration desc
```

**Use Cases**:
- Identify slow tools
- Optimize performance bottlenecks
- Set appropriate timeout values
- Monitor SLA compliance

**Expected Output**:
- Tool name
- Request count
- Average, max, P95, and P99 durations
- Lambda duration vs request duration

---

### 6. S3 Bucket Access Issues

**Purpose**: Find S3 bucket access problems and missing tags

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /bucket/i and (@message like /access denied/i or @message like /not found/i or @message like /missing tag/i or @message like /atlantis-mcp:Allow/i or @message like /IndexPriority/i)
| parse @message /bucket[:\s]+(?<bucket>[^\s,]+)/
| parse @message /(?<issue>access denied|not found|missing tag|Allow=false|no IndexPriority)/i
| stats count() as issueCount by bucket, issue
| sort issueCount desc
```

**Use Cases**:
- Identify misconfigured S3 buckets
- Find buckets missing required tags
- Troubleshoot access permission issues
- Verify bucket configuration

**Expected Output**:
- Bucket name
- Issue type (access denied, missing tag, etc.)
- Count of issues

---

### 7. GitHub API Rate Limiting

**Purpose**: Monitor GitHub API rate limit status and violations

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /github/i and (@message like /rate limit/i or @message like /X-RateLimit/i)
| parse @message /X-RateLimit-Remaining[:\s]+(?<remaining>\d+)/
| parse @message /X-RateLimit-Limit[:\s]+(?<limit>\d+)/
| parse @message /user\/org[:\s]+(?<userOrg>[^\s,]+)/
| stats min(remaining) as minRemaining, max(limit) as rateLimit by userOrg
| sort minRemaining asc
```

**Use Cases**:
- Monitor GitHub API quota usage
- Identify users/orgs approaching rate limits
- Plan for additional GitHub tokens if needed
- Optimize GitHub API call patterns

**Expected Output**:
- GitHub user/org name
- Minimum remaining requests
- Rate limit value
- Sorted by lowest remaining requests

---

### 8. Template Discovery Performance

**Purpose**: Analyze template discovery across multiple buckets

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, @duration, requestId
| filter @message like /list_templates/i or @message like /template discovery/i
| parse @message /bucket[:\s]+(?<bucket>[^\s,]+)/
| parse @message /namespace[:\s]+(?<namespace>[^\s,]+)/
| parse @message /templates found[:\s]+(?<templateCount>\d+)/
| stats count() as discoveryCount,
        avg(@duration) as avgDuration,
        sum(templateCount) as totalTemplates
        by bucket, namespace
| sort avgDuration desc
```

**Use Cases**:
- Identify slow template discovery operations
- Optimize bucket/namespace organization
- Monitor template discovery patterns
- Detect performance degradation

**Expected Output**:
- Bucket and namespace
- Discovery operation count
- Average duration
- Total templates found

---

### 9. Documentation Search Performance

**Purpose**: Analyze documentation search queries and results

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, @duration, requestId
| filter @message like /search_documentation/i
| parse @message /query[:\s]+(?<searchQuery>[^,]+)/
| parse @message /results[:\s]+(?<resultCount>\d+)/
| parse @message /duration[:\s]+(?<searchDuration>\d+)/
| stats count() as searchCount,
        avg(resultCount) as avgResults,
        avg(searchDuration) as avgDuration,
        max(searchDuration) as maxDuration
        by searchQuery
| sort searchCount desc
| limit 20
```

**Use Cases**:
- Identify popular search queries
- Optimize documentation indexing
- Improve search relevance
- Monitor search performance

**Expected Output**:
- Search query text
- Search count
- Average results returned
- Average and max search duration

---

### 10. Cold Start Analysis

**Purpose**: Identify Lambda cold starts and initialization times

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, @duration, @initDuration, requestId
| filter @type = "REPORT"
| stats count() as invocations,
        sum(@initDuration > 0) as coldStarts,
        avg(@duration) as avgDuration,
        avg(@initDuration) as avgInitDuration,
        max(@initDuration) as maxInitDuration,
        pct(@duration, 95) as p95Duration
| fields invocations, coldStarts, 
         (coldStarts / invocations * 100) as coldStartRate,
         avgDuration, avgInitDuration, maxInitDuration, p95Duration
```

**Use Cases**:
- Monitor cold start frequency
- Evaluate provisioned concurrency needs
- Optimize initialization code
- Understand latency impact

**Expected Output**:
- Total invocations
- Cold start count and rate
- Average and max initialization duration
- P95 duration

---

### 11. Memory Usage Analysis

**Purpose**: Analyze Lambda memory usage and identify potential issues

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, @maxMemoryUsed, @memorySize, requestId
| filter @type = "REPORT"
| stats count() as invocations,
        avg(@maxMemoryUsed) as avgMemoryUsed,
        max(@maxMemoryUsed) as maxMemoryUsed,
        avg(@memorySize) as configuredMemory,
        avg(@maxMemoryUsed / @memorySize * 100) as avgMemoryUtilization,
        max(@maxMemoryUsed / @memorySize * 100) as maxMemoryUtilization
| fields invocations, avgMemoryUsed, maxMemoryUsed, configuredMemory, avgMemoryUtilization, maxMemoryUtilization
```

**Use Cases**:
- Right-size Lambda memory allocation
- Identify memory leaks
- Optimize cost by reducing over-provisioned memory
- Prevent out-of-memory errors

**Expected Output**:
- Invocation count
- Average and max memory used
- Configured memory
- Memory utilization percentage

---

### 12. API Gateway Request Analysis

**Purpose**: Analyze API Gateway requests by path and status

**Log Groups**: API Gateway Access Logs

**Query**:
```
fields @timestamp, requestId, ip, httpMethod, path, status, responseLength, requestTime
| parse path /\/mcp\/(?<tool>[^\/\?]+)/
| stats count() as requestCount,
        avg(responseLength) as avgResponseSize,
        sum(status >= 400) as errorCount,
        sum(status = 429) as rateLimitCount
        by tool, status
| sort requestCount desc
```

**Use Cases**:
- Monitor API usage patterns
- Identify most used tools
- Track error rates by tool
- Analyze response sizes

**Expected Output**:
- Tool name
- Request count
- Average response size
- Error and rate limit counts

---

### 13. Validation Errors

**Purpose**: Find input validation errors and schema violations

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /validation/i and (@message like /error/i or @message like /invalid/i)
| parse @message /tool[:\s]+(?<tool>[^\s,]+)/
| parse @message /parameter[:\s]+(?<parameter>[^\s,]+)/
| parse @message /(?<validationError>missing required|invalid format|out of range|unknown parameter)/i
| stats count() as errorCount by tool, parameter, validationError
| sort errorCount desc
```

**Use Cases**:
- Identify common input validation issues
- Improve API documentation
- Detect client-side bugs
- Monitor schema compliance

**Expected Output**:
- Tool name
- Parameter name
- Validation error type
- Error count

---

### 14. Namespace Discovery Issues

**Purpose**: Identify namespace discovery and indexing problems

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /namespace/i and (@message like /error/i or @message like /warning/i or @message like /IndexPriority/i)
| parse @message /bucket[:\s]+(?<bucket>[^\s,]+)/
| parse @message /namespace[:\s]+(?<namespace>[^\s,]+)/
| parse @message /(?<issue>no IndexPriority|empty IndexPriority|namespace not found|invalid namespace)/i
| stats count() as issueCount by bucket, namespace, issue
| sort issueCount desc
```

**Use Cases**:
- Troubleshoot namespace configuration
- Verify IndexPriority tags
- Identify misconfigured buckets
- Monitor namespace discovery health

**Expected Output**:
- Bucket name
- Namespace name
- Issue type
- Issue count

---

### 15. Sidecar Metadata Issues

**Purpose**: Find app starters with missing or invalid sidecar metadata

**Log Groups**: Read Lambda

**Query**:
```
fields @timestamp, @message, requestId
| filter @message like /sidecar/i and (@message like /missing/i or @message like /invalid/i or @message like /error/i)
| parse @message /starter[:\s]+(?<starter>[^\s,]+)/
| parse @message /bucket[:\s]+(?<bucket>[^\s,]+)/
| parse @message /(?<issue>missing sidecar|invalid JSON|missing required field)/i
| stats count() as issueCount by starter, bucket, issue
| sort issueCount desc
```

**Use Cases**:
- Identify starters without sidecar metadata
- Troubleshoot metadata generation
- Verify sidecar metadata format
- Monitor starter discovery health

**Expected Output**:
- Starter name
- Bucket name
- Issue type
- Issue count

---

## Creating Custom Queries

### Query Structure

1. **Select fields**: Choose which fields to display
2. **Filter**: Narrow down log entries
3. **Parse**: Extract structured data from log messages
4. **Aggregate**: Use stats to summarize data
5. **Sort and limit**: Order results and limit output

### Common Patterns

**Time-based filtering**:
```
| filter @timestamp >= ago(1h)
```

**Regex parsing**:
```
| parse @message /pattern: (?<variable>\w+)/
```

**Aggregation**:
```
| stats count() as total, avg(duration) as avgDuration by tool
```

**Conditional aggregation**:
```
| stats sum(status = 200) as successCount, sum(status >= 400) as errorCount
```

## Best Practices

1. **Start with a narrow time range** to avoid query timeouts
2. **Use filters early** in the query to reduce data processed
3. **Parse only what you need** to improve query performance
4. **Test queries incrementally** by building them step by step
5. **Save frequently used queries** in CloudWatch Insights
6. **Use appropriate log groups** to reduce query scope
7. **Monitor query costs** as CloudWatch Insights charges per GB scanned

## Troubleshooting Common Issues

### Query Timeout

**Problem**: Query times out before completing

**Solutions**:
- Reduce time range
- Add more specific filters
- Limit the number of log groups
- Use sampling with `| limit` early in the query

### No Results

**Problem**: Query returns no results

**Solutions**:
- Verify log group names are correct
- Check time range includes relevant data
- Verify filter conditions match log format
- Check if logs are being generated

### Parse Errors

**Problem**: Parse statements don't extract data

**Solutions**:
- Test regex patterns separately
- Check log message format
- Use case-insensitive matching with `/i` flag
- Escape special regex characters

### High Costs

**Problem**: CloudWatch Insights queries are expensive

**Solutions**:
- Use more specific filters
- Reduce time ranges
- Query less frequently
- Use CloudWatch Metrics for real-time monitoring instead

## Additional Resources

- [CloudWatch Logs Insights Query Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [CloudWatch Logs Insights Sample Queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-examples.html)
- [CloudWatch Logs Pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [MCP Server Architecture Documentation](../docs/maintainer/architecture.md)
- [MCP Server Troubleshooting Guide](../docs/troubleshooting/README.md)
