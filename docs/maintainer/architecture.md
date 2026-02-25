# Architecture Documentation

## Overview

The Atlantis MCP Server is a serverless application that provides AI-assisted development capabilities for the 63Klabs Atlantis Templates and Scripts Platform. It follows a layered architecture pattern with clear separation of concerns.

## High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        AI[AI Assistants<br/>Claude, ChatGPT, Cursor, Kiro]
        IDE[IDEs & CLIs<br/>VS Code, Terminal]
    end

    subgraph "AWS Cloud"
        subgraph "API Layer"
            APIGW[API Gateway<br/>REST API<br/>Rate Limiting: 100 req/hr]
        end

        subgraph "Compute Layer"
            ReadLambda[Read Lambda<br/>Node.js 24.x<br/>Read-Only Operations]
            WriteLambda[Write Lambda<br/>Phase 2<br/>Write Operations]
        end

        subgraph "Caching Layer"
            Memory[In-Memory Cache<br/>Lambda Instance]
            DDB[DynamoDB<br/>Cache Table<br/>TTL: 300-3600s]
            S3Cache[S3 Cache Bucket<br/>Large Objects]
        end

        subgraph "Data Sources"
            S3Multi[Multiple S3 Buckets<br/>Templates & Starters<br/>Priority Ordering]
            GitHubMulti[Multiple GitHub Orgs<br/>Repositories<br/>Priority Ordering]
        end

        subgraph "Configuration"
            SSM[SSM Parameter Store<br/>GitHub Token<br/>Configuration]
        end

        subgraph "Monitoring"
            CW[CloudWatch<br/>Logs & Metrics]
            Alarms[CloudWatch Alarms<br/>Error Rates]
        end
    end

    AI -->|MCP Protocol| APIGW
    IDE -->|MCP Protocol| APIGW
    APIGW -->|Invoke| ReadLambda
    APIGW -.->|Phase 2| WriteLambda
    ReadLambda -->|Check| Memory
    ReadLambda -->|Check| DDB
    ReadLambda -->|Check| S3Cache
    ReadLambda -->|Fetch| S3Multi
    ReadLambda -->|Fetch| GitHubMulti
    ReadLambda -->|Load| SSM
    ReadLambda -->|Log| CW
    CW -->|Trigger| Alarms
```

## Component Architecture

### Lambda Function Structure

```
application-infrastructure/
├── src/
│   └── lambda/
│       ├── read/                          # Phase 1: Read-Only Operations
│       │   ├── index.js                   # Lambda handler entry point
│       │   ├── package.json               # Dependencies
│       │   ├── config/                    # Configuration management
│       │   │   ├── index.js               # Config initialization
│       │   │   ├── connections.js         # Cache-data connections
│       │   │   └── settings.js            # Application settings
│       │   ├── routes/                    # Request routing
│       │   │   └── index.js               # Route dispatcher
│       │   ├── controllers/               # Request handlers
│       │   │   ├── templates.js           # Template operations
│       │   │   ├── starters.js            # Starter operations
│       │   │   ├── documentation.js       # Documentation search
│       │   │   ├── validation.js          # Naming validation
│       │   │   └── updates.js             # Update checking
│       │   ├── services/                  # Business logic + caching
│       │   │   ├── templates.js           # Template service
│       │   │   ├── starters.js            # Starter service
│       │   │   ├── documentation.js       # Documentation service
│       │   │   └── validation.js          # Validation service
│       │   ├── models/                    # Data access objects
│       │   │   ├── s3-templates.js        # S3 template DAO
│       │   │   ├── s3-starters.js         # S3 starter DAO
│       │   │   ├── github-api.js          # GitHub API DAO
│       │   │   └── doc-index.js           # Documentation index DAO
│       │   ├── views/                     # Response formatting
│       │   │   └── mcp-response.js        # MCP protocol formatter
│       │   └── utils/                     # Utilities
│       │       ├── mcp-protocol.js        # MCP protocol helpers
│       │       ├── schema-validator.js    # JSON Schema validation
│       │       ├── naming-rules.js        # Naming convention rules
│       │       ├── error-handler.js       # Error handling
│       │       └── rate-limiter.js        # Rate limiting logic
│       └── write/                         # Phase 2: Write Operations
│           └── .gitkeep                   # Placeholder
```

### Layer Responsibilities

#### 1. Handler Layer (`index.js`)
- **Purpose**: Lambda entry point
- **Responsibilities**:
  - Cold start initialization
  - Config.init() invocation
  - Request delegation to router
  - Top-level error handling
  - API Gateway response formatting

#### 2. Routing Layer (`routes/`)
- **Purpose**: Request routing
- **Responsibilities**:
  - Extract MCP tool name from request
  - Route to appropriate controller
  - Handle 404 (unknown tools)
  - Handle 405 (unsupported methods)

#### 3. Controller Layer (`controllers/`)
- **Purpose**: Request handling and orchestration
- **Responsibilities**:
  - Input validation (JSON Schema)
  - Parameter extraction
  - Service orchestration
  - Error handling
  - Response formatting

#### 4. Service Layer (`services/`)
- **Purpose**: Business logic and caching
- **Responsibilities**:
  - Implement caching with cache-data
  - Define fetch functions for cache misses
  - Transform DAO data into business objects
  - Aggregate data from multiple sources
  - Handle cache invalidation

#### 5. Model Layer (`models/`)
- **Purpose**: Data access
- **Responsibilities**:
  - S3 API calls
  - GitHub API calls
  - Data parsing and transformation
  - Retry logic
  - Pagination handling
  - Brown-out support

#### 6. View Layer (`views/`)
- **Purpose**: Response formatting
- **Responsibilities**:
  - Format responses per MCP protocol
  - Include tool descriptions
  - Add usage examples
  - Format error responses

#### 7. Utility Layer (`utils/`)
- **Purpose**: Shared utilities
- **Responsibilities**:
  - MCP protocol helpers
  - JSON Schema validation
  - Naming convention validation
  - Error handling utilities
  - Rate limiting logic

## Data Flow Diagrams

### Request Flow: list_templates

```mermaid
sequenceDiagram
    participant Client
    participant APIGW as API Gateway
    participant Handler as Lambda Handler
    participant Router
    participant Controller as Templates Controller
    participant Service as Templates Service
    participant Cache as Cache Layer
    participant DAO as S3 Templates DAO
    participant S3

    Client->>APIGW: POST /mcp<br/>{tool: "list_templates"}
    APIGW->>APIGW: Check Rate Limit
    alt Rate Limit Exceeded
        APIGW-->>Client: 429 Too Many Requests
    else Within Limit
        APIGW->>Handler: Invoke Lambda
        Handler->>Handler: Config.init()<br/>(cold start only)
        Handler->>Router: Process Request
        Router->>Router: Extract tool name
        Router->>Controller: list(props)
        Controller->>Controller: Validate Input<br/>(JSON Schema)
        Controller->>Service: list({category, version})
        Service->>Cache: Check Cache
        alt Cache Hit
            Cache-->>Service: Cached Data
        else Cache Miss
            Service->>DAO: list(connection, options)
            DAO->>S3: ListObjectsV2<br/>(Bucket 1)
            S3-->>DAO: Template List
            DAO->>S3: ListObjectsV2<br/>(Bucket 2)
            S3-->>DAO: Template List
            DAO->>DAO: Aggregate & Deduplicate
            DAO-->>Service: Template Metadata
            Service->>Cache: Store in Cache
        end
        Service-->>Controller: Template List
        Controller->>Controller: Format MCP Response
        Controller-->>Router: Response
        Router-->>Handler: Response
        Handler-->>APIGW: API Gateway Response
        APIGW-->>Client: 200 OK<br/>Template List
    end
```

### Caching Flow

```mermaid
graph TB
    Request[Incoming Request] --> Service[Service Layer]
    Service --> CheckMemory{Check<br/>In-Memory<br/>Cache}
    CheckMemory -->|Hit| ReturnCached[Return Cached Data]
    CheckMemory -->|Miss| CheckDDB{Check<br/>DynamoDB<br/>Cache}
    CheckDDB -->|Hit| StoreMemory[Store in Memory]
    StoreMemory --> ReturnCached
    CheckDDB -->|Miss| CheckS3{Check<br/>S3 Cache}
    CheckS3 -->|Hit| StoreDDB[Store in DynamoDB]
    StoreDDB --> StoreMemory
    CheckS3 -->|Miss| FetchData[Fetch from Source]
    FetchData --> StoreS3[Store in S3 Cache]
    StoreS3 --> StoreDDB
    ReturnCached --> Response[Return Response]
```

### Multi-Source Data Aggregation

```mermaid
graph TB
    Service[Service Layer] --> Priority{Bucket/Org<br/>Priority Order}
    Priority --> Source1[Source 1<br/>Highest Priority]
    Priority --> Source2[Source 2]
    Priority --> Source3[Source 3<br/>Lowest Priority]
    
    Source1 --> Check1{Access<br/>Allowed?}
    Check1 -->|Yes| Fetch1[Fetch Data]
    Check1 -->|No| Log1[Log Warning]
    
    Source2 --> Check2{Access<br/>Allowed?}
    Check2 -->|Yes| Fetch2[Fetch Data]
    Check2 -->|No| Log2[Log Warning]
    
    Source3 --> Check3{Access<br/>Allowed?}
    Check3 -->|Yes| Fetch3[Fetch Data]
    Check3 -->|No| Log3[Log Warning]
    
    Fetch1 --> Aggregate[Aggregate Results]
    Fetch2 --> Aggregate
    Fetch3 --> Aggregate
    Log1 --> Aggregate
    Log2 --> Aggregate
    Log3 --> Aggregate
    
    Aggregate --> Dedupe[Deduplicate<br/>First Occurrence Wins]
    Dedupe --> Return[Return Results<br/>+ Error Info]
```

## Deployment Architecture

### CloudFormation Stack Structure

```
Atlantis MCP Server Stack
├── API Gateway
│   ├── REST API
│   ├── Usage Plan (Rate Limiting)
│   └── API Key (Optional)
├── Lambda Functions
│   ├── Read Function
│   │   ├── Execution Role
│   │   ├── Environment Variables
│   │   └── Layers (if needed)
│   └── Write Function (Phase 2)
├── DynamoDB
│   └── Cache Table
│       ├── TTL Enabled
│       └── On-Demand Billing
├── S3
│   └── Cache Bucket
│       ├── Lifecycle Rules
│       └── Encryption
├── CloudWatch
│   ├── Log Groups
│   ├── Alarms
│   └── Dashboards
└── IAM Roles
    ├── Lambda Execution Role
    ├── CloudFormation Service Role
    └── CodeBuild Service Role
```

### CI/CD Pipeline

```mermaid
graph LR
    Push[Git Push] --> Trigger[CodePipeline Trigger]
    Trigger --> Source[Source Stage<br/>GitHub/CodeCommit]
    Source --> Build[Build Stage<br/>CodeBuild]
    Build --> Test[Test Stage<br/>Unit Tests]
    Test --> Deploy[Deploy Stage<br/>CloudFormation]
    Deploy --> Validate[Validation Stage<br/>Integration Tests]
    Validate --> Complete[Deployment Complete]
```

## Security Architecture

### IAM Permissions Model

**Read Lambda Permissions** (Least Privilege):
- S3: GetObject, ListBucket, GetObjectVersion
- DynamoDB: GetItem, PutItem, Query, Scan
- SSM: GetParameter
- CloudWatch: PutMetricData, CreateLogStream, PutLogEvents

**Write Lambda Permissions** (Phase 2):
- All Read permissions
- S3: PutObject, DeleteObject
- DynamoDB: UpdateItem, DeleteItem
- CodeCommit: CreateRepository, PutFile
- Additional permissions as needed

### Data Flow Security

```mermaid
graph TB
    Client[Client] -->|HTTPS| APIGW[API Gateway]
    APIGW -->|IAM Auth| Lambda[Lambda Function]
    Lambda -->|IAM Role| S3[S3 Buckets<br/>Encryption at Rest]
    Lambda -->|IAM Role| DDB[DynamoDB<br/>Encryption at Rest]
    Lambda -->|IAM Role| SSM[SSM Parameter Store<br/>Encrypted Parameters]
    Lambda -->|HTTPS| GitHub[GitHub API<br/>Token Auth]
    Lambda -->|IAM Role| CW[CloudWatch Logs<br/>Encrypted]
```

## Scalability Considerations

### Lambda Concurrency
- **Reserved Concurrency**: Not set (uses account default)
- **Provisioned Concurrency**: Not used (cold starts acceptable)
- **Expected Load**: Low to moderate (100 req/hr per IP)

### Caching Strategy
- **In-Memory**: Lambda instance lifetime (minutes)
- **DynamoDB**: 5-60 minutes (configurable per resource type)
- **S3**: Large objects, longer TTL (60+ minutes)

### Rate Limiting
- **API Gateway**: 100 requests/hour per IP (configurable)
- **GitHub API**: Respect X-RateLimit-* headers
- **Fallback**: Return cached data when rate limited

## Monitoring and Observability

### CloudWatch Metrics
- Lambda invocations, duration, errors, throttles
- API Gateway requests, latency, 4xx/5xx errors
- DynamoDB read/write capacity, throttles
- Custom metrics: cache hit rate, source failures

### CloudWatch Logs
- Lambda execution logs (structured JSON)
- API Gateway access logs
- Error logs with stack traces
- Request/response logging (sanitized)

### CloudWatch Alarms
- Lambda error rate > 5%
- API Gateway 5xx error rate > 1%
- Lambda duration > 25 seconds
- DynamoDB throttling events

## Performance Characteristics

### Expected Latencies
- **Cache Hit**: 50-200ms
- **Cache Miss (S3)**: 500-2000ms
- **Cache Miss (GitHub)**: 1000-5000ms
- **Cold Start**: 2000-5000ms

### Optimization Strategies
- Multi-tier caching (memory, DynamoDB, S3)
- Parallel source fetching
- Lazy loading of documentation index
- Connection pooling (AWS SDK v3)
- Minimal dependencies

## Related Documentation

- [Lambda Function Structure](./lambda-structure.md)
- [Caching Strategy](./caching-strategy.md)
- [Brown-Out Support](./brown-out-support.md)
- [Namespace Discovery](./namespace-discovery.md)
- [Template Versioning](./template-versioning.md)
- [Testing Procedures](./testing.md)
