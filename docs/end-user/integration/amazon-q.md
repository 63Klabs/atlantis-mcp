# Amazon Q Developer Integration Guide

This guide explains how to integrate the Atlantis MCP Server with Amazon Q Developer, enabling AI-assisted development with access to Atlantis templates and documentation.

## Prerequisites

- Amazon Q Developer
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

To add the Atlantis MCP (Model Context Protocol) server to Amazon Q Developer, you configure it in a JSON file depending on your scope:

- **Per-workspace**: Create .amazonq/mcp.json in your workspace root.
- **Global (all projects)**: Create ~/.amazonq/mcp.json in your home directory.

The format looks like this:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

**For self-hosted instances**, replace the URL with your deployment:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://{api-gateway-url}/{api_base}/mcp/v1",
      "disabled": false,
      "autoApprove": []
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
            <option name="url" value="https://mcp.atlantis.63klabs.net/mcp/v1" />
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

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Additional Resources

- Amazon Q Documentation: [aws.amazon.com/q/developer](https://aws.amazon.com/q/developer/)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp/) ([Issues](https://github.com/63klabs/atlantis-mcp/issues))
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis)
