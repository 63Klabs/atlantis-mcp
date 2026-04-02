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
- Type "Open MCP Config"
- Or navigate to Kiro panel → MCP Servers

### 2. Add Atlantis MCP Server

Click "Open MCP Config":

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

### 3. Save and Reload

- Click "Save"
- Kiro will automatically connect to the server
- Verify connection in the MCP Servers panel

### 4. Verify Connection

In Kiro chat, ask:

```
Show me available Atlantis templates
```

### Custom MCP Configuration File for Workspace

Edit `.kiro/settings/mcp.json` in your workspace:

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

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Additional Resources

- Kiro Documentation: [kiro.ai/docs](https://kiro.ai/docs)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp-server/) ([Issues](https://github.com/63klabs/atlantis-mcp-server/issues))
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis)
