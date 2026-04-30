# Integration Guides

Connect the Atlantis MCP Server to your preferred AI assistant. Each guide walks through setup, configuration, and verification.

## Available Integrations

- [Kiro](kiro.md) - Kiro IDE with MCP support
- [Amazon Q](amazon-q.md) - AWS AI coding companion
- [ChatGPT](chatgpt.md) - OpenAI ChatGPT with custom actions
- [Claude](claude.md) - Anthropic Claude Desktop via MCP
- [Cursor](cursor.md) - Cursor IDE with MCP support

## Prerequisites

Before setting up any integration, ensure:

1. The Atlantis MCP Server is deployed and accessible
2. You have the server URL (e.g., `https://mcp.atlantis.63klabs.net/mcp/v1`)
3. Your AI assistant supports MCP or custom API actions

## API Key Authentication

The Atlantis MCP Server works without authentication at the public tier. Registering for an account and adding your API key to your MCP configuration unlocks higher rate limits and additional capabilities.

| Tier | How to access |
|------|---------------|
| Public | No API key needed — connect and start using |
| Registered | [Register for free](https://mcp.atlantis.63klabs.net/register/) and add your API key |
| Paid / Private | Contact us or redeem a promotion code on your [profile page](https://mcp.atlantis.63klabs.net/profile/) |

See the [rate limits page](https://mcp.atlantis.63klabs.net/docs/rate-limits/) for the full breakdown of request limits per tier.

### Getting your API key

1. [Register an account](https://mcp.atlantis.63klabs.net/register/)
2. After registration you will receive a unique API key — copy it immediately (it is shown only once)
3. If you lose your key, visit your [profile page](https://mcp.atlantis.63klabs.net/profile/) and regenerate it
4. Add the key to your AI assistant's MCP configuration (see the individual integration guides below)

Each integration guide includes the specific configuration for adding your API key.

---

## Related Documentation

- [MCP Tools Reference](../tools/README.md) - Available tools and parameters
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting Guide](../troubleshooting/README.md) - Common issues and solutions

## Support

If you need help with a specific use case:

- Documentation: [Full Docs on GitHub](https://github.com/63klabs/atlantis-mcp)
- GitHub Issues: [Report Issue](https://github.com/63klabs/atlantis-mcp/issues)
