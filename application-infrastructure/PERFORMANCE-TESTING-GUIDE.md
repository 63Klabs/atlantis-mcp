# Performance Testing Guide

## Overview

This guide explains how to run performance validation tests for the Atlantis MCP Server Read Lambda function and interpret the results.

## Performance Tests

Performance tests are located in `src/tests/performance/lambda-performance.test.js` and validate:

1. **Cold Start Performance** - Lambda initialization time
2. **Warm Invocation Performance** - Subsequent request handling
3. **Cache Hit Performance** - Response time with cached data
4. **Cache Miss Performance** - Response time without cached data
5. **Memory Configuration** - Optimal memory allocation
6. **Timeout Configuration** - Appropriate timeout settings

## Running Performance Tests

### Run All Performance Tests

```bash
cd application-infrastructure/src
npm test -- tests/performance/
```

### Run Specific Performance Test

```bash
# Cold start performance
npm test -- tests/performance/lambda-performance.test.js -t "Cold Start"

# Warm invocation performance
npm test -- tests/performance/lambda-performance.test.js -t "Warm Invocation"

# Cache performance
npm test -- tests/performance/lambda-performance.test.js -t "Cache Hit"
npm test -- tests/performance/lambda-performance.test.js -t "Cache Miss"

# Configuration validation
npm test -- tests/performance/lambda-performance.test.js -t "Memory Configuration"
npm test -- tests/performance/lambda-performance.test.js -t "Timeout Configuration"
```

## Performance Thresholds

The tests validate against these performance thresholds:

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Cold Start | < 5000ms | Includes Config.init(), cache-data initialization |
| Warm Invocation | < 1000ms | Subsequent requests on warm container |
| Cache Hit | < 500ms | DynamoDB cache retrieval |
| Cache Miss | < 3000ms | Includes S3/GitHub API calls |

## Interpreting Results

### Cold Start Performance

```
Cold start completed in 2847ms (threshold: 5000ms)
```

**Good**: < 3000ms  
**Acceptable**: 3000-5000ms  
**Needs Investigation**: > 5000ms

**Factors affecting cold start:**
- Lambda memory configuration (more memory = faster CPU)
- Number of dependencies loaded
- Config initialization (SSM GetParameter)
- cache-data initialization

### Warm Invocation Performance

```
Warm invocation completed in 234ms (threshold: 1000ms)
Average warm invocation: 245.60ms
Max warm invocation: 312ms
```

**Good**: < 500ms  
**Acceptable**: 500-1000ms  
**Needs Investigation**: > 1000ms

**Factors affecting warm invocations:**
- Request complexity
- Cache hit/miss ratio
- Number of external API calls

### Cache Hit Performance

```
Cache hit completed in 187ms (threshold: 500ms)
```

**Good**: < 300ms  
**Acceptable**: 300-500ms  
**Needs Investigation**: > 500ms

**Factors affecting cache hits:**
- DynamoDB table configuration
- Network latency to DynamoDB
- Cache entry size

### Cache Miss Performance

```
Cache miss completed in 1456ms (threshold: 3000ms)
Cache miss: 1456ms, Cache hit: 187ms
Cache hit is 87.2% faster
```

**Good**: < 2000ms  
**Acceptable**: 2000-3000ms  
**Needs Investigation**: > 3000ms

**Factors affecting cache misses:**
- Number of S3 buckets to query
- Number of GitHub orgs to query
- S3 bucket size and object count
- GitHub API rate limits
- Network latency

## Lambda Configuration Recommendations

### Memory Configuration

**Recommended**: 1024 MB

**Rationale**:
- Cold start: 512-1024MB
- list_templates: 256-512MB
- get_template: 512-1024MB
- search_documentation: 512-1024MB

**Tuning**:
1. Start with 1024MB
2. Monitor CloudWatch metrics:
   - `MemoryUtilization`
   - `MaxMemoryUsed`
3. Adjust based on actual usage:
   - If consistently < 512MB, reduce to 768MB
   - If approaching 1024MB, increase to 1536MB

### Timeout Configuration

**Recommended**: 30 seconds

**Rationale**:
- Most operations: < 10s
- Multi-source operations: 10-20s
- Safety margin: 50%

**Operations and typical duration**:
- `list_categories`: < 5s
- `list_templates`: 5-15s
- `get_template`: 5-10s
- `list_starters`: 10-20s
- `search_documentation`: 10-20s

**Tuning**:
- Monitor CloudWatch metric: `Duration`
- If operations consistently timeout, investigate:
  - Slow S3/GitHub API responses
  - Large result sets
  - Network issues
  - Inefficient code paths

## Monitoring Performance in Production

### CloudWatch Metrics to Monitor

1. **Duration** - Execution time
   - Target: < 10s for most operations
   - Alert: > 20s

2. **Memory Utilization** - Memory usage
   - Target: 50-80% of allocated memory
   - Alert: > 90%

3. **Cold Start Count** - Frequency of cold starts
   - Target: < 10% of invocations
   - Alert: > 25%

4. **Throttles** - Rate limiting
   - Target: 0
   - Alert: > 0

5. **Errors** - Failed invocations
   - Target: < 1%
   - Alert: > 5%

### CloudWatch Insights Queries

See `cloudwatch-insights-queries.json` for pre-built queries:

```bash
# View queries
cat cloudwatch-insights-queries.json | jq '.queries[] | select(.name | contains("Performance"))'
```

**Key queries**:
- Performance - Cold Start Duration
- Performance - Warm Invocation Duration
- Performance - Cache Hit Ratio
- Performance - P50/P95/P99 Latency

### Setting Up Alarms

Create CloudWatch Alarms for:

1. **High Duration**
   ```yaml
   Metric: Duration
   Threshold: > 20000ms
   Evaluation: 2 out of 3 periods
   ```

2. **High Memory Usage**
   ```yaml
   Metric: MaxMemoryUsed
   Threshold: > 90% of allocated
   Evaluation: 3 out of 5 periods
   ```

3. **High Error Rate**
   ```yaml
   Metric: Errors
   Threshold: > 5%
   Evaluation: 2 out of 3 periods
   ```

## Performance Optimization Tips

### Reduce Cold Start Time

1. **Minimize dependencies**
   - Remove unused npm packages
   - Use tree-shaking for large libraries

2. **Optimize Config.init()**
   - Cache SSM parameters
   - Defer non-critical initialization

3. **Increase memory**
   - More memory = faster CPU
   - Test with 1536MB or 2048MB

### Improve Warm Invocation Performance

1. **Optimize caching**
   - Increase cache TTLs for stable data
   - Use in-memory caching for frequently accessed data

2. **Reduce external API calls**
   - Batch S3 operations
   - Use GitHub GraphQL API for complex queries

3. **Optimize data processing**
   - Stream large responses
   - Use efficient JSON parsing

### Improve Cache Hit Ratio

1. **Tune cache TTLs**
   - Longer TTLs for stable data (templates)
   - Shorter TTLs for dynamic data (starters)

2. **Implement cache warming**
   - Pre-populate cache for common queries
   - Use EventBridge scheduled rules

3. **Monitor cache effectiveness**
   - Track cache hit/miss ratio
   - Identify frequently missed queries

## Troubleshooting Performance Issues

### Cold Starts Taking Too Long

**Symptoms**: Cold start > 5s

**Possible causes**:
- Too many dependencies
- Large Lambda package size
- Slow SSM GetParameter
- Insufficient memory

**Solutions**:
1. Profile cold start with X-Ray
2. Remove unused dependencies
3. Increase Lambda memory
4. Cache SSM parameters

### Warm Invocations Slow

**Symptoms**: Warm invocation > 1s

**Possible causes**:
- Cache misses
- Slow S3/GitHub API
- Large result sets
- Inefficient code

**Solutions**:
1. Check cache hit ratio
2. Optimize S3 queries (use prefixes)
3. Implement pagination
4. Profile with X-Ray

### Cache Misses Taking Too Long

**Symptoms**: Cache miss > 3s

**Possible causes**:
- Multiple S3 buckets
- Multiple GitHub orgs
- Large S3 buckets
- GitHub API rate limits

**Solutions**:
1. Reduce number of sources
2. Implement parallel queries
3. Use S3 Select for filtering
4. Cache GitHub API responses

### Memory Issues

**Symptoms**: Out of memory errors

**Possible causes**:
- Large result sets
- Memory leaks
- Insufficient memory allocation

**Solutions**:
1. Increase Lambda memory
2. Implement streaming for large responses
3. Profile memory usage
4. Check for memory leaks

## Performance Testing Checklist

Before deploying to production:

- [ ] All performance tests pass
- [ ] Cold start < 5s
- [ ] Warm invocation < 1s
- [ ] Cache hit < 500ms
- [ ] Cache miss < 3s
- [ ] Memory configuration validated
- [ ] Timeout configuration validated
- [ ] CloudWatch alarms configured
- [ ] Performance monitoring dashboard created
- [ ] Load testing completed (if applicable)

## Load Testing (Optional)

For production deployments, consider load testing:

### Using Artillery

```bash
npm install -g artillery

# Create load test config
cat > load-test.yml << EOF
config:
  target: 'https://your-api-gateway-url'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
scenarios:
  - name: "List templates"
    flow:
      - post:
          url: "/mcp"
          json:
            tool: "list_templates"
            input:
              category: "Storage"
EOF

# Run load test
artillery run load-test.yml
```

### Analyze Results

Monitor during load test:
- Lambda concurrent executions
- API Gateway latency
- DynamoDB throttles
- Error rates

## Summary

Performance testing ensures the Lambda function meets acceptable performance standards:

1. **Run tests regularly** - Before each deployment
2. **Monitor in production** - Use CloudWatch metrics and alarms
3. **Optimize continuously** - Based on real-world usage patterns
4. **Document changes** - Track performance improvements over time

For questions or issues, refer to:
- [CloudWatch Insights Guide](CLOUDWATCH-INSIGHTS-GUIDE.md)
- [Deployment Validation Checklist](DEPLOYMENT-VALIDATION-CHECKLIST.md)
- [Integration Test Status](src/tests/INTEGRATION_TEST_STATUS.md)
