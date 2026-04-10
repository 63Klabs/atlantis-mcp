# Architecture

The Atlantis MCP Server is a serverless application that exposes Atlantis platform resources (CloudFormation templates, starter code, documentation) to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP). It is built entirely on AWS managed services and deployed through the Atlantis CI/CD pipeline.

## High-Level Architecture

```
┌──────────────────┐
│   AI Assistant   │
│  (Claude, etc.)  │
└────────┬─────────┘
         │  JSON-RPC 2.0 over HTTPS
         ▼
┌──────────────────┐
│   API Gateway    │  ── OpenAPI 3.0 spec, CORS, request validation
│   (REST API)     │
└────────┬─────────┘
         │  POST /mcp/v1
         ▼
┌──────────────────┐       ┌──────────────────┐
│  Read Lambda     │─────► │  SSM Parameter   │  Credentials & config
│  (MCP Handler)   │       │  Store           │  (GitHub token, hash salt)
└───┬────┬────┬────┘       └──────────────────┘
    │    │    │
    │    │    └──────────► ┌──────────────────┐
    │    │                 │  GitHub API      │  Repository metadata
    │    │                 └──────────────────┘
    │    │
    │    └───────────────► ┌──────────────────┐
    │                      │  S3 Buckets      │  Templates & starters
    │                      └──────────────────┘
    │
    ├────────────────────► ┌──────────────────┐
    │                      │  DynamoDB        │  Rate limit sessions
    │                      │  (Sessions)      │
    │                      └──────────────────┘
    │
    ├────────────────────► ┌──────────────────┐
    │                      │  DynamoDB        │  Documentation search index
    │                      │  (DocIndex)      │
    │                      └──────────────────┘
    │
    └────────────────────► ┌──────────────────┐
                           │  DynamoDB + S3   │  Response caching
                           │  (Cache-Data)    │  (@63klabs/cache-data)
                           └──────────────────┘


┌──────────────────┐       ┌──────────────────┐
│  EventBridge     │──────►│  Doc Indexer     │  Scheduled index rebuild
│  (Cron Schedule) │       │  Lambda          │
└──────────────────┘       └───┬────┬─────────┘
                               │    │
                               │    └────────► ┌──────────────────┐
                               │               │  GitHub API      │
                               │               └──────────────────┘
                               │
                               └─────────────► ┌──────────────────┐
                                               │  DynamoDB        │
                                               │  (DocIndex)      │
                                               └──────────────────┘
```

## Core Components

### API Gateway

A single REST API with one endpoint (`POST /mcp/v1`) that accepts JSON-RPC 2.0 requests. The OpenAPI 3.0 specification (`template-openapi-spec.yml`) is embedded via `Fn::Transform` and defines request/response schemas, CORS configuration, and the Lambda proxy integration.

### Read Lambda

The primary request handler. Receives all MCP tool calls through a single endpoint and routes them internally based on the JSON-RPC `method` and tool name. Responsibilities:

- MCP protocol handling (JSON-RPC 2.0 initialize, tools/list, tools/call)
- Rate limiting per client IP using DynamoDB atomic counters
- Tool routing to controllers (templates, starters, documentation, validation, updates)
- Response caching via the `@63klabs/cache-data` package

### Doc Indexer Lambda

A scheduled Lambda triggered by EventBridge (daily in production, weekly in test). It:

- Fetches repository archives from GitHub for configured organizations
- Extracts documentation content (Markdown, JSDoc, CloudFormation, Python)
- Builds a searchable index in the DocIndex DynamoDB table
- Operates independently from the Read Lambda

### Data Stores

- **Sessions Table** (DynamoDB) — Per-client rate limit counters with TTL-based cleanup
- **DocIndex Table** (DynamoDB) — Persistent documentation search index with partition/sort key schema
- **Cache-Data** (DynamoDB + S3) — Shared caching layer from the `@63klabs/cache-data` package, imported via CloudFormation cross-stack references. DynamoDB stores cache metadata; S3 stores large cached responses
- **S3 Buckets** — Source of truth for CloudFormation templates and starter code archives
- **SSM Parameter Store** — Stores the GitHub API token, cache encryption key, and session hash salt as SecureString parameters

### Monitoring (Production)

- CloudWatch Alarms on Lambda errors and latency for both functions
- SNS email notifications on alarm triggers
- CloudWatch Dashboard for operational visibility
- X-Ray tracing enabled for request flow analysis

## Post-Deploy Pipeline

After the CloudFormation stack deploys, a separate CodeBuild project runs the post-deploy buildspec to generate and publish a static documentation site.

```
┌──────────────────┐
│  CodeBuild       │
│  (Post-Deploy)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│  01-export-api-spec.sh                               │
│  Query CloudFormation for the REST API ID, then      │
│  export the resolved OpenAPI 3.0 spec from           │
│  API Gateway as JSON                                 │
└────────┬─────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────┐
│  02-generate-api-docs.sh                             │
│  Resolve $ref pointers in the exported spec and      │
│  generate a single-page Redoc HTML site              │
└────────┬─────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────┐
│  03-generate-markdown-docs.sh                        │
│  Convert end-user Markdown docs (tools, integration, │
│  use-cases, troubleshooting) to HTML via Pandoc      │
└────────┬─────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────┐
│  04-consolidate-and-deploy.sh                        │
│  Merge API docs, Markdown HTML, and static assets    │
│  into a final directory, then sync to S3 for         │
│  static hosting                                      │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  S3 Static       │  Published documentation site
│  Hosting Bucket  │  (API reference + user guides)
└──────────────────┘
```

## Environment Strategy

| Branch | StageId | DeployEnvironment | Characteristics |
|--------|---------|-------------------|-----------------|
| test   | test    | TEST              | Immediate deploys, short log retention, verbose logging, no alarms/dashboards |
| beta   | beta    | PROD              | Gradual deploys, long log retention, alarms, dashboards |
| main   | prod    | PROD              | Gradual deploys, long log retention, alarms, dashboards |

Production environments use CodeDeploy gradual deployment (Linear10PercentEvery3Minutes by default) with automatic rollback on CloudWatch alarm triggers.

## Resource Naming

All resources follow the Atlantis naming convention:

```
<Prefix>-<ProjectId>-<StageId>-<ResourceId>
```

S3 buckets include AccountId and Region (and optionally, an Organization Prefix) for global uniqueness, however, S3 Account Regional Namespaces are preferred. See the `validate_naming` MCP tool for programmatic validation of resource names.
