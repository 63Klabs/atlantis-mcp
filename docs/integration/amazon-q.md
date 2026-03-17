# Amazon Q Developer Integration Guide

This guide explains how to integrate the Atlantis MCP Server with Amazon Q Developer, enabling AI-assisted development with access to Atlantis templates and documentation.

## Prerequisites

- Amazon Q Developer subscription (Professional tier recommended)
- AWS account with appropriate permissions
- Access to the Atlantis MCP Server endpoint
- VS Code or JetBrains IDE with Amazon Q extension

## Configuration Steps

### Option 1: VS Code Extension

#### 1. Install Amazon Q Extension

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X or Ctrl+Shift+X)
3. Search for "Amazon Q"
4. Click "Install"

#### 2. Configure MCP Integration

Create or edit `.vscode/settings.json`:

```json
{
  "amazonQ.mcp.servers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "name": "Atlantis Platform",
      "description": "CloudFormation templates and documentation",
      "enabled": true
    }
  }
}
```

#### 3. Authenticate with Amazon Q

1. Click Amazon Q icon in sidebar
2. Sign in with AWS Builder ID or IAM Identity Center
3. Grant necessary permissions

#### 4. Verify Connection

In Amazon Q chat:
```
Show me available Atlantis templates
```

### Option 2: JetBrains IDEs

#### 1. Install Amazon Q Plugin

1. Open Settings/Preferences
2. Go to Plugins
3. Search for "Amazon Q"
4. Click "Install" and restart IDE

#### 2. Configure MCP Integration

Create or edit `.idea/amazonq.xml`:

```xml
<component name="AmazonQSettings">
  <option name="mcpServers">
    <map>
      <entry key="atlantis">
        <value>
          <McpServer>
            <option name="url" value="https://mcp.atlantis.63klabs.com/v1" />
            <option name="name" value="Atlantis Platform" />
            <option name="enabled" value="true" />
          </McpServer>
        </value>
      </entry>
    </map>
  </option>
</component>
```

#### 3. Authenticate and Verify

Follow same steps as VS Code above.

## Usage with Amazon Q

### Inline Code Suggestions

Amazon Q provides context-aware suggestions using Atlantis:

```javascript
// Type: "create Lambda function following Atlantis"
// Q suggests: proper naming and structure
```

### Chat Interface

Ask Amazon Q about Atlantis resources:

**Template Discovery:**
```
Q: Show me CloudFormation templates for storage
Q: What Pipeline templates are available?
Q: List all template categories
```

**Template Details:**
```
Q: Get template-pipeline.yml with all parameters
Q: Explain the outputs of template-storage.yml
Q: Show me version history for template-network.yml
```

**Documentation:**
```
Q: How do I implement DynamoDB caching with cache-data?
Q: Find Lambda function examples
Q: What are Atlantis naming conventions?
```

**Validation:**
```
Q: Validate this name: acme-myapp-test-MyFunction
Q: Check if my S3 bucket name is valid
Q: Verify all resource names in this file
```

### Code Actions

Right-click in editor:
- "Amazon Q: Validate Atlantis Naming"
- "Amazon Q: Insert Atlantis Template"
- "Amazon Q: Search Atlantis Documentation"

### Command Palette

Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux):
- "Amazon Q: List Atlantis Templates"
- "Amazon Q: Check Template Updates"
- "Amazon Q: Validate Resource Names"

## Advanced Configuration

### Workspace Settings

Create `.amazonq/config.json` in your project:

```json
{
  "mcp": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.com/v1",
      "autoSuggest": true,
      "context": {
        "prefix": "acme",
        "projectId": "myapp",
        "stageId": "test"
      }
    }
  }
}
```

### Auto-Suggestions

Enable automatic Atlantis suggestions:

```json
{
  "amazonQ.autoSuggest": true,
  "amazonQ.atlantis.enabled": true,
  "amazonQ.atlantis.validateOnSave": true
}
```

### Custom Prompts

Define custom prompts for common tasks:

```json
{
  "amazonQ.customPrompts": {
    "validateAtlantis": "Validate all resource names against Atlantis conventions",
    "insertPipeline": "Insert template-pipeline.yml with my project settings",
    "checkUpdates": "Check if my templates have updates available"
  }
}
```

## Integration with AWS Services

### CloudFormation Integration

Amazon Q can validate templates before deployment:

```
Q: Validate this CloudFormation template against Atlantis standards
Q: Check if this template follows naming conventions
Q: Suggest improvements for this template
```

### SAM Integration

Use with SAM CLI:

```bash
# Before sam deploy
Q: Validate my SAM template
Q: Check if resource names are correct
Q: Verify IAM permissions follow least privilege
```

### CodePipeline Integration

Integrate with CI/CD:

```
Q: Generate a pipeline using Atlantis templates
Q: Validate my pipeline configuration
Q: Check if my buildspec follows standards
```

## Example Workflows

### Workflow 1: New Serverless Application

```
1. Q: "I'm creating a new serverless API"
2. Q: [Suggests atlantis-starter-02]
3. User: "Show me the starter details"
4. Q: [Uses get_starter_info]
5. User: "Create project structure"
6. Q: [Generates files with proper naming]
7. Q: [Automatically validates names]
```

### Workflow 2: Adding Infrastructure

```
1. User: Creates template.yml
2. Q: "Would you like to use an Atlantis template?"
3. User: "Yes, pipeline template"
4. Q: [Inserts template-pipeline.yml]
5. Q: [Adds inline comments for parameters]
6. Q: [Validates resource names]
```

### Workflow 3: Code Review

```
1. User: Opens pull request
2. Q: [Automatically checks naming conventions]
3. Q: [Validates template structure]
4. Q: [Suggests improvements]
5. Q: [Checks for template updates]
```

## Amazon Q Specific Features

### Security Scanning

Amazon Q scans for security issues:

```
Q: Check this template for security issues
Q: Verify IAM policies follow least privilege
Q: Scan for hardcoded credentials
```

### Cost Optimization

Get cost insights:

```
Q: Estimate costs for this infrastructure
Q: Suggest cost optimizations
Q: Compare template versions for cost impact
```

### Best Practices

Amazon Q suggests best practices:

```
Q: Review this Lambda function for best practices
Q: Check if this follows Atlantis patterns
Q: Suggest improvements for performance
```

## Troubleshooting

### Extension Not Loading

1. Check VS Code/IDE version compatibility
2. Verify Amazon Q extension is enabled
3. Restart IDE
4. Check extension logs

### MCP Connection Failed

1. Verify URL in settings
2. Check network connectivity
3. Ensure Amazon Q has internet access
4. Try reconnecting

### Authentication Issues

1. Re-authenticate with AWS Builder ID
2. Check IAM permissions
3. Verify AWS credentials
4. Contact AWS support

### Rate Limiting

If you hit rate limits:
1. Amazon Q Professional has higher limits
2. Wait for reset (1 hour)
3. Consider self-hosting
4. Contact support for enterprise limits

## Best Practices

### 1. Use Professional Tier

Amazon Q Professional provides:
- Higher rate limits
- Better performance
- Advanced features
- Priority support

### 2. Enable Auto-Validation

Configure automatic validation on save:

```json
{
  "amazonQ.atlantis.validateOnSave": true
}
```

### 3. Leverage AWS Integration

Use Amazon Q's AWS integration:
- CloudFormation validation
- IAM policy analysis
- Cost estimation
- Security scanning

### 4. Customize for Your Project

Set project-specific context:

```json
{
  "context": {
    "prefix": "your-prefix",
    "projectId": "your-project",
    "stageId": "test"
  }
}
```

### 5. Review Suggestions

Always review Amazon Q's suggestions before applying

## Security Considerations

- Read-only access (Phase 1)
- No authentication required for MCP
- AWS credentials managed separately
- HTTPS encryption
- Rate limiting active
- Logs sanitized

## Performance Tips

1. **Use Professional Tier**: Better performance and limits
2. **Enable Caching**: Amazon Q caches responses
3. **Workspace Settings**: Project-specific configuration
4. **Batch Operations**: Process multiple files together

## Keyboard Shortcuts

### VS Code

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open Q Chat | `Cmd+I` | `Ctrl+I` |
| Inline Suggest | `Option+\` | `Alt+\` |
| Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |

### JetBrains

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open Q Chat | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| Quick Actions | `Option+Enter` | `Alt+Enter` |

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Support

- Amazon Q Documentation: [aws.amazon.com/q/developer](https://aws.amazon.com/q/developer/)
- Atlantis Support: support@63klabs.com
- AWS Support: [AWS Support Center](https://console.aws.amazon.com/support/)
- GitHub Issues: [atlantis-mcp-server/issues](https://github.com/63klabs/atlantis-mcp-server/issues)
