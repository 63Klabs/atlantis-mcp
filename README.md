# Atlantis MCP Server - Phase 1 (Core Read-Only)

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

- [Claude Desktop Integration](docs/integration/claude.md)
- [ChatGPT Integration](docs/integration/chatgpt.md)
- [Cursor IDE Integration](docs/integration/cursor.md)
- [Kiro IDE Integration](docs/integration/kiro.md)
- [Amazon Q Developer Integration](docs/integration/amazon-q.md)

## Documentation

### For Users
- [MCP Tools Reference](docs/tools/README.md) - Detailed documentation for each MCP tool
- [Common Use Cases](docs/use-cases/README.md) - Patterns and examples
- [Troubleshooting Guide](docs/troubleshooting/README.md) - Common issues and solutions

### For Organizations
- [Deployment Guide](docs/deployment/README.md) - How to deploy your own instance
- [CloudFormation Parameters](docs/deployment/cloudformation-parameters.md) - Configuration reference
- [GitHub Token Setup](docs/deployment/github-token-setup.md) - Configure GitHub integration
- [GitHub Custom Properties](docs/deployment/github-custom-properties.md) - Repository filtering setup
- [S3 Bucket Tagging](docs/deployment/s3-bucket-tagging.md) - Configure S3 buckets and tags
- [Multiple S3 Buckets](docs/deployment/multiple-s3-buckets.md) - Multi-bucket configuration
- [Multiple GitHub Orgs](docs/deployment/multiple-github-orgs.md) - Multi-org configuration
- [Sidecar Metadata (CodeBuild)](docs/deployment/sidecar-metadata-codebuild.md) - Generate metadata in CodeBuild
- [Sidecar Metadata (GitHub Actions)](docs/deployment/sidecar-metadata-github-actions.md) - Generate metadata in GitHub Actions
- [Self-Hosting Guide](docs/deployment/self-hosting.md) - Deploy your own instance

### For Maintainers
- [Architecture Overview](docs/maintainer/architecture.md) - System design and components
- [Lambda Structure](docs/maintainer/lambda-structure.md) - Function organization
- [Caching Strategy](docs/maintainer/caching-strategy.md) - Multi-tier caching implementation
- [Template Versioning](docs/maintainer/template-versioning.md) - Dual identifier system
- [Namespace Discovery](docs/maintainer/namespace-discovery.md) - S3 namespace indexing
- [Brown-Out Support](docs/maintainer/brown-out-support.md) - Partial data handling
- [Maintainer Guide](docs/maintainer/README.md) - Complete maintainer documentation

## Prerequisites

### For Using the Public Instance

No prerequisites - just configure your AI assistant to connect to the public Atlantis MCP Server endpoint.

### For Self-Hosting

- AWS Account with appropriate permissions
- Node.js 20.x or later
- AWS SAM CLI
- Access to Atlantis SAM Configuration Repository
- GitHub Personal Access Token (for private repository access)

## Architecture

The Atlantis MCP Server is built on AWS serverless services:

- **AWS Lambda**: Serverless compute for MCP request handling
- **API Gateway**: REST API with rate limiting
- **DynamoDB**: Cache storage for frequently accessed data
- **S3**: Template storage and cache overflow
- **Systems Manager Parameter Store**: Secure credential storage
- **CloudWatch**: Logging and monitoring

```
┌─────────────┐
│ AI Assistant│
└──────┬──────┘
       │ MCP Protocol
       ▼
┌─────────────┐
│ API Gateway │ ◄── Rate Limiting
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Lambda    │ ◄── Read-Only Operations
└──────┬──────┘
       │
       ├──► DynamoDB (Cache)
       ├──► S3 (Templates & Cache)
       └──► GitHub API (Metadata)
```

## Security

- **Read-Only Access**: Phase 1 provides only read operations
- **Rate Limiting**: Public access limited to 100 requests/hour per IP (configurable)
- **Least Privilege**: Lambda functions have minimal IAM permissions
- **No Authentication Required**: Public read access for discovery and documentation
- **Secure Credentials**: GitHub tokens stored in AWS Systems Manager Parameter Store

## Naming Convention

All Atlantis resources follow this naming pattern:

```
<Prefix>-<ProjectId>-<StageId>-<ResourceName>
```

Example: `acme-person-api-test-GetPersonFunction`

For S3 buckets:
```
<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
```

Use the `validate_naming` tool to verify your resource names follow these conventions.

## Caching Strategy

The MCP Server uses intelligent multi-tier caching:

1. **In-Memory Cache**: Fast access within Lambda invocation
2. **DynamoDB Cache**: Shared cache across invocations
3. **S3 Cache**: Long-term storage for large objects

Default TTL values:
- Template metadata: 1 hour
- Starter metadata: 1 hour  
- Documentation index: 6 hours
- Full template content: 24 hours

## Rate Limiting

Public access is rate-limited to prevent abuse:

- Default: 100 requests per hour per IP address
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)
- HTTP 429 returned when limit exceeded with `Retry-After` header

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
- **Phase**: 1 (Core Read-Only)
- **AWS Lambda Runtime**: Node.js 20.x
- **Cache Package**: @63klabs/cache-data

## Related Resources

- [Atlantis Template Repository](https://github.com/63Klabs/atlantis-cfn-template-repo-for-serverless-deployments)
- [Atlantis Configuration Repository](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [License](LICENSE.txt)

## Support

- **Issues**: [GitHub Issues](https://github.com/63klabs/atlantis-mcp-server/issues)
- **Documentation**: [Full Documentation](docs/README.md)
- **Email**: support@63klabs.com

## License

Copyright © 2025 63Klabs. All rights reserved.

See [LICENSE.txt](LICENSE.txt) for details.
