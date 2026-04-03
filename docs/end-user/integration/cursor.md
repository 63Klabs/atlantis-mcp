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
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
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
      "url": "https://{api-gateway-url}/{api_base}/mcp/v1",
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

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Additional Resources

- Cursor Documentation: [cursor.sh/docs](https://cursor.sh/docs)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp/) ([Issues](https://github.com/63klabs/atlantis-mcp/issues))
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis)
