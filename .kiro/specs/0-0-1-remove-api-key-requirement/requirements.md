# Requirements Document

## Introduction

This document specifies the requirements for removing the API key authentication requirement from the Atlantis MCP Server. The current implementation uses a shared API key (`MCPPublicApiKey`) with API Gateway usage plans for rate limiting, which creates deployment issues due to missing CloudFormation service role permissions and provides a poor user experience where one heavy user can exhaust the quota for everyone.

The immediate goal is to enable keyless public access to fix deployment failures. The long-term goal is to prepare the architecture for future per-user authentication via account registration while maintaining backward compatibility with public access.

## Glossary

- **MCP_Server**: The Atlantis Model Context Protocol server that provides read-only operations for template discovery, starter code, and documentation
- **API_Gateway**: AWS API Gateway REST API that routes HTTP requests to Lambda functions
- **Usage_Plan**: API Gateway resource that defines throttling and quota limits for API access
- **API_Key**: API Gateway resource used for authentication and rate limiting
- **CloudFront**: AWS CloudFront CDN that will provide DDoS protection for the public API
- **WAF**: AWS Web Application Firewall that will provide additional security controls
- **Lambda_Authorizer**: Custom Lambda function that validates authentication tokens for API Gateway requests
- **Public_Access**: Unauthenticated access to the MCP server without API keys
- **Per_User_Auth**: Future authentication mechanism where each user has individual credentials and rate limits

## Requirements

### Requirement 1: Remove API Key Infrastructure

**User Story:** As a DevOps engineer, I want to deploy the MCP server without API key resources, so that deployment succeeds without requiring additional CloudFormation service role permissions.

#### Acceptance Criteria

1. THE MCP_Server SHALL NOT create the `MCPPublicApiKey` resource
2. THE MCP_Server SHALL NOT create the `MCPPublicUsagePlan` resource
3. THE MCP_Server SHALL NOT create the `MCPUsagePlanKey` resource
4. THE MCP_Server SHALL NOT include the `PublicRateLimit` parameter in CloudFormation templates
5. THE MCP_Server SHALL NOT include the `PublicRateLimit` parameter in SAM configuration files
6. WHEN the CloudFormation stack is deployed, THE Deployment SHALL succeed without `apigateway:GET` permissions

### Requirement 2: Enable Public Keyless Access

**User Story:** As an AI assistant user, I want to access the MCP server without providing an API key, so that I can use the service immediately without configuration.

#### Acceptance Criteria

1. THE API_Gateway SHALL accept POST requests to all `/mcp/*` endpoints without requiring an API key
2. THE OpenAPI_Specification SHALL NOT include API key security requirements
3. WHEN a client sends a request without an API key, THE MCP_Server SHALL process the request normally
4. THE API_Gateway SHALL NOT return 403 Forbidden errors due to missing API keys
5. THE API_Gateway SHALL maintain CORS configuration for cross-origin requests

### Requirement 3: Remove API Gateway Method Settings Rate Limiting

**User Story:** As a platform architect, I want to remove API Gateway-level rate limiting, so that rate limiting can be handled by CloudFront and WAF instead.

#### Acceptance Criteria

1. THE API_Gateway SHALL NOT configure `ThrottlingBurstLimit` in MethodSettings
2. THE API_Gateway SHALL NOT configure `ThrottlingRateLimit` in MethodSettings
3. THE CloudFormation_Template SHALL remove MethodSettings throttling configuration from the WebApi resource
4. WHEN the API is deployed, THE API_Gateway SHALL rely on default AWS service limits for throttling

### Requirement 4: Maintain API Gateway Logging Configuration

**User Story:** As a DevOps engineer, I want to maintain existing logging configuration, so that I can continue monitoring API usage and troubleshooting issues.

#### Acceptance Criteria

1. THE API_Gateway SHALL maintain AccessLogSetting configuration when ApiGatewayLoggingEnabled is TRUE
2. THE API_Gateway SHALL maintain execution logging MethodSettings when ApiGatewayLoggingEnabled is TRUE
3. THE CloudWatch_Log_Groups SHALL continue to capture access logs and execution logs
4. THE Logging_Configuration SHALL NOT be affected by the removal of API key resources

### Requirement 5: Update OpenAPI Specification

**User Story:** As an API consumer, I want the OpenAPI specification to accurately reflect the API's authentication requirements, so that I can generate correct client code.

#### Acceptance Criteria

1. THE OpenAPI_Specification SHALL NOT include `securitySchemes` for API keys
2. THE OpenAPI_Specification SHALL NOT include `security` requirements on any endpoint
3. THE OpenAPI_Specification SHALL maintain all existing endpoint definitions
4. THE OpenAPI_Specification SHALL maintain request and response schemas
5. THE OpenAPI_Specification SHALL maintain `x-amazon-apigateway-integration` configurations

### Requirement 6: Prepare for Future Per-User Authentication

**User Story:** As a platform architect, I want the architecture to support future per-user authentication, so that we can add user accounts without breaking existing public access.

#### Acceptance Criteria

1. THE API_Gateway_Configuration SHALL support adding Lambda authorizers without modifying existing endpoints
2. THE OpenAPI_Specification_Structure SHALL allow adding security schemes in the future
3. THE Lambda_Functions SHALL support receiving authorization context from API Gateway
4. WHEN per-user authentication is added, THE Public_Access SHALL remain available for unauthenticated users
5. THE Architecture SHALL support optional authentication where endpoints can be accessed with or without credentials

### Requirement 7: Maintain Backward Compatibility

**User Story:** As an existing MCP server user, I want the API endpoints to continue working after the update, so that my integrations don't break.

#### Acceptance Criteria

1. THE API_Endpoints SHALL maintain the same paths (`/mcp/list_templates`, `/mcp/get_template`, etc.)
2. THE API_Endpoints SHALL maintain the same HTTP methods (POST)
3. THE Request_Format SHALL remain unchanged (JSON-RPC 2.0)
4. THE Response_Format SHALL remain unchanged (JSON-RPC 2.0)
5. THE Lambda_Functions SHALL continue processing requests identically

### Requirement 8: Update Configuration Files

**User Story:** As a developer, I want SAM configuration files to be updated, so that local deployments work correctly.

#### Acceptance Criteria

1. THE `samconfig-test.toml` SHALL NOT include the `PublicRateLimit` parameter
2. THE `samconfig-prod.toml` SHALL NOT include the `PublicRateLimit` parameter
3. WHEN deploying with SAM CLI, THE Deployment SHALL NOT prompt for the removed parameter
4. THE Configuration_Files SHALL maintain all other existing parameters

### Requirement 9: Document Architecture Changes

**User Story:** As a platform maintainer, I want documentation explaining the architecture changes, so that I understand the security implications and future migration path.

#### Acceptance Criteria

1. THE Requirements_Document SHALL explain why API keys were removed
2. THE Requirements_Document SHALL document the future per-user authentication approach
3. THE Requirements_Document SHALL explain how CloudFront and WAF provide DDoS protection
4. THE Requirements_Document SHALL document the migration path for adding Lambda authorizers

### Requirement 10: Validate Deployment Success

**User Story:** As a DevOps engineer, I want to verify that the deployment succeeds, so that I can confirm the fix resolves the permission issue.

#### Acceptance Criteria

1. WHEN the CloudFormation stack is deployed, THE Deployment SHALL complete successfully
2. THE CloudFormation_Service_Role SHALL NOT require `apigateway:GET` permissions
3. THE API_Gateway SHALL be created with all endpoints functional
4. THE Lambda_Functions SHALL be invokable through API Gateway
5. WHEN a test request is sent to any endpoint, THE Response SHALL be successful

## Architecture Notes

### Current State

The current implementation uses:
- `MCPPublicApiKey`: A single shared API key for all users
- `MCPPublicUsagePlan`: Usage plan with throttling and quota limits
- `MCPUsagePlanKey`: Association between the API key and usage plan
- API Gateway MethodSettings: Throttling configuration at the API level

This approach has several issues:
1. **Deployment Failure**: CloudFormation service role lacks `apigateway:GET` permissions to create API keys
2. **Shared Rate Limiting**: All users share the same quota, so one heavy user affects everyone
3. **Poor User Experience**: Users must configure API keys before using the service
4. **No Per-User Tracking**: Cannot identify or limit individual users

### Target State

The target implementation will:
- Remove all API key resources from CloudFormation
- Enable public keyless access to all endpoints
- Rely on CloudFront and WAF for DDoS protection
- Prepare for future Lambda authorizer integration
- Support optional authentication (public + authenticated access)

### Future Per-User Authentication

When per-user authentication is implemented (Phase 2), the architecture will:

1. **Lambda Authorizer**: Custom Lambda function that validates JWT tokens or API keys
2. **User Registration**: API endpoints for user registration and API key generation
3. **DynamoDB User Table**: Store user accounts, API keys, and rate limit quotas
4. **Optional Authentication**: Endpoints accept both authenticated and unauthenticated requests
5. **Per-User Rate Limiting**: Lambda authorizer enforces individual user quotas
6. **Backward Compatibility**: Existing public access continues to work

Example Lambda authorizer flow:
```
1. Client sends request with Authorization header (optional)
2. API Gateway invokes Lambda authorizer
3. Lambda authorizer validates token/key
4. If valid: Return policy with user context (userId, tier, quota)
5. If invalid or missing: Return policy allowing public access with default limits
6. Lambda function receives authorization context
7. Lambda function enforces per-user rate limits
```

### CloudFront and WAF Protection

The API will be placed behind CloudFront and AWS WAF for DDoS protection:

1. **CloudFront**: Provides edge caching and absorbs traffic spikes
2. **AWS WAF**: Provides rate limiting, IP blocking, and bot detection
3. **WAF Rate Limiting**: Enforces requests per IP address limits
4. **WAF Geo Blocking**: Blocks traffic from specific countries if needed
5. **WAF Bot Control**: Identifies and blocks malicious bots

This provides protection without requiring API keys at the API Gateway level.

### Migration Path

The migration from current state to future per-user authentication:

**Phase 1 (This Spec)**: Remove API keys, enable public access
- Remove `MCPPublicApiKey`, `MCPPublicUsagePlan`, `MCPUsagePlanKey`
- Remove `PublicRateLimit` parameter
- Update OpenAPI spec to remove security requirements
- Deploy behind CloudFront/WAF for DDoS protection

**Phase 2 (Future Spec)**: Add per-user authentication
- Create Lambda authorizer function
- Create user registration endpoints
- Create DynamoDB user table
- Update OpenAPI spec to add optional security scheme
- Implement per-user rate limiting in Lambda functions
- Maintain public access for unauthenticated users

**Phase 3 (Future Spec)**: Enhanced features
- Add user dashboard for API key management
- Add usage analytics per user
- Add tiered pricing (free, pro, enterprise)
- Add webhook notifications for quota limits

## Security Considerations

### DDoS Protection

Without API Gateway rate limiting, the service relies on:
1. **CloudFront**: Absorbs traffic at edge locations
2. **AWS WAF**: Enforces rate limits per IP address
3. **Lambda Concurrency Limits**: Prevents runaway costs
4. **API Gateway Default Limits**: AWS account-level throttling

### Cost Protection

To prevent unexpected costs:
1. Set Lambda reserved concurrency limits
2. Configure CloudWatch alarms for invocation counts
3. Monitor CloudFront and WAF costs
4. Set AWS Budgets alerts

### Future Authentication Security

When adding per-user authentication:
1. Use JWT tokens with short expiration (1 hour)
2. Store API keys as hashed values in DynamoDB
3. Implement rate limiting per user in Lambda
4. Log authentication failures for security monitoring
5. Support API key rotation

## Files Affected

### CloudFormation Template
- `application-infrastructure/template.yml`
  - Remove `MCPPublicApiKey` resource
  - Remove `MCPPublicUsagePlan` resource
  - Remove `MCPUsagePlanKey` resource
  - Remove `PublicRateLimit` parameter
  - Remove MethodSettings throttling configuration from WebApi
  - Maintain logging configuration

### OpenAPI Specification
- `application-infrastructure/template-openapi-spec.yml`
  - Remove `securitySchemes` section (if present)
  - Remove `security` requirements from all endpoints
  - Maintain all endpoint definitions
  - Maintain request/response schemas

### SAM Configuration Files
- `application-infrastructure/samconfig-test.toml`
  - Remove `PublicRateLimit` parameter
- `application-infrastructure/samconfig-prod.toml`
  - Remove `PublicRateLimit` parameter

### Lambda Functions
- No changes required to Lambda function code
- Lambda functions will continue processing requests identically

## Success Criteria

The implementation is successful when:

1. ✅ CloudFormation deployment completes without errors
2. ✅ No `apigateway:GET` permissions required
3. ✅ All API endpoints accessible without API keys
4. ✅ Test requests to all endpoints return successful responses
5. ✅ OpenAPI specification accurately reflects authentication requirements
6. ✅ SAM configuration files deploy successfully
7. ✅ Existing integrations continue working
8. ✅ Architecture supports future Lambda authorizer integration

## Testing Requirements

### Manual Testing

1. Deploy the updated CloudFormation stack
2. Verify deployment succeeds without permission errors
3. Send test requests to each endpoint without API keys
4. Verify all endpoints return successful responses
5. Verify CORS headers are present in responses

### Integration Testing

1. Test MCP protocol compliance (JSON-RPC 2.0)
2. Test all MCP tools (list_templates, get_template, etc.)
3. Test error handling (invalid requests, missing parameters)
4. Test concurrent requests from multiple clients

### Regression Testing

1. Verify existing MCP client integrations continue working
2. Verify Lambda function behavior unchanged
3. Verify CloudWatch logging continues working
4. Verify X-Ray tracing continues working

## Rollback Plan

If issues are discovered after deployment:

1. Revert CloudFormation template to previous version
2. Redeploy with API key resources
3. Restore `PublicRateLimit` parameter
4. Restore OpenAPI security requirements
5. Communicate rollback to users

## Future Enhancements

After this spec is complete, future enhancements may include:

1. **Lambda Authorizer**: Add optional per-user authentication
2. **User Registration**: API endpoints for account creation
3. **API Key Management**: User dashboard for key generation
4. **Usage Analytics**: Per-user usage tracking and reporting
5. **Tiered Access**: Free, pro, and enterprise tiers with different quotas
6. **Webhook Notifications**: Alert users when approaching quota limits
7. **OAuth Integration**: Support OAuth 2.0 for third-party authentication
