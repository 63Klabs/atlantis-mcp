# Kiro IDE Integration Guide

This guide explains how to integrate the Atlantis MCP Server with Kiro IDE, enabling AI-assisted development with access to Atlantis templates and documentation.

## Prerequisites

- Kiro IDE installed
- Access to the Atlantis MCP Server endpoint
- Basic understanding of MCP configuration

## Configuration Steps

### 1. Open MCP Configuration

In Kiro IDE:
- Open Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
- Type "Open Kiro MCP UI"
- Or navigate to Settings → MCP Servers

### 2. Add Atlantis MCP Server

Click "Add Server" and configure:

**Server Name:** `atlantis`

**Server URL:** `https://mcp.atlantis.63klabs.com/v1`

**Description:** `Atlantis Templates and Scripts Platform`

**For self-hosted instances:**

**Server URL:** `https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod`

### 3. Configure Server Settings

**Authentication:** None (Phase 1 is public read-only)

**Timeout:** 30 seconds (default)

**Retry:** 3 attempts (default)

**Enable:** ✅ Checked

### 4. Save and Reload

- Click "Save"
- Kiro will automatically connect to the server
- Verify connection in the MCP Servers panel

### 5. Verify Connection

In Kiro chat, ask:

```
Show me available Atlantis templates
```

## Usage in Kiro

### Using MCP Tools

Kiro automatically detects when to use Atlantis MCP tools based on your questions:

**Template Discovery:**
```
What CloudFormation templates are available?
Show me storage templates
List all Pipeline templates
```

**Template Retrieval:**
```
Get the template-pipeline.yml template
Show me the parameters for template-storage.yml
What outputs does the network template provide?
```

**Documentation Search:**
```
How do I implement DynamoDB caching?
Search documentation for Lambda best practices
Find code examples for cache-data
```

**Naming Validation:**
```
Validate this name: acme-myapp-test-MyFunction
Is this S3 bucket name valid?
Check if my resource names follow conventions
```

**Version Management:**
```
List versions of template-pipeline.yml
Check if my templates have updates
Show me what changed in v2.0.18
```

### Context-Aware Assistance

Kiro uses file context to provide relevant suggestions:

**When editing CloudFormation templates:**
```
# Kiro automatically suggests Atlantis templates
# and validates resource naming
```

**When writing Lambda functions:**
```
# Kiro suggests naming conventions
# and references starter code patterns
```

**When viewing documentation:**
```
# Kiro can search related Atlantis docs
# and provide code examples
```

## Advanced Configuration

### Custom MCP Configuration File

Edit `.kiro/settings/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "atlantis": {
      "command": "node",
      "args": ["mcp-client.js"],
      "env": {
        "MCP_SERVER_URL": "https://mcp.atlantis.63klabs.com/v1"
      },
      "disabled": false,
      "autoApprove": [
        "list_templates",
        "search_documentation",
        "validate_naming"
      ]
    }
  }
}
```

### Auto-Approve Tools

Configure which tools run without confirmation:

```json
{
  "autoApprove": [
    "list_templates",
    "list_categories",
    "search_documentation",
    "validate_naming"
  ]
}
```

**Note:** `get_template` and `check_template_updates` require confirmation by default.

### Workspace-Specific Settings

Create `.kiro/settings/mcp.json` in your project:

```json
{
  "mcpServers": {
    "atlantis": {
      "command": "node",
      "args": ["mcp-client.js"],
      "env": {
        "MCP_SERVER_URL": "https://mcp.atlantis.63klabs.com/v1",
        "PROJECT_PREFIX": "acme",
        "PROJECT_ID": "myapp"
      }
    }
  }
}
```

### Environment Variables

Set project-specific variables:

```json
{
  "env": {
    "ATLANTIS_PREFIX": "acme",
    "ATLANTIS_PROJECT_ID": "myapp",
    "ATLANTIS_STAGE_ID": "test"
  }
}
```

Kiro will use these for automatic name validation.

## Example Workflows

### Workflow 1: Starting a New Project

```
1. User: "I'm starting a new serverless API"
2. Kiro: "Let me find relevant starters and templates"
   [Automatically uses list_starters and list_templates]
3. User: "Tell me about atlantis-starter-02"
4. Kiro: [Uses get_starter_info]
5. User: "Create a new Lambda function"
6. Kiro: [Generates code with proper naming]
7. User: "Validate the function name"
8. Kiro: [Uses validate_naming automatically]
```

### Workflow 2: Adding Infrastructure

```
1. User: "Add a pipeline template to my project"
2. Kiro: [Uses get_template for template-pipeline.yml]
3. Kiro: "Here's the template. Shall I add it to your project?"
4. User: "Yes, and explain the parameters"
5. Kiro: [Inserts template with inline comments]
```

### Workflow 3: Learning Best Practices

```
1. User: "How should I implement caching?"
2. Kiro: [Uses search_documentation]
3. Kiro: "Here are the recommended patterns..."
4. User: "Show me code examples"
5. Kiro: [Provides examples from documentation]
```

## Kiro-Specific Features

### Automatic Tool Selection

Kiro intelligently chooses which MCP tools to use:

- Detects template-related questions → uses template tools
- Detects naming questions → uses validate_naming
- Detects documentation needs → uses search_documentation

### Inline Validation

As you type resource names, Kiro validates them:

```javascript
const functionName = "acme-myapp-test-MyFunction"; // ✅ Valid
const badName = "my-function"; // ❌ Invalid - Kiro suggests fix
```

### Template Insertion

Kiro can insert templates directly into your files:

```
User: "Insert the pipeline template here"
Kiro: [Inserts template at cursor position]
```

### Documentation Tooltips

Hover over Atlantis resources for inline documentation:

```yaml
Resources:
  MyBucket:  # Hover shows S3 template documentation
    Type: AWS::S3::Bucket
```

## Troubleshooting

### Server Not Connected

1. Check MCP Servers panel for status
2. Verify URL is correct
3. Click "Reconnect" in MCP Servers panel
4. Check network connectivity

### Tools Not Working

1. Verify server is enabled
2. Check autoApprove settings
3. Review Kiro logs (Help → Show Logs)
4. Try manual tool invocation

### Slow Responses

1. Check network latency
2. Increase timeout in settings
3. Verify MCP server health
4. Consider self-hosting

### Rate Limiting

If you hit rate limits:
1. Check X-RateLimit-* headers in logs
2. Wait for reset (1 hour)
3. Reduce request frequency
4. Self-host for higher limits

## Best Practices

### 1. Let Kiro Choose Tools

Don't manually specify tools - Kiro knows when to use them:

```
✅ "Show me storage templates"
❌ "Use list_templates to show storage templates"
```

### 2. Provide Context

Give Kiro context about your project:

```
"I'm working on a Node.js Lambda API using Atlantis conventions"
```

### 3. Use Workspace Settings

Configure project-specific settings in `.kiro/settings/mcp.json`

### 4. Enable Auto-Approve

For frequently used tools, enable auto-approve to speed up workflow

### 5. Review Suggestions

Always review Kiro's suggestions before applying changes

## Integration with Kiro Features

### Hooks Integration

Create hooks that use Atlantis MCP:

```json
{
  "name": "Validate Names on Save",
  "when": {
    "type": "fileEdited",
    "patterns": ["*.yml", "*.yaml"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "Validate all resource names in this file using Atlantis conventions"
  }
}
```

### Spec Integration

Use Atlantis MCP in spec workflows:

```markdown
## Requirements
- Use Atlantis naming conventions
- Validate with @atlantis before deployment
```

### Terminal Integration

Kiro can validate before deployments:

```bash
# Before running sam deploy
# Kiro: "Let me validate your template first"
```

## Security Considerations

- Read-only access (Phase 1)
- No authentication required
- HTTPS encryption
- Rate limiting active
- No sensitive data transmitted
- Logs sanitized automatically

## Performance Tips

1. **Enable Caching**: Kiro caches MCP responses
2. **Use Auto-Approve**: Speeds up common operations
3. **Workspace Settings**: Project-specific configuration
4. **Batch Questions**: Ask multiple things together

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open Chat | `Cmd+L` | `Ctrl+L` |
| Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| MCP Servers | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Settings | `Cmd+,` | `Ctrl+,` |

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Support

- Kiro Documentation: [kiro.ai/docs](https://kiro.ai/docs)
- Atlantis Support: support@63klabs.com
- GitHub Issues: [atlantis-mcp-server/issues](https://github.com/63klabs/atlantis-mcp-server/issues)
