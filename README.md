# Atlantis MCP Server

The Atlantis MCP (Model Context Protocol) Server provides AI-assisted development capabilities for the 63Klabs Atlantis Templates and Scripts Platform. It enables developers to discover, validate, and utilize CloudFormation templates, starter code, and documentation through AI assistants and IDEs.

## Features

- **Template Discovery**: Browse and search CloudFormation templates across multiple S3 buckets
- **Template Retrieval**: Get full template content with metadata, parameters, and outputs
- **Version Management**: List template versions and check for updates
- **Starter Code Discovery**: Find and explore pre-configured application starters
- **Documentation Search**: Search across documentation, tutorials, and code patterns
- **Naming Validation**: Validate resource names against Atlantis conventions
- **Multi-Source Support**: Aggregate data from multiple S3 buckets and GitHub organizations
- **Intelligent Caching**: Fast responses with multi-tier caching strategy
- **Rate Limiting**: Public access with configurable rate limits

## Quick Start

This application is hosted by 63Klabs at [mcp.atlantis.63klabs.net](https://mcp.atlantis.63klabs.net). However, you may choose to self-host by [deploying atlantis-mcp](./DEPLOYMENT.md).

### For AI Assistant Users

The Atlantis MCP Server is designed to work seamlessly with AI assistants. Once configured, you can ask your AI assistant to:

```
"Show me available CloudFormation templates for storage"
"Get the latest version of the pipeline template"
"Find starter code for a Node.js Lambda function"
"Validate this resource name: acme-myapp-test-MyFunction"
"Search documentation for DynamoDB caching patterns"
```

See the [Integration Guides](#integration-guides) for setup instructions for your specific AI assistant.

### Available MCP Tools

The server exposes the following tools through the MCP protocol:

| Tool | Description |
|------|-------------|
| `list_templates` | List all available CloudFormation templates |
| `get_template` | Get specific template with full content and metadata |
| `list_template_versions` | List all versions of a specific template |
| `list_categories` | List template categories (storage, network, pipeline, etc.) |
| `list_starters` | List available application starter code repositories |
| `get_starter_info` | Get detailed information about a specific starter |
| `search_documentation` | Search documentation, tutorials, and code patterns |
| `validate_naming` | Validate resource names against Atlantis conventions |
| `check_template_updates` | Check if templates have newer versions available |

## Integration Guides

- [Kiro IDE Integration](docs/end-user/integration/kiro.md)
- [Amazon Q Developer Integration](docs/end-user/integration/amazon-q.md)
- [Claude Desktop Integration](docs/end-user/integration/claude.md)
- [ChatGPT Integration](docs/end-user/integration/chatgpt.md)
- [Cursor IDE Integration](docs/end-user/integration/cursor.md)

## Documentation

Documentation is divided into 3 user groups:

- [For Organizations](./docs/admin-ops/README.md)
- [For Developers](./docs/developer/README.md)
- [For End User](./docs/end-user/README.md)

End User documentation is aggregated and published to a static website (S3 fronted by CloudFront) when the Post Deployment stage is enabled in the deployment pipeline.

## Prerequisites

### For Using the Public Instance

No prerequisites - just configure your AI assistant to connect to the public Atlantis MCP Server endpoint.

### For Self-Hosting

- AWS Account with appropriate permissions
- Node.js 24.x or later
- AWS SAM CLI
- Access to Atlantis SAM Configuration Repository
- GitHub Personal Access Token (for private repository access)

## Caching Strategy

The MCP Server uses intelligent multi-tier caching provided by the [@63klabs/cache-data NPM package](https://github.com/63klabs/cache-data):

1. **In-Memory Cache**: Fast access within Lambda invocation
2. **DynamoDB Cache**: Shared cache across invocations
3. **S3 Cache**: Long-term storage for large objects

Default TTL values:
- Template metadata: 24 hours
- Starter metadata: 24 hours  
- Documentation index: 24 hours
- Full template content: 24 hours

> Values are all set to 24 hours during BETA release.

## Rate Limiting

Public access is rate-limited to prevent abuse:

- Default: 50 requests per hour per IP address
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)
- HTTP 429 returned when limit exceeded with `Retry-After` header

> Only public access with a limit of 50 requests per hpur per IP is available during BETA release.

## Multi-Source Support

The MCP Server aggregates data from multiple sources:

### Multiple S3 Buckets
- Configure multiple template buckets via `ATLANTIS_S3_BUCKETS` parameter
- Buckets searched in priority order
- Requires `atlantis-mcp:Allow=true` tag on buckets
- Namespace discovery via `atlantis-mcp:IndexPriority` tag

### Multiple GitHub Organizations
- Configure multiple GitHub users/orgs via `ATLANTIS_GITHUB_USER_ORGS` parameter
- Organizations searched in priority order
- Repository filtering via `atlantis_repository-type` custom property
- Automatic rate limit handling

## Brown-Out Support

The MCP Server continues operation even when some data sources fail:

- Returns available data from working sources
- Includes error information for failed sources
- Logs detailed errors for troubleshooting
- Ensures partial data is better than no data

## Version Information

- **MCP Protocol Version**: 1.0
- **AWS Lambda Runtime**: Node.js 24.x
- **Cache Package**: @63klabs/cache-data

## Related Resources

- [Atlantis Template Repository](https://github.com/63Klabs/atlantis-cfn-template-repo-for-serverless-deployments)
- [Atlantis Configuration Repository](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)

## Support

- **Issues**: [GitHub Issues](https://github.com/63klabs/atlantis-mcp-server/issues)
- **Documentation**: [Full Documentation](docs/README.md)

## Architecture

See [Architecture](./ARCHITECTURE.md)

## Deployment Guide

See [Deployment Guide](./DEPLOYMENT.md)

## Advanced Documentation

See [Docs Directory](./docs/README.md)

## AI Context

See [AGENTS.md](./AGENTS.md) for important context and guidelines for AI-generated code in this repository.

The agents file is also helpful (and perhaps essential) for HUMANS developing within the application's structured platform as well.

## Changelog

See [Change Log](./CHANGELOG.md)

## Security

See [Security](./SECURITY.md)

## Contributors

- [63Klabs](https://github.com/63klabs)
- [Chad Kluck](https://github.com/chadkluck)