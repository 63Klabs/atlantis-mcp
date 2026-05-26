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
5. Authenticate with Amazon Q
6. Restart IDE


#### 2. Configure MCP Integration

To add the Atlantis MCP (Model Context Protocol) server to Amazon Q Developer, the easiest is to use the MCP Tools configuration (wrench icon in Q Chat window).

This will open "MCP Servers" configuration panel. Click on the plus `+` sign to add the new server with the following options:

- **Scope**:
  - **Global (all projects)**: Used globally.
  - **Per-workspace**: Only used in this workspace.
- **Name**: `atlantis-mcp`
- **Transport**: `http`
- **URL**: `https://mcp.atlantis.63klabs.net/mcp/v1`

Then choose "Save"

### Auto-Approve Tools

Configure which tools run without confirmation.

After saving, from the "atlantis-mcp" list of tools, choose "Always Allow" for each tool you do not wish to give confirmation for.

#### 3. Verify Connection

In Amazon Q chat:

```
Show me available Atlantis templates
```

### Option 2: JetBrains IDEs

#### 1. Install Amazon Q Plugin

1. Open Settings/Preferences
2. Go to Plugins
3. Search for "Amazon Q"
4. Click "Install"
5. Authenticate with Amazon Q
6. Restart IDE

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
            <option name="name" value="Atlantis" />
            <option name="enabled" value="true" />
          </McpServer>
        </value>
      </entry>
    </map>
  </option>
</component>
```

## Adding Your API Key

[Register for a free account](https://mcp.atlantis.63klabs.net/register/) to get an API key with higher [rate limits](https://mcp.atlantis.63klabs.net/docs/rate-limits/). After registration, copy your unique API key and add it to the configuration.

1. Open Q Chat and go to the MCP Tools
2. Select "atlantis-mcp" and "Edit"
3. Add the header key `x-api-key` with your key as the value (ex `atl_your_api_key_here`)

### JetBrains

Add the API key header to your `.idea/amazonq.xml`:

```xml
<component name="AmazonQSettings">
  <option name="mcpServers">
    <map>
      <entry key="atlantis">
        <value>
          <McpServer>
            <option name="url" value="https://mcp.atlantis.63klabs.net/mcp/v1" />
            <option name="name" value="Atlantis" />
            <option name="enabled" value="true" />
            <option name="headers">
              <map>
                <entry key="x-api-key" value="atl_your_api_key_here" />
              </map>
            </option>
          </McpServer>
        </value>
      </entry>
    </map>
  </option>
</component>
```

If you need to regenerate your key, visit your [profile page](https://mcp.atlantis.63klabs.net/profile/).

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Additional Resources

- Amazon Q Documentation: [aws.amazon.com/q/developer](https://aws.amazon.com/q/developer/)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp/) ([Issues](https://github.com/63klabs/atlantis-mcp/issues))
- [Atlantis DevOps Platform Documentation](https://github.com/63Klabs/atlantis)
