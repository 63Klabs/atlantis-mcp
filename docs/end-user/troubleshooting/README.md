# Troubleshooting Guide

This guide helps you diagnose and resolve common issues when using the Atlantis MCP Server.

## Table of Contents

- [Connection Issues](#connection-issues)
- [Rate Limiting](#rate-limiting)
- [Tool Errors](#tool-errors)
- [Performance Issues](#performance-issues)
- [Authentication Problems](#authentication-problems)
- [Data Quality Issues](#data-quality-issues)
- [Integration-Specific Issues](#integration-specific-issues)

---

## Connection Issues

### Problem: Cannot Connect to MCP Server

**Symptoms:**
- AI assistant reports connection failed
- Timeout errors
- "Server not responding" messages

**Possible Causes:**

1. **Incorrect URL**
   - Check configuration for typos
   - Verify URL format: `https://mcp.atlantis.63klabs.net/mcp/v1`
   - Ensure no trailing slash

2. **Network Issues**
   - Check internet connectivity
   - Verify firewall allows HTTPS traffic
   - Test URL in browser: should return JSON response

3. **Server Downtime**
   - Check server status page
   - Try again in a few minutes
   - Contact support if persistent

**Solutions:**

```bash
# Test connection with curl
curl -X POST https://mcp.atlantis.63klabs.net/mcp/v1 \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: JSON response with categories
```

**For Claude Desktop:**
```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
      "timeout": 30000
    }
  }
}
```

**For Cursor/Kiro:**
- Verify settings.json syntax
- Reload window after configuration changes
- Check IDE logs for detailed errors

---

## Rate Limiting

### Problem: HTTP 429 - Too Many Requests

**Symptoms:**
- "Rate limit exceeded" error
- HTTP 429 status code
- Requests blocked for 1 hour

**Understanding Rate Limits:**

Default limits (public instance):
- 50 requests per hour per IP address
- Resets every hour on the hour
- Applies to all tools

**Check Rate Limit Status:**

Response headers show current status:
```
X-RateLimit-Limit: 50
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1706284800
```

**Solutions:**

1. **Wait for Reset**
   - Check `X-RateLimit-Reset` header (Unix timestamp)
   - Convert to local time: `date -r 1706284800`
   - Wait until reset time

2. **Reduce Request Frequency**
   - Batch multiple questions together
   - Use caching when possible
   - Avoid repeated identical requests

3. **Self-Host for Higher Limits**
   - Deploy your own instance
   - Configure custom rate limits
   - [Atlantis MCP on GitHub](https://github.com/63klabs/atlantis-mcp)

**Prevention:**

- Cache AI assistant responses
- Use filters to narrow results
- Avoid polling or automated scripts
- Batch operations when possible

---

## Tool Errors

### Problem: TEMPLATE_NOT_FOUND

**Symptoms:**
- "Template 'xyz' not found" error
- Empty results when expecting templates

**Possible Causes:**

1. **Incorrect Template Name**
   - Check spelling
   - Verify file extension (.yml or .yaml)
   - Use exact name from list_templates

2. **Wrong Category**
   - Template may be in different category
   - Try without category filter

3. **Template Not in Configured Buckets**
   - Template may be in different bucket
   - Check bucket configuration

**Solutions:**

```
# List all templates to find correct name
Ask AI: "List all available templates"

# Search by category
Ask AI: "Show me all Pipeline templates"

# Check specific bucket
Ask AI: "List templates from bucket xyz"
```

**Error Response Example:**
```json
{
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "Template 'template-pipline.yml' not found",
    "details": {
      "availableTemplates": [
        "template-pipeline.yml",
        "template-storage.yml"
      ]
    }
  }
}
```

Note the typo: "pipline" vs "pipeline"

---

### Problem: INVALID_INPUT

**Symptoms:**
- "Invalid input" error
- JSON Schema validation failed
- Missing required parameters

**Common Causes:**

1. **Missing Required Parameters**
   ```
   # Wrong - missing category
   Ask AI: "Get template-pipeline.yml"
   
   # Correct
   Ask AI: "Get template-pipeline.yml from Pipeline category"
   ```

2. **Invalid Parameter Types**
   ```
   # Wrong - version should be string
   version: 2.0.18
   
   # Correct
   version: "v2.0.18"
   ```

3. **Invalid Parameter Values**
   ```
   # Wrong - invalid category
   category: "Pipelines"
   
   # Correct
   category: "pipeline"
   ```

**Solutions:**

- Check [MCP Tools Reference](tools/README.md) for parameter requirements
- Verify parameter types and formats
- Use list_categories to see valid category names
- Review error message for specific validation failures

---

### Problem: STARTER_NOT_FOUND

**Symptoms:**
- "Starter 'xyz' not found" error
- Empty results for get_starter_info

**Possible Causes:**

1. **Missing Sidecar Metadata**
   - Starter exists but has no .json metadata file
   - Starter is excluded from discovery

2. **Missing GitHub Custom Property**
   - Repository doesn't have `atlantis_repository-type` property
   - Property value is not "app-starter"

3. **Incorrect Starter Name**
   - Check spelling
   - Use exact repository name

**Solutions:**

```
# List all starters to find correct name
Ask AI: "List all available starters"

# Check specific organization
Ask AI: "List starters from 63klabs"
```

**For Self-Hosted:**
- Verify sidecar metadata files exist in S3
- Check GitHub custom properties are set
- Review logs for warnings about skipped starters

---

## Performance Issues

### Problem: Slow Response Times

**Symptoms:**
- Requests take >10 seconds
- Timeout errors
- Inconsistent performance

**Possible Causes:**

1. **Large Result Sets**
   - Listing all templates across many buckets
   - Searching large documentation index
   - Getting full template content

2. **Network Latency**
   - Geographic distance from server
   - Network congestion
   - ISP issues

3. **Cache Miss**
   - First request for specific data
   - Cache expired
   - Subsequent requests will be faster

**Solutions:**

1. **Use Filters**
   ```
   # Slow - lists everything
   Ask AI: "List all templates"
   
   # Faster - filtered results
   Ask AI: "List Pipeline templates"
   ```

2. **Increase Timeout**
   ```json
   {
     "mcpServers": {
       "atlantis": {
         "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
         "timeout": 60000
       }
     }
   }
   ```

**Performance Tips:**

- Use specific queries instead of broad searches
- Filter results to reduce data transfer

---

## Authentication Problems

### Problem: Authentication Required

**Symptoms:**
- "Authentication required" error
- HTTP 401 Unauthorized
- Invalid credentials

**Solutions:**

If you see authentication errors:

1. **Verify URL**
   - Ensure using public endpoint
   - Check for typos

---

## Data Quality Issues

### Problem: Partial Data Returned

**Symptoms:**
- `partialData: true` in response
- `errors` array contains failures
- Some buckets/orgs missing from results

**Understanding Brown-Out Support:**

The MCP server continues operation when some data sources fail:
- Returns available data from working sources
- Includes error information for failed sources
- Logs detailed errors for troubleshooting

**Example Response:**
```json
{
  "templates": [...],
  "partialData": true,
  "errors": [
    {
      "source": "bucket-xyz",
      "sourceType": "s3",
      "error": "Access denied",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**Possible Causes:**

1. **S3 Bucket Access Issues**
   - Missing `atlantis-mcp:Allow=true` tag
   - Insufficient permissions
   - Bucket doesn't exist

2. **GitHub API Issues**
   - Rate limit exceeded
   - Repository private without access
   - Network timeout

3. **Temporary Failures**
   - Service temporarily unavailable
   - Network issues
   - Timeout

**Solutions:**

1. **Review Error Details**
   - Check `errors` array in response
   - Identify which sources failed
   - Determine if data is sufficient

2. **For Self-Hosted:**
   - Verify S3 bucket tags
   - Check IAM permissions
   - Review CloudWatch logs
   - Test bucket access manually

3. **Retry Request**
   - Temporary failures may resolve
   - Wait a few minutes and retry

4. **Contact Support**
   - Persistent failures
   - Provide error details
   - Include timestamp and request ID

---

### Problem: Stale Data

**Symptoms:**
- Old template versions shown
- Missing recent updates
- Outdated documentation

**Understanding Caching:**

Data is cached for performance:
- Template metadata: 24 hours
- Starter metadata: 24 hours
- Documentation index: 24 hours
- Full template content: 24 hours

**Solutions:**

1. **Wait for Cache Expiration**
   - Check cache TTL for resource type
   - Data will refresh automatically

2. **For Self-Hosted:**
   - Clear cache manually
   - Adjust TTL values
   - Force cache refresh

3. **Verify Source Data**
   - Check S3 bucket for updates
   - Verify GitHub repository changes
   - Ensure changes are published

---

## Integration-Specific Issues

### Claude Desktop

**Problem: Configuration Not Loading**

1. Verify file location:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. Check JSON syntax:
   ```bash
   # Validate JSON
   cat claude_desktop_config.json | python -m json.tool
   ```

3. Restart Claude Desktop completely

**Problem: Tools Not Available**

- Verify server is enabled in config
- Check Claude Desktop version (requires recent version)
- Review Claude Desktop logs

---

### ChatGPT

**Problem: Custom GPT Not Working**

1. Verify OpenAPI specification is valid
2. Check action configuration
3. Test endpoint directly with curl
4. Review ChatGPT action logs

**Problem: Action Timeout**

- Increase timeout in action settings
- Use filters to reduce response size
- Check MCP server health

---

### Cursor

**Problem: @ Mention Not Working**

1. Verify server name in settings
2. Check settings.json syntax
3. Reload Cursor window
4. Verify Cursor version supports MCP

**Problem: Slow Suggestions**

- Check network latency
- Verify MCP server health

---

### Kiro

**Problem: MCP Server Not Connected**

1. Check MCP Servers panel
2. Click "Reconnect"
3. Verify URL in settings
4. Review Kiro logs

**Problem: Auto-Approve Not Working**

- Check autoApprove list in config
- Verify tool names are correct
- Reload Kiro

---

### Amazon Q

**Problem: Extension Not Loading**

1. Check VS Code/IDE version
2. Verify Amazon Q extension enabled
3. Restart IDE
4. Check extension logs

**Problem: Authentication Failed**

- Re-authenticate with AWS Builder ID
- Check IAM permissions
- Verify AWS credentials

---

## Reporting an Issue

### Before Submitting an Issue

1. **Check This Guide**
   - Review relevant sections
   - Try suggested solutions

2. **Check Documentation**
   - [MCP Tools Reference](tools/README.md)
   - [Integration Guides](integration/)
   - [Common Use Cases](use-cases/README.md)

3. **Gather Information**
   - Error messages (full text)
   - Request ID (from error response)
   - Timestamp of issue
   - Steps to reproduce
   - Configuration (sanitized)

### Submit an Issue

**Include:**
- Description of issue
- Error messages
- Request ID
- Timestamp
- Steps to reproduce
- Configuration (remove sensitive data)

**GitHub Issues:** [atlantis-mcp-server/issues](https://github.com/63klabs/atlantis-mcp/issues)

---

## Diagnostic Commands

### Test MCP Server Health

```bash
# Test server is responding
curl -i -X POST https://mcp.atlantis.63klabs.net/mcp/v1
```

### Check Rate Limit Status

```bash
# Make request and check headers
curl -i -X POST https://mcp.atlantis.63klabs.net/mcp/v1

# Look for headers:
# X-RateLimit-Limit: 50
# X-RateLimit-Remaining: 45
# X-RateLimit-Reset: 1706284800
```

---

## Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 400 | Bad Request | Check input parameters |
| 401 | Unauthorized | Check URL or credentials |
| 404 | Not Found | Verify resource name and category |
| 429 | Rate Limit Exceeded | Wait for reset or self-host |
| 500 | Internal Server Error | Retry or contact support |
| 503 | Service Unavailable | Temporary issue, retry later |

---

## Frequently Asked Questions

**Q: Why am I getting rate limited?**

A: Public instance has 50 requests/hour limit. Self-host for higher limits or wait for reset.

**Q: Can I increase rate limits?**

A: In the future you will be able to register for a public or paid account, or self-host with custom limits.

**Q: Why don't I see my template?**

A: Check bucket configuration, verify template name, namespace, and category.

**Q: How do I clear the cache?**

A: Cache expires automatically. For self-hosted, clear DynamoDB/S3 cache manually.

**Q: Why is data stale?**

A: Caching for performance. Wait for TTL expiration or adjust TTL in self-hosted instance.

**Q: Can I use this in production?**

A: Yes, but consider self-hosting for better performance and higher limits.

---

## Related Documentation

- [Integration Guides](../integration/README.md) - Set up your AI assistant
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [MCP Tools Reference](../tools/README.md) - Available tools and parameters

## Support

If you need help with a specific use case:

- Documentation: [Full Docs on GitHub](https://github.com/63klabs/atlantis-mcp)
- GitHub Issues: [Report Issue](https://github.com/63klabs/atlantis-mcp/issues)
