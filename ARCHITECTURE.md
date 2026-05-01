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
└────┬─────────┬───┘
     │         │
     │ POST    │ POST /auth/key/regenerate
     │ /mcp/v1 │ POST /auth/voucher/redeem
     │         │ GET  /auth/profile
     ▼         ▼
┌──────────┐ ┌──────────┐       ┌──────────────────┐
│  Read    │ │  Auth    │──────►│  Cognito         │
│  Lambda  │ │  Lambda  │       │  User Pool       │
└──┬───────┘ └──┬───────┘       └──────────────────┘
   │            │
   │            ├──────────────►┌──────────────────┐
   │            │               │  DynamoDB        │
   ├────────────┼──────────────►│  (Users)         │
   │            │               └──────────────────┘
   │            │
   │            └──────────────►┌──────────────────┐
   │                            │  SSM Parameter   │
   ├───────────────────────────►│  Store           │
   │                            └──────────────────┘
   │
   ├───────────────────────────►┌──────────────────┐
   │                            │  DynamoDB        │
   │                            │  (Sessions)      │
   │                            └──────────────────┘
   │
   ├───────────────────────────►┌──────────────────┐
   │                            │  DynamoDB        │
   │                            │  (DocIndex)      │
   │                            └──────────────────┘
   │
   ├───────────────────────────►┌──────────────────┐
   │                            │  S3 Buckets      │
   │                            │  (Templates &    │
   │                            │   Starters)      │
   │                            └──────────────────┘
   │
   ├───────────────────────────►┌──────────────────┐
   │                            │  GitHub API      │
   │                            └──────────────────┘
   │
   └───────────────────────────►┌──────────────────┐
                                │  DynamoDB + S3   │
                                │  (Cache-Data)    │
                                └──────────────────┘


┌──────────────────┐       ┌──────────────────┐
│  EventBridge     │──────►│  Doc Indexer     │
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


┌──────────────────┐       ┌──────────────────┐
│  Cognito         │──────►│  Auth Lambda     │  Post-Confirmation trigger
│  (Post-Confirm)  │       │  (trigger mode)  │  generates API key + user record
└──────────────────┘       └──────────────────┘


┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  CodeBuild       │──────►│  Post-Deploy     │──────►│  S3 Static       │
│  (Post-Deploy)   │       │  Scripts         │       │  Hosting Bucket  │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

## Core Components

### API Gateway

A single REST API (`WebApi`) with endpoints for MCP tool calls and authentication operations. The OpenAPI 3.0 specification (`template-openapi-spec.yml`) is embedded via `Fn::Transform` and defines request/response schemas, CORS configuration, and Lambda proxy integrations.

**Endpoints:**

| Method | Path | Lambda | Purpose |
|--------|------|--------|---------|
| POST | `/mcp/v1` | Read Lambda | MCP JSON-RPC 2.0 tool calls |
| POST | `/auth/key/regenerate` | Auth Lambda | Regenerate API key |
| POST | `/auth/voucher/redeem` | Auth Lambda | Redeem promotion voucher |
| GET | `/auth/profile` | Auth Lambda | Retrieve user profile |

### Read Lambda

The primary request handler. Receives all MCP tool calls through `POST /mcp/v1` and routes them internally based on the JSON-RPC `method` and tool name.

**Request lifecycle:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Read Lambda Handler                          │
│                                                                     │
│  1. Cold Start Init                                                 │
│     Config.init() → Config.promise() → Config.prime()               │
│                                                                     │
│  2. Parse Request                                                   │
│     ClientRequest(event, context) → Response(clientRequest)         │
│                                                                     │
│  3. Authenticate                                                    │
│     AuthResolver.resolveAuth(event)                                 │
│     ├─ No key → public tier (IP-based identity)                     │
│     ├─ Valid key → authenticated tier from Users table              │
│     └─ Invalid key → 401 Unauthorized                               │
│                                                                     │
│  4. Rate Limit                                                      │
│     RateLimiter.checkRateLimit(event, limits, authInfo)             │
│     ├─ Allowed → add rate-limit headers, continue                   │
│     └─ Exceeded → 429 Too Many Requests + Retry-After               │
│                                                                     │
│  5. Route & Process                                                 │
│     Routes.process(clientRequest, response)                         │
│     └─ JSON-RPC router → Controller → Service → Model               │
│                                                                     │
│  6. Finalize                                                        │
│     response.finalize() → API Gateway proxy response                │
└─────────────────────────────────────────────────────────────────────┘
```

**Internal structure (MVC-like):**

```
src/lambda/read/
├── index.js              # Handler entry point
├── config/               # Settings, connections, tool descriptions, validations
├── routes/               # JSON-RPC method routing
├── controllers/          # Tool dispatch: templates, starters, documentation, validation, updates
├── services/             # Business logic: template resolution, doc search, naming validation
├── models/               # Data access: S3, GitHub API, DynamoDB DocIndex
├── utils/                # Cross-cutting: auth-resolver, rate-limiter, json-rpc-router,
│                         #   content-chunker, error-handler, mcp-protocol, naming-rules
└── views/                # Response formatting (mcp-response)
```

**MCP tools served:**

| Tool | Controller | Description |
|------|-----------|-------------|
| `list_templates` | templates | List CloudFormation templates by category |
| `get_template` | templates | Retrieve full template content (with chunking for large templates) |
| `list_template_versions` | templates | Version history for a template |
| `check_template_updates` | updates | Check for newer template versions |
| `list_categories` | templates | List available template categories |
| `list_starters` | starters | List application starter repositories |
| `get_starter_info` | starters | Detailed starter metadata |
| `search_documentation` | documentation | Search indexed documentation |
| `validate_naming` | validation | Validate resource names against Atlantis conventions |
| `recommend` | documentation | Content recommendations for a documentation page |

### Auth Lambda

Handles server-side authentication operations. Dual-purpose: responds to Cognito triggers and API Gateway proxy events.

**Event routing:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Auth Lambda Handler                          │
│                                                                     │
│  Event Detection:                                                   │
│  ├─ triggerSource === 'PostConfirmation_ConfirmSignUp'              │
│  │   └─ handlers/post-confirmation.js                               │
│  │       ├─ Check blocked/allowed email domains                     │
│  │       ├─ Check blocked/allowed countries                         │
│  │       ├─ Generate API key (atl_ + 32 hex chars)                  │
│  │       ├─ HMAC-SHA256 hash with salt from SSM                     │
│  │       ├─ Store KEY#<hash> record in Users table                  │
│  │       ├─ Update Cognito custom:tier and custom:api_key           │
│  │       └─ Return raw key (displayed once to user)                 │
│  │                                                                  │
│  ├─ httpMethod + path (API Gateway proxy)                           │
│  │   └─ routes/index.js → route dispatcher                          │
│  │       ├─ POST /auth/key/regenerate                               │
│  │       │   └─ handlers/key-regenerate.js                          │
│  │       │       ├─ Validate JWT from Authorization header          │
│  │       │       ├─ Delete old KEY# record                          │
│  │       │       ├─ Generate new API key + hash                     │
│  │       │       ├─ Store new KEY# record                           │
│  │       │       └─ Return new raw key                              │
│  │       │                                                          │
│  │       ├─ POST /auth/voucher/redeem                               │
│  │       │   └─ handlers/voucher-redeem.js                          │
│  │       │       ├─ Validate JWT                                    │
│  │       │       ├─ Look up VOUCHER#<code> record                   │
│  │       │       ├─ Validate expiry, max uses, target tier          │
│  │       │       ├─ Increment voucher currentUses                   │
│  │       │       ├─ Update user tier + tierExpiresAt                │
│  │       │       └─ Return updated tier info                        │
│  │       │                                                          │
│  │       └─ GET /auth/profile                                       │
│  │           └─ handlers/profile.js                                 │
│  │               ├─ Validate JWT                                    │
│  │               ├─ Query Users table by email (GSI)                │
│  │               ├─ Compute effective tier (check expiry)           │
│  │               ├─ Look up rate limit usage from Sessions table    │
│  │               └─ Return profile + usage + rate limit info        │
│  │                                                                  │
│  └─ Unrecognized → 400 error                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Internal structure:**

```
src/lambda/auth/
├── index.js              # Handler entry point (event type detection + CORS)
├── handlers/
│   ├── post-confirmation.js   # Cognito trigger: key generation, domain checks
│   ├── key-regenerate.js      # API: regenerate API key
│   ├── voucher-redeem.js      # API: redeem promotion voucher
│   └── profile.js             # API: get user profile + usage stats
├── routes/
│   └── index.js               # Path-based route dispatcher
└── utils/
    ├── api-key.js             # Key generation (atl_ + 32 hex) and HMAC-SHA256 hashing
    ├── dynamo-client.js       # Users table CRUD + voucher lookups
    ├── jwt-validator.js       # Cognito JWT validation (JWKS fetch + signature verify)
    ├── rate-limit-config.js   # Tier-based rate limit configuration
    └── window-calculator.js   # Time window math for rate limit display
```

### Doc Indexer Lambda

A scheduled Lambda triggered by EventBridge (daily in production, weekly in test). Operates independently from the Read and Auth Lambdas.

**Pipeline:**

```
EventBridge Schedule
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Doc Indexer Lambda                              │
│                                                                     │
│  index-builder.js (orchestrator)                                    │
│  ├─ github-client.js → Fetch repo archives from configured orgs     │
│  ├─ archive-processor.js → Extract files from tar.gz archives       │
│  ├─ file-filter.js → Select indexable files by extension/path       │
│  ├─ Extractors (per file type):                                     │
│  │   ├─ markdown.js → Headings, sections, content                   │
│  │   ├─ cloudformation.js → Parameters, resources, outputs          │
│  │   ├─ jsdoc.js → Function signatures, descriptions                │
│  │   └─ python.js → Docstrings, function definitions                │
│  ├─ hasher.js → Content hashing for change detection                │
│  └─ dynamo-writer.js → Batch write index entries to DocIndex table  │
└─────────────────────────────────────────────────────────────────────┘
```

## Authentication and Access Tiers

The application implements a four-tier access model. Authentication is opt-in: requests without an API key are served at the public tier.

```mermaid
flowchart TD
    A[Incoming Request] --> B{API Key<br/>in header?}
    B -->|No| C[Public Tier<br/>IP-based identity]
    B -->|Yes| D[HMAC-SHA256 hash<br/>with salt from SSM]
    D --> E{KEY# record<br/>in Users table?}
    E -->|No| F[401 Unauthorized]
    E -->|Yes| G{tierExpiresAt<br/>passed?}
    G -->|No| H[Use stored tier]
    G -->|Yes| I[Downgrade to<br/>registered tier]
    H --> J[Rate Limit Check]
    I --> J
    C --> J
    J -->|Allowed| K[Process MCP Request]
    J -->|Exceeded| L[429 Too Many Requests<br/>+ Retry-After header]
```

### Tier Definitions

| Tier | Identity | Rate Limit | Window | How to Obtain |
|------|----------|-----------|--------|---------------|
| **public** | Client IP | 50 requests | 60 min | Default (no key) |
| **registered** | Cognito sub | 100 requests | 60 min | Free registration + email verification |
| **paid** | Cognito sub | 3,000 requests | 1,440 min (24h) | Voucher code redemption |
| **private** | Cognito sub | 6,000 requests | 1,440 min (24h) | Allowed domain auto-promotion or admin |

### API Key Format

- Format: `atl_` + 32 random hex characters (e.g., `atl_a1b2c3d4...`)
- Stored as HMAC-SHA256 hash in DynamoDB (raw key never persisted)
- Sent via `Authorization: Bearer atl_...` or `X-API-Key: atl_...` header
- Displayed to user exactly once at registration; can be regenerated

### Registration Flow

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant S as Static Site
    participant C as Cognito
    participant AL as Auth Lambda
    participant DB as Users Table
    participant SSM as SSM Params

    U->>S: Visit /register/
    U->>C: Sign up (email + password)
    C->>U: Verification email
    U->>C: Confirm email code
    C->>AL: PostConfirmation trigger
    AL->>SSM: Get hash salt, blocked/allowed domains
    AL->>AL: Check domain restrictions
    AL->>AL: Generate API key (atl_ + 32 hex)
    AL->>AL: HMAC-SHA256 hash key
    AL->>DB: Store KEY#<hash> record
    AL->>C: Update custom:tier, custom:api_key
    AL-->>C: Return event with rawApiKey
    C-->>U: Confirmation complete
    U->>S: Visit /profile/
    S->>C: Authenticate (SRP)
    S->>S: Display API key (once)
```

### SSM Parameters for Authentication

| Parameter | Purpose | Default |
|-----------|---------|---------|
| `Mcp_ApiKeyHashSalt` | HMAC key for API key hashing | Auto-generated 256-bit hex |
| `Mcp_AllowedPrivateDomains` | Email domains for auto private tier | `BLANK` |
| `Mcp_BlockedEmailDomains` | Blocked email domains | `BLANK` |
| `Mcp_AllowedEmailDomains` | Allowed email domains (allowlist) | `BLANK` (all allowed) |
| `Mcp_BlockedCountries` | Blocked country codes (ISO 3166-1 alpha-2) | `BLANK` |
| `Mcp_AllowedCountries` | Allowed country codes | `BLANK` (all allowed) |

## Data Stores

### DynamoDB Tables

```
┌─────────────────────────────────────────────────────────────────────┐
│  Users Table (Prefix-ProjectId-StageId-Users)                       │
│  Billing: PAY_PER_REQUEST                                           │
│                                                                     │
│  Partition Key: pk (String)                                         │
│  GSI: email-index (email → all attributes)                          │
│  TTL: ttl                                                           │
│                                                                     │
│  Record Types:                                                      │
│  ├─ KEY#<hmac_sha256_hash>                                          │
│  │   { email, tier, cognitoSub, createdAt, tierExpiresAt }          │
│  └─ VOUCHER#<code>                                                  │
│      { targetTier, durationDays, maxUses, currentUses,              │
│        expiresAt, createdBy }                                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Sessions Table (Prefix-ProjectId-StageId-sessions)                 │
│  Billing: PAY_PER_REQUEST                                           │
│                                                                     │
│  Partition Key: pk (String)                                         │
│  TTL: ttl                                                           │
│                                                                     │
│  Stores per-client rate limit counters with atomic updates.         │
│  Key format: hashed client identifier + time window.                │
│  TTL auto-cleans expired windows.                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  DocIndex Table (Prefix-ProjectId-StageId-DocIndex)                 │
│  Billing: PAY_PER_REQUEST                                           │
│                                                                     │
│  Partition Key: pk (String)                                         │
│  Sort Key: sk (String)                                              │
│  TTL: ttl                                                           │
│                                                                     │
│  Stores indexed documentation: main index entries, search           │
│  keywords, section content, and version pointers.                   │
│  Populated by the Doc Indexer Lambda on schedule.                   │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Cache-Data Table (cross-stack import: Prefix-CacheDataDynamoDbTable)│
│                                                                      │
│  Shared caching layer from @63klabs/cache-data package.              │
│  DynamoDB stores cache metadata; S3 stores large cached responses.   │
│  Imported via CloudFormation cross-stack references.                 │
└──────────────────────────────────────────────────────────────────────┘
```

### S3 Buckets

- **Template/Starter Buckets** — Source of truth for CloudFormation templates and starter code archives. Configured via `AtlantisS3Buckets` parameter. Must have `atlantis-mcp:Allow=true` tag.
- **Cache-Data Bucket** — Stores large cached responses (cross-stack import from `@63klabs/cache-data` storage stack).
- **Static Hosting Bucket** — Hosts the documentation site and authentication pages. Populated by the post-deploy pipeline.

### SSM Parameter Store

Stores sensitive configuration as SecureString parameters:
- GitHub API token
- Cache encryption key
- API key hash salt (`Mcp_ApiKeyHashSalt`)
- Domain and country restriction lists
- Cognito User Pool ID (for Auth Lambda API endpoints)

### Cognito User Pool

Per-stage user pool managing registration, email verification, and authentication.

- Username attribute: email
- Auto-verified: email
- Custom attributes: `custom:tier` (string), `custom:api_key` (string, stores hash)
- Password policy: 8+ chars, uppercase, lowercase, number, symbol
- Client: no secret (browser SDK), SRP auth + refresh token flows
- Post-Confirmation trigger: Auth Lambda

## Static Site

The static documentation site is hosted on S3 and includes both generated API documentation and authentication pages.

```
Static Site Structure:
├── index.html                    # Landing page with "Manage Account" link
├── css/index.css                 # Shared styles
├── register/index.html           # Cognito sign-up form
├── login/index.html              # Cognito sign-in form
├── profile/index.html            # User profile, API key display, voucher redemption
├── docs/
│   ├── index.html                # Documentation index
│   └── rate-limits/index.html    # Rate limit tiers documentation
├── api-docs/                     # Generated Redoc API reference (from OpenAPI spec)
└── [topic]/                      # Generated HTML from Markdown docs (tools, integration, etc.)
```

The authentication pages use the `amazon-cognito-identity-js` browser SDK loaded from CDN. Rate limit values and other configuration are injected at deploy time from `settings.json` via token replacement in the post-deploy scripts.

## Post-Deploy Pipeline

After the CloudFormation stack deploys, a separate CodeBuild project runs the post-deploy buildspec to generate and publish the static documentation site.

```
┌──────────────────────────────────────────────────────────────────────┐
│  01-export-api-spec.sh                                               │
│  Query CloudFormation for the REST API ID, then export the resolved  │
│  OpenAPI 3.0 spec from API Gateway as JSON                           │
└────────┬─────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  02-generate-api-docs.sh                                             │
│  Resolve $ref pointers in the exported spec and generate a           │
│  single-page Redoc HTML site                                         │
└────────┬─────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  03-generate-markdown-docs.sh                                        │
│  Convert end-user Markdown docs (tools, integration, use-cases,      │
│  troubleshooting) to HTML via Pandoc                                 │
└────────┬─────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  04-consolidate-and-deploy.sh                                        │
│  Merge API docs, Markdown HTML, static assets, and auth pages into   │
│  a final directory. Apply settings.json token replacement. Sync to   │
│  S3 for static hosting.                                              │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  S3 Static       │  Published documentation site + auth pages
│  Hosting Bucket  │
└──────────────────┘
```

## Build Pipeline

The main build (`buildspec.yml`) runs during the CodePipeline deploy phase:

1. **Install** — Node.js + Python runtimes, npm dependencies, pip dependencies for build scripts
2. **Pre-build** — Run tests for all Lambda functions, create SSM parameters (hash salt, domain lists) if they don't exist
3. **Build** — Package Lambda functions, run `sam build`
4. **Post-build** — SAM package and prepare artifacts

SSM parameters are created using the `generate-put-ssm.py` build script, which only writes parameters that don't already exist (no overwrites).

## Environment Strategy

| Branch | StageId | DeployEnvironment | Characteristics |
|--------|---------|-------------------|-----------------|
| test   | test    | TEST              | Immediate deploys, short log retention, verbose logging, no alarms/dashboards |
| beta   | beta    | PROD              | Gradual deploys, long log retention, alarms, dashboards |
| main   | prod    | PROD              | Gradual deploys, long log retention, alarms, dashboards |

Production environments use CodeDeploy gradual deployment (`Linear10PercentEvery3Minutes` by default) with automatic rollback on CloudWatch alarm triggers.

### Conditional Resources (PROD only)

- CloudWatch Alarms: Read Lambda errors, Read Lambda latency, API Gateway errors, Doc Indexer errors
- SNS Topics: Email notifications on alarm triggers
- CloudWatch Dashboard: Operational visibility across all components

## Monitoring

### CloudWatch Alarms (Production)

| Alarm | Metric | Threshold | Period |
|-------|--------|-----------|--------|
| Read Lambda Errors | Errors (Sum) | > 1 | 15 min |
| Read Lambda Latency | Duration (Avg) | > 5,000 ms | 5 min (2 eval periods) |
| API Gateway Errors | Errors (Sum) | > 1 | 15 min |
| Doc Indexer Errors | Errors (Sum) | > 1 | 15 min |

### Observability

- **X-Ray Tracing** — Enabled for API Gateway and Lambda functions environments
- **Lambda Insights** — CloudWatch Lambda Insights layer enabled on all Lambda functions environments
- **Structured Logging** — JSON-formatted logs with level, event, and context fields
- **API Gateway Logging** — Access logs (JSON format) and execution logs (optional, admin-enabled)

## Resource Naming

All resources follow the Atlantis naming convention:

```
<Prefix>-<ProjectId>-<StageId>-<ResourceId>
```

S3 buckets include AccountId and Region (and optionally, an Organization Prefix) for global uniqueness. S3 Account Regional Namespaces are preferred. See the `validate_naming` MCP tool for programmatic validation of resource names.

## Dependencies

### Runtime

- **Node.js 24.x** — Lambda runtime for all three functions
- **@63klabs/cache-data** — Shared caching layer (DynamoDB + S3)
- **AWS SDK v3** — DynamoDB, SSM, Cognito, S3 clients (available in Lambda runtime)
- **amazon-cognito-identity-js** — Browser SDK for static site authentication pages (CDN)

### Build/Deploy

- **AWS SAM** — CloudFormation transform for serverless resources
- **Pandoc** — Markdown to HTML conversion for documentation
- **Redoc** — OpenAPI spec to HTML documentation (CDN, no CLI install)
- **Python 3** — Build scripts for SSM parameter creation and template configuration

## Operating Cost Estimate

This section estimates the monthly operating cost of the full Atlantis MCP Server application stack. All resources use serverless, pay-per-use pricing with no fixed infrastructure costs. The application can sit completely idle at zero cost.

Prices are for **us-east-1** (N. Virginia). Other regions may vary by up to 25%. Estimates exclude data transfer out, which is negligible for API-only workloads.

### Service Pricing Reference

| Service | Pricing (us-east-1) | Free Tier |
|---------|---------------------|-----------|
| API Gateway (REST) | $3.50 / 1M requests | 1M requests/month (12 months) |
| Lambda requests | $0.20 / 1M requests | 1M requests/month (always free) |
| Lambda compute (ARM) | $0.0000133334 / GB-second | 400K GB-seconds/month (always free) |
| DynamoDB on-demand reads | $0.25 / 1M read request units | 25 RRU/month (always free) |
| DynamoDB on-demand writes | $1.25 / 1M write request units | 25 WRU/month (always free) |
| DynamoDB storage | $0.25 / GB-month | 25 GB (always free) |
| DynamoDB Streams (Lambda trigger) | **Free** | GetRecords invoked by Lambda are not charged |
| SSM Parameter Store (standard) | **Free** | No charge for standard parameters or API calls |
| Cognito User Pool | **Free** up to 50,000 MAUs | 50K MAUs (always free, Lite plan) |
| CloudWatch Logs ingestion | $0.50 / GB | 5 GB/month (always free) |
| CloudWatch Logs storage | $0.03 / GB-month | 5 GB (always free) |
| CloudWatch Alarms | $0.10 / standard alarm | 10 alarms (always free) |
| EventBridge scheduled rules | **Free** | All default bus rules are free |
| X-Ray traces | $5.00 / 1M traces recorded | 100K traces/month (always free) |
| S3 storage (static site) | $0.023 / GB-month | 5 GB (12 months) |

Sources: [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [SSM](https://aws.amazon.com/systems-manager/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/)

### Application Resources Inventory

| Resource | Type | Billing Model |
|----------|------|---------------|
| WebApi | API Gateway REST API | Per request |
| ReadLambdaFunction | Lambda (1024 MB, ARM, 10s timeout) | Per request + duration |
| AuthLambdaFunction | Lambda (512 MB, ARM, 10s timeout) | Per request + duration |
| CleanupFunction | Lambda (256 MB, ARM, 30s timeout) | Per request + duration |
| DocIndexerFunction | Lambda (1024 MB, ARM, 900s timeout) | Per request + duration |
| UsersTable | DynamoDB (on-demand, GSI, TTL, Streams) | Per read/write |
| DynamoDbSessions | DynamoDB (on-demand, TTL) | Per read/write |
| DocIndexTable | DynamoDB (on-demand, TTL) | Per read/write |
| Cache-Data table + S3 | DynamoDB + S3 (cross-stack) | Per read/write + storage |
| CognitoUserPool | Cognito User Pool | Per MAU |
| SSM Parameters (~8) | SSM Parameter Store (standard) | Free |
| CloudWatch Log Groups (5) | CloudWatch Logs | Per GB ingested |
| CloudWatch Alarms (4) | CloudWatch Alarms (PROD only) | Per alarm |
| EventBridge Rule (1) | EventBridge scheduled rule | Free |
| S3 Static Site | S3 + CloudFront (separate stack) | Storage + transfer |

### Scenario 1: Minimal Use — Test Instance at Rest

A test environment with no traffic. The Doc Indexer runs weekly. No users are registered. This represents the baseline cost of having the stack deployed.

**Assumptions:**
- 0 API requests
- Doc Indexer runs 4 times/month (weekly), ~60 seconds each at 1024 MB
- 0 registered users (no Cognito MAUs)
- DynamoDB tables exist but have no traffic
- No CloudWatch Alarms (TEST environment)
- Minimal log output (~1 KB per indexer run)

| Component | Calculation | Cost |
|-----------|-------------|------|
| API Gateway | 0 requests | $0.00 |
| Lambda — Read, Auth, Cleanup | 0 invocations | $0.00 |
| Lambda — Doc Indexer | 4 invocations × 60s × 1 GB = 240 GB-seconds | $0.00 (free tier) |
| DynamoDB — all tables | ~4 writes + ~4 reads (indexer) | $0.00 (free tier) |
| DynamoDB storage | < 1 MB across all tables | $0.00 (free tier) |
| Cognito | 0 MAUs | $0.00 |
| SSM Parameter Store | Standard params, ~4 reads | $0.00 |
| CloudWatch Logs | < 10 KB total | $0.00 (free tier) |
| CloudWatch Alarms | Not created in TEST | $0.00 |
| EventBridge rule | 1 scheduled rule | $0.00 |
| S3 static site | < 10 MB | $0.00 (free tier) |
| **Total** | | **$0.00 / month** |

The entire application stack costs nothing at rest. Every service is either always-free or within the free tier.

### Scenario 2: Production — 1,000,000 MCP Requests per Month

A production environment serving 1M MCP tool calls per month from AI assistants, plus authentication traffic and background indexing.

**Assumptions:**
- 1,000,000 POST /mcp/v1 requests (Read Lambda)
- 10,000 auth requests (key regeneration, profile, voucher — Auth Lambda)
- Doc Indexer runs daily (30 invocations/month), ~120 seconds each
- 500 registered users, 100 monthly active (Cognito MAUs)
- ~100 TTL-expired user records/month (Cleanup Lambda)
- Average Read Lambda duration: 500 ms at 1024 MB
- Average Auth Lambda duration: 200 ms at 512 MB
- Average log output: ~2 KB per Read Lambda invocation, ~1 KB per Auth invocation
- DynamoDB: each MCP request does ~2 reads (auth lookup + cache check) and ~1 write (session counter); cache misses trigger additional reads/writes
- 50% cache hit rate — 500K requests served from cache, 500K trigger origin fetches with cache writes

| Component | Calculation | Monthly Cost |
|-----------|-------------|-------------|
| **API Gateway** | 1,010,000 requests × $3.50/1M | $3.54 |
| **Lambda — Read** | 1M invocations × $0.20/1M | $0.20 |
| | 1M × 0.5s × 1 GB = 500K GB-sec × $0.0000133334 | $6.67 |
| **Lambda — Auth** | 10K invocations | $0.00 |
| | 10K × 0.2s × 0.5 GB = 1K GB-sec | $0.01 |
| **Lambda — Cleanup** | ~10 invocations (batches of 10) | $0.00 |
| **Lambda — Doc Indexer** | 30 × 120s × 1 GB = 3,600 GB-sec | $0.05 |
| **DynamoDB reads** | ~3M RRUs (auth + cache + sessions + doc search) | $0.75 |
| **DynamoDB writes** | ~1.5M WRUs (sessions + cache writes + indexer) | $1.88 |
| **DynamoDB storage** | ~2 GB across all tables (cache, users, sessions, index) | $0.50 |
| **Cognito** | 100 MAUs (under 50K free tier) | $0.00 |
| **SSM Parameter Store** | Standard params, cached reads | $0.00 |
| **CloudWatch Logs** | ~2 GB ingestion (Read Lambda dominant) | $1.00 |
| | ~2 GB storage (90-day retention) | $0.06 |
| **CloudWatch Alarms** | 4 standard alarms × $0.10 | $0.40 |
| **X-Ray** | ~1M traces (under free tier + sampling) | $0.00 |
| **EventBridge** | 1 scheduled rule | $0.00 |
| **S3 static site** | ~50 MB storage | $0.00 |
| **Total (before free tier)** | | **~$15.06 / month** |

### Free Tier Impact

The always-free tier significantly reduces costs, especially for Lambda and DynamoDB:

| Free Tier Credit | Savings |
|-----------------|---------|
| Lambda: 1M requests free | −$0.20 |
| Lambda: 400K GB-seconds free | −$5.33 |
| DynamoDB: 25 RRU + 25 WRU capacity (always free) | −$0.50 (est.) |
| DynamoDB: 25 GB storage free | −$0.50 |
| CloudWatch Logs: 5 GB ingestion free | −$1.00 |
| CloudWatch: 10 alarms free | −$0.40 |
| **Total free tier savings** | **−$7.93** |

### Cost Summary

| Scenario | Monthly Cost | Annual Cost |
|----------|-------------|-------------|
| Test instance at rest | $0.00 | $0.00 |
| 1M requests (with always-free tier) | ~$7.13 | ~$85.56 |
| 1M requests (no free tier) | ~$15.06 | ~$180.72 |

### Cost Breakdown by Service (1M Requests, Before Free Tier)

```
API Gateway     ████████████████████████  $3.54  (23%)
Lambda compute  ████████████████████████████████████████████  $6.93  (46%)
DynamoDB        █████████████████████  $3.13  (21%)
CloudWatch Logs ███████  $1.06  (7%)
CloudWatch Alarms ██  $0.40  (3%)
```

Lambda compute is the largest cost driver, followed by API Gateway and DynamoDB. The serverless architecture means costs scale linearly with traffic and drop to zero when idle.

### Cost Optimization Notes

- **API Gateway** is the single most expensive per-request component at $3.50/1M. Migrating to an HTTP API ($1.00/1M) would cut this cost by 71%, but HTTP APIs lack some REST API features used by this application (request validation, OpenAPI integration).
- **Lambda ARM (Graviton)** is already selected, saving 20% over x86 compute pricing.
- **DynamoDB on-demand** is cost-effective for unpredictable traffic. For sustained high-volume workloads, provisioned capacity with auto-scaling could reduce DynamoDB costs by 5–7x.
- **Cache-Data layer** reduces origin fetches to S3 and GitHub, keeping Lambda duration and DynamoDB reads lower than they would be without caching.
- **CloudWatch Logs** costs can be reduced by lowering log verbosity in production (already configured: INFO level in PROD vs DEBUG in TEST).
- **Cognito** is effectively free for this application's scale. The 50,000 MAU free tier far exceeds expected usage.
