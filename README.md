# Atlantis MCP Server - Phase 1 (Core Read-Only)

> For use with template-pipeline.yml which can be deployed using [Atlantis Configuration Repository for Serverless Deployments using AWS SAM](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)

The Atlantis MCP (Model Context Protocol) Server provides AI-assisted development capabilities for the 63Klabs Atlantis Templates and Scripts Platform. It exposes read-only operations through a REST API that complies with the MCP protocol v1.0, enabling AI assistants and development tools to discover CloudFormation templates, starter code repositories, and documentation.

## Features

### Phase 1 - Read-Only Operations

- **Template Discovery**: List and retrieve CloudFormation templates from multiple S3 buckets with version support
- **Starter Code Discovery**: Discover application starter repositories from GitHub organizations
- **Documentation Search**: Search across Atlantis documentation, tutorials, and code patterns
- **Naming Validation**: Validate resource names against Atlantis naming conventions
- **Template Updates**: Check for available template updates and breaking changes
- **Multi-Source Support**: Aggregate data from multiple S3 buckets and GitHub organizations with priority ordering
- **Brown-Out Resilience**: Continue operation and return partial data when some sources fail
- **Public Access**: Rate-limited public access (100 requests/hour per IP) for read-only operations

### MCP Protocol Compliance

- Full MCP protocol v1.0 implementation
- JSON Schema validation for all tool inputs
- Standardized error responses
- Tool capability discovery

### Infrastructure

- API Gateway with rate limiting
- Lambda Function with gradual deployment in production
- Multi-tier caching (in-memory, DynamoDB, S3) via [@63klabs/cache-data](https://www.npmjs.com/package/@63klabs/cache-data)
- AWS X-Ray Tracing
- CloudWatch monitoring and dashboards
- Comprehensive logging with DebugAndLog

## Installation and Deployment

### Prerequisites

- AWS Account with appropriate permissions
- Atlantis Platform templates and configuration repository access
- GitHub token stored in SSM Parameter Store (for GitHub API access)
- S3 buckets tagged with `atlantis-mcp:Allow=true` and `atlantis-mcp:IndexPriority`
- GitHub repositories with `atlantis_repository-type` custom property

### Deployment

Deploy using the Atlantis Configuration Repository following the standard deployment workflow:

```
dev → test → beta → main
```

See the [Atlantis Configuration Repository](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments) for deployment instructions.

## Documentation

- [Requirements Document](./.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md)
- [Design Document](./.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md)
- [Implementation Tasks](./.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md)
- [Application Structure](./application-infrastructure/README-Application-Structure.md)

## MCP Tools

Phase 1 provides the following read-only MCP tools:

- `list_templates` - List available CloudFormation templates
- `get_template` - Retrieve specific template details
- `list_template_versions` - List all versions of a template
- `list_categories` - List template categories
- `list_starters` - List available starter code repositories
- `get_starter_info` - Get detailed starter repository information
- `search_documentation` - Search Atlantis documentation and code patterns
- `validate_naming` - Validate resource names against conventions
- `check_template_updates` - Check for template updates

## Configuration

The MCP server is configured via CloudFormation parameters:

- `ATLANTIS_S3_BUCKETS` - Comma-delimited list of S3 buckets for templates
- `ATLANTIS_GITHUB_USER_ORGS` - Comma-delimited list of GitHub users/orgs
- `PublicRateLimit` - Rate limit for public access (default: 100 requests/hour)
- Cache TTL parameters for each resource type
- `GitHubTokenParameter` - SSM parameter name for GitHub token
- `LogLevel` - Logging level (ERROR, WARN, INFO, DEBUG)

## AI Context

See [AGENTS.md](AGENTS.md) for important context and guidelines for AI-generated code in this repository.

The context file is also helpful (and perhaps essential) for HUMANS developing within the application's structured platform as well.
