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
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
      "description": "Atlantis Templates and Scripts Platform MCP Server"
    }
  }
}
```

### 3. Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### 4. Verify Connection

In a new conversation with Claude, ask:

```
Can you list available Atlantis templates?
```

Claude should respond with a list of templates from the MCP server.

## Adding Your API Key

[Register for a free account](https://mcp.atlantis.63klabs.net/register/) to get an API key with higher [rate limits](https://mcp.atlantis.63klabs.net/docs/rate-limits/). After registration, copy your unique API key and add it to the configuration:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1",
      "headers": {
        "x-api-key": "atl_your_api_key_here"
      },
      "description": "Atlantis Templates and Scripts Platform MCP Server"
    }
  }
}
```

If you need to regenerate your key, visit your [profile page](https://mcp.atlantis.63klabs.net/profile/).

## Next Steps

- [MCP Tools Reference](../tools/README.md) - Detailed tool documentation
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting Guide](../troubleshooting/README.md) - Common issues

## Additional Resources

- [Claude Desktop Documentation](https://claude.ai/docs)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp/) ([Issues](https://github.com/63klabs/atlantis-mcp/issues))
- [63Klabs Atlantis DevOps Platform Documentation](https://github.com/63Klabs/atlantis)
