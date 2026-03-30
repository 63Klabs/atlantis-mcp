# Architecture

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

## Resource Naming Validation

The `validate_naming` tool uses anchor-based parsing to decompose resource names into components. Rather than splitting on hyphens (which fails when components themselves contain hyphens), the parser works from known fixed-format elements inward:

- Known values (prefix, projectId, orgPrefix) are stripped from the left
- Fixed-format anchors (12-digit AccountId, Region pattern, `-an` suffix) are identified from the right
- The StageId pattern is used as a heuristic boundary when known values are absent
- Ambiguous names without known values return an error with a disambiguation suggestion
