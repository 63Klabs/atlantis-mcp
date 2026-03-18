# Claude Desktop Integration Guide

This guide explains how to integrate the Atlantis MCP Server with Claude Desktop, enabling Claude to access Atlantis templates, documentation, and starter code.

## Prerequisites

- Claude Desktop application installed
- Access to the Atlantis MCP Server endpoint (public or self-hosted)
- Basic understanding of JSON configuration

## Configuration Steps

### 1. Locate Claude Configuration File

Claude Desktop stores MCP server configurations in a JSON file:

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

### 2. Add Atlantis MCP Server Configuration

Open the configuration file and add the Atlantis MCP Server:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "apiKey": "",
      "description": "Atlantis Templates and Scripts Platform MCP Server"
    }
  }
}
```

**For self-hosted instances:**

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod",
      "apiKey": "",
      "description": "Self-hosted Atlantis MCP Server"
    }
  }
}
```

**Note:** Phase 1 does not require an API key (public read-only access). Leave the `apiKey` field empty.

### 3. Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### 4. Verify Connection

In a new conversation with Claude, ask:

```
Can you list available Atlantis templates?
```

Claude should respond with a list of templates from the MCP server.

## Usage Examples

Once configured, you can ask Claude to:

### Discover Templates

```
Show me all available CloudFormation templates
```

```
What storage templates are available?
```

```
List templates in the Pipeline category
```

### Get Template Details

```
Get the template-pipeline.yml template
```

```
Show me the parameters for the storage template
```

```
What outputs does the network template provide?
```

### Check Template Versions

```
List all versions of template-pipeline.yml
```

```
Check if template-storage.yml v1.3.5 has updates
```

### Find Starter Code

```
Show me available application starters
```

```
Tell me about the atlantis-starter-02 repository
```

```
What starters include cache-data integration?
```

### Search Documentation

```
Search documentation for DynamoDB caching
```

```
Find code examples for Lambda functions
```

```
How do I implement CloudFront caching?
```

### Validate Naming

```
Validate this resource name: acme-person-api-test-GetPersonFunction
```

```
Is this S3 bucket name valid: acme-myapp-test-us-east-1-123456789012
```

```
How should I name my Lambda function?
```

## Advanced Configuration

### Custom Timeout

If you experience timeout issues, increase the timeout:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "apiKey": "",
      "timeout": 30000,
      "description": "Atlantis MCP Server with 30s timeout"
    }
  }
}
```

### Multiple Environments

Configure multiple Atlantis MCP Server instances:

```json
{
  "mcpServers": {
    "atlantis-prod": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "apiKey": "",
      "description": "Production Atlantis MCP Server"
    },
    "atlantis-test": {
      "url": "https://test-mcp.atlantis.63klabs.com/v1",
      "apiKey": "",
      "description": "Test Atlantis MCP Server"
    }
  }
}
```

### Proxy Configuration

If you're behind a corporate proxy:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "apiKey": "",
      "proxy": "http://proxy.company.com:8080",
      "description": "Atlantis MCP Server via proxy"
    }
  }
}
```

## Troubleshooting

### Connection Failed

**Problem:** Claude cannot connect to the MCP server.

**Solutions:**
1. Verify the URL is correct
2. Check your internet connection
3. Ensure Claude Desktop has network permissions
4. Try accessing the URL in a web browser

### Rate Limit Exceeded

**Problem:** Claude reports rate limit errors.

**Solutions:**
1. Wait for the rate limit window to reset (1 hour)
2. Reduce the frequency of requests
3. Consider self-hosting for higher limits
4. Contact support for increased limits

### Slow Responses

**Problem:** Claude takes a long time to respond.

**Solutions:**
1. Increase the timeout in configuration
2. Check your network latency
3. Verify the MCP server is healthy
4. Try during off-peak hours

### Invalid Configuration

**Problem:** Claude doesn't recognize the MCP server.

**Solutions:**
1. Verify JSON syntax is correct (use a JSON validator)
2. Ensure the configuration file is in the correct location
3. Restart Claude Desktop after making changes
4. Check Claude Desktop logs for errors

### Tool Not Found

**Problem:** Claude says a tool is not available.

**Solutions:**
1. Verify you're using the correct tool name
2. Check the [MCP Tools Reference](../tools/README.md) for available tools
3. Ensure the MCP server is running Phase 1
4. Try reconnecting to the server

## Best Practices

### 1. Be Specific in Requests

Instead of:
```
Show me templates
```

Use:
```
Show me all Pipeline templates
```

### 2. Use Filters

Take advantage of filtering capabilities:
```
Show me storage templates version v2.0.18
```

### 3. Validate Before Deploying

Always validate resource names:
```
Validate this name before I deploy: acme-myapp-test-MyFunction
```

### 4. Check for Updates

Regularly check for template updates:
```
Check if my templates have updates available
```

### 5. Search Documentation First

Before asking general questions, search documentation:
```
Search documentation for Lambda best practices
```

## Example Workflows

### Workflow 1: Starting a New Project

```
1. "Show me available application starters"
2. "Tell me about atlantis-starter-02"
3. "What templates do I need for a serverless API?"
4. "Get the template-pipeline.yml template"
5. "Validate this name: acme-myapi-test-ApiFunction"
```

### Workflow 2: Updating Infrastructure

```
1. "Check if template-pipeline.yml v2.0.17 has updates"
2. "Show me the changelog for template-pipeline.yml v2.0.18"
3. "Get template-pipeline.yml version v2.0.18"
4. "Are there breaking changes in v2.0.18?"
```

### Workflow 3: Learning Best Practices

```
1. "Search documentation for DynamoDB caching"
2. "Find code examples for cache-data package"
3. "What are the best practices for Lambda functions?"
4. "Show me CloudFormation patterns for S3 buckets"
```

## Security Considerations

- Phase 1 provides read-only access (no authentication required)
- No sensitive data is transmitted (templates and documentation only)
- Rate limiting prevents abuse
- All communication uses HTTPS
- No credentials are stored in Claude configuration

## Next Steps

- [MCP Tools Reference](../tools/README.md) - Detailed tool documentation
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting Guide](../troubleshooting/README.md) - Common issues

## Support

If you encounter issues:

1. Check the [Troubleshooting Guide](../troubleshooting/README.md)
2. Review Desktop App logs
3. Verify MCP server status

## Additional Resources

- [Claude Desktop Documentation](https://claude.ai/docs)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp-server/) ([Issues](https://github.com/63klabs/atlantis-mcp-server/issues))
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis)
