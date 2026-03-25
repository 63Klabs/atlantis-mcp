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
