# Cursor IDE Integration Guide

This guide explains how to integrate the Atlantis MCP Server with Cursor IDE, enabling AI-assisted development with access to Atlantis templates and documentation.

## Prerequisites

- Cursor IDE installed (version 0.30.0 or later)
- Access to the Atlantis MCP Server endpoint
- Basic understanding of JSON configuration

## Configuration Steps

### 1. Open Cursor Settings

- Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
- Or click Cursor menu → Settings

### 2. Navigate to MCP Settings

- Search for "MCP" in settings
- Or go to: Extensions → Model Context Protocol

### 3. Add Atlantis MCP Server

Click "Edit in settings.json" and add:

```json
{
  "mcp.servers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "name": "Atlantis Platform",
      "description": "CloudFormation templates, starters, and documentation",
      "enabled": true
    }
  }
}
```

**For self-hosted:**

```json
{
  "mcp.servers": {
    "atlantis": {
      "url": "https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod",
      "name": "Atlantis Platform (Self-Hosted)",
      "description": "Self-hosted Atlantis MCP Server",
      "enabled": true
    }
  }
}
```

### 4. Reload Cursor

- Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
- Type "Reload Window"
- Press Enter

### 5. Verify Connection

Open Cursor AI chat and ask:

```
@atlantis list available templates
```

## Usage in Cursor

### Using @ Mentions

Reference the Atlantis MCP Server with `@atlantis`:

```
@atlantis show me storage templates
```

```
@atlantis get template-pipeline.yml
```

```
@atlantis validate this name: acme-myapp-test-MyFunction
```

### Inline Code Assistance

While coding, Cursor can automatically suggest using Atlantis resources:

```javascript
// Type: "create a Lambda function following Atlantis conventions"
// Cursor will suggest proper naming and structure
```

### Template Insertion

Ask Cursor to insert templates directly:

```
@atlantis insert the pipeline template here
```

### Documentation Lookup

Get instant documentation:

```
@atlantis how do I implement caching?
```

## Example Workflows

### Workflow 1: Starting a New Lambda Function

```
1. Create new file: handler.js
2. Ask: "@atlantis show me Lambda starter code"
3. Ask: "@atlantis what naming convention should I use?"
4. Ask: "@atlantis validate: acme-myapi-test-Handler"
5. Cursor inserts properly named function
```

### Workflow 2: Adding CloudFormation Template

```
1. Create: template.yml
2. Ask: "@atlantis get template-pipeline.yml"
3. Cursor inserts template content
4. Ask: "@atlantis explain these parameters"
5. Cursor adds inline comments
```

### Workflow 3: Implementing Best Practices

```
1. Writing code
2. Ask: "@atlantis search documentation for DynamoDB caching"
3. Cursor shows relevant patterns
4. Ask: "@atlantis show me code examples"
5. Cursor suggests implementation
```

## Advanced Configuration

### Custom Keybindings

Add keyboard shortcuts for common actions:

```json
{
  "key": "cmd+shift+a",
  "command": "cursor.chat.focus",
  "args": "@atlantis "
}
```

### Workspace-Specific Settings

Create `.cursor/settings.json` in your project:

```json
{
  "mcp.servers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "enabled": true,
      "autoSuggest": true
    }
  }
}
```

### Auto-Suggestions

Enable automatic suggestions:

```json
{
  "mcp.autoSuggest": true,
  "mcp.suggestOnType": true
}
```

## Troubleshooting

### Server Not Responding

1. Check settings.json syntax
2. Verify URL is correct
3. Reload Cursor window
4. Check network connectivity

### @ Mention Not Working

1. Ensure server is enabled in settings
2. Verify server name matches configuration
3. Try reloading window
4. Check Cursor version (0.30.0+)

### Slow Responses

1. Check network latency
2. Verify MCP server health
3. Consider self-hosting for better performance

### Rate Limiting

If you hit rate limits:
1. Wait for reset (1 hour)
2. Reduce request frequency
3. Self-host for higher limits

## Best Practices

### 1. Use @ Mentions Consistently

Always prefix with `@atlantis` for clarity:
```
@atlantis show me templates
```

### 2. Be Specific

```
@atlantis show me Pipeline templates version v2.0.18
```

### 3. Validate Before Committing

```
@atlantis validate all my resource names
```

### 4. Search Documentation First

```
@atlantis search docs for Lambda best practices
```

### 5. Keep Templates Updated

```
@atlantis check for template updates
```

## Integration with Cursor Features

### Composer Mode

Use Atlantis in Composer for multi-file edits:

```
Composer: Create a new serverless API
@atlantis: Provide starter code and templates
Cursor: Generates complete project structure
```

### Terminal Integration

Run commands with Atlantis context:

```
Terminal: sam deploy
@atlantis: Validate template before deployment
```

### Git Integration

Validate before commits:

```
Pre-commit: @atlantis validate all resource names
```

## Security Considerations

- Read-only access (Phase 1)
- No authentication required
- HTTPS encryption
- Rate limiting active
- No sensitive data transmitted

## Performance Tips

1. **Cache Responses**: Cursor caches MCP responses
2. **Batch Requests**: Ask multiple questions together
3. **Use Filters**: Narrow searches with filters
4. **Local Development**: Self-host for best performance

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open Chat | `Cmd+L` | `Ctrl+L` |
| Focus Chat | `Cmd+Shift+L` | `Ctrl+Shift+L` |
| New Chat | `Cmd+Shift+N` | `Ctrl+Shift+N` |
| Settings | `Cmd+,` | `Ctrl+,` |

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting.md)

## Support

- Cursor Documentation: [cursor.sh/docs](https://cursor.sh/docs)
- Atlantis Support: support@63klabs.com
- GitHub Issues: [atlantis-mcp-server/issues](https://github.com/63klabs/atlantis-mcp-server/issues)
