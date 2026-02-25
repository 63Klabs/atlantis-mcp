# Design Document: Remove API Key Requirement from Atlantis MCP Server

**Feature:** Remove API Key Requirement  
**Version:** 0.0.1  
**Date:** 2025-01-24  
**Status:** Draft

## Overview

This design document specifies the removal of API Gateway API key authentication from the Atlantis MCP Server to enable public keyless access. The current implementation requires API keys for all requests, which causes deployment failures and prevents seamless MCP client integration. This change will remove three CloudFormation resources (MCPPublicApiKey, MCPPublicUsagePlan, MCPUsagePlanKey) and associated configuration while maintaining backward compatibility and preparing for future per-user authentication via Lambda authorizers.

### Goals

1. Remove API key authentication to fix deployment failures
2. Enable public keyless access for MCP clients
3. Maintain all existing logging and monitoring capabilities
4. Preserve CORS configuration for cross-origin requests
5. Design for future Lambda authorizer integration
6. Ensure zero Lambda function code changes required

### Non-Goals

1. Implementing Lambda authorizer in this phase
2. Adding WAF rules or CloudFront protection (managed separately)
3. Modifying Lambda function business logic
4. Changing MCP protocol implementation
5. Altering cache-data configuration


## Architecture

### Current Architecture (With API Keys)

```
┌─────────────┐
│ MCP Client  │
└──────┬──────┘
       │ POST /mcp/* + x-api-key header
       ▼
┌─────────────────────────────────────────┐
│ API Gateway (WebApi)                    │
│ ┌─────────────────────────────────────┐ │
│ │ API Key Validation                  │ │
│ │ - MCPPublicApiKey                   │ │
│ │ - MCPPublicUsagePlan                │ │
│ │ - MCPUsagePlanKey                   │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ MethodSettings Throttling           │ │
│ │ - BurstLimit: PublicRateLimit       │ │
│ │ - RateLimit: PublicRateLimit        │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ CORS Configuration                  │ │
│ └─────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ ReadLambdaFunction                      │
│ - Processes MCP requests                │
│ - No authentication logic               │
└─────────────────────────────────────────┘
```


### Target Architecture (Keyless Public Access)

```
┌─────────────┐
│ MCP Client  │
└──────┬──────┘
       │ POST /mcp/* (no authentication)
       ▼
┌─────────────────────────────────────────┐
│ API Gateway (WebApi)                    │
│ ┌─────────────────────────────────────┐ │
│ │ CORS Configuration                  │ │
│ │ - AllowOrigin: *                    │ │
│ │ - AllowMethods: POST, OPTIONS       │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ Logging Configuration               │ │
│ │ - Access Logs                       │ │
│ │ - Execution Logs                    │ │
│ └─────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ ReadLambdaFunction                      │
│ - Processes MCP requests                │
│ - No authentication logic               │
└─────────────────────────────────────────┘
```

**Key Changes:**
- Removed: MCPPublicApiKey resource
- Removed: MCPPublicUsagePlan resource
- Removed: MCPUsagePlanKey resource
- Removed: PublicRateLimit parameter
- Removed: MethodSettings throttling configuration
- Maintained: All logging configuration
- Maintained: CORS configuration
- Maintained: Lambda integration


### Future Architecture (With Lambda Authorizer)

```
┌─────────────┐
│ MCP Client  │
└──────┬──────┘
       │ POST /mcp/* + Authorization header (optional)
       ▼
┌─────────────────────────────────────────┐
│ API Gateway (WebApi)                    │
│ ┌─────────────────────────────────────┐ │
│ │ Lambda Authorizer (Optional)        │ │
│ │ - Validates JWT/Bearer tokens       │ │
│ │ - Returns authorization context     │ │
│ │ - Allows unauthenticated requests   │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ CORS Configuration                  │ │
│ └─────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │ + authorization context
               ▼
┌─────────────────────────────────────────┐
│ ReadLambdaFunction                      │
│ - Receives authorization context        │
│ - Applies per-user rate limits          │
│ - Logs user identity                    │
└─────────────────────────────────────────┘
```

**Future Additions (Phase 2):**
- Lambda authorizer function for optional authentication
- Authorization context passed to Lambda functions
- Per-user rate limiting based on identity
- User-specific logging and metrics
- Coexistence of public and authenticated access


## Components and Interfaces

### CloudFormation Template Changes

#### 1. Remove API Key Resources

**File:** `application-infrastructure/template.yml`

**Resources to Remove (lines 591-640):**

```yaml
# REMOVE: MCPPublicApiKey
MCPPublicApiKey:
  Type: AWS::ApiGateway::ApiKey
  DependsOn: 
    - WebApi
  Properties:
    Name: !Sub '${Prefix}-${ProjectId}-${StageId}-MCP-Public-Key'
    Description: "API Key for public MCP server access with rate limiting"
    Enabled: true

# REMOVE: MCPPublicUsagePlan
MCPPublicUsagePlan:
  Type: AWS::ApiGateway::UsagePlan
  DependsOn:
    - WebApi
  Properties:
    UsagePlanName: !Sub '${Prefix}-${ProjectId}-${StageId}-MCP-Public-Plan'
    Description: "Usage plan for public MCP server access with rate limiting"
    ApiStages:
      - ApiId: !Ref WebApi
        Stage: !Ref ApiPathBase
    Throttle:
      BurstLimit: !Ref PublicRateLimit
      RateLimit: !Ref PublicRateLimit
    Quota:
      Limit: !Ref PublicRateLimit
      Period: HOUR

# REMOVE: MCPUsagePlanKey
MCPUsagePlanKey:
  Type: AWS::ApiGateway::UsagePlanKey
  Properties:
    KeyId: !Ref MCPPublicApiKey
    KeyType: API_KEY
    UsagePlanId: !Ref MCPPublicUsagePlan
```


#### 2. Remove PublicRateLimit Parameter

**File:** `application-infrastructure/template.yml`

**Parameter to Remove (around line 300):**

```yaml
# REMOVE: PublicRateLimit parameter
PublicRateLimit:
  Type: Number
  Description: "Rate limit for public (unauthenticated) access in requests per hour per IP address"
  Default: 100
  MinValue: 1
  MaxValue: 10000
  ConstraintDescription: "Must be between 1 and 10000 requests per hour"
```

**Rationale:** This parameter is only used by the removed API key resources. Without API Gateway usage plans, this parameter has no purpose.

#### 3. Update WebApi Resource

**File:** `application-infrastructure/template.yml`

**Before (lines 540-570):**

```yaml
WebApi:
  Type: AWS::Serverless::Api 
  Properties: 
    Name: !Sub '${Prefix}-${ProjectId}-${StageId}-WebApi'
    StageName: !Ref ApiPathBase

    Cors:
      AllowMethods: "'POST,OPTIONS'"
      AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
      AllowOrigin: "'*'"
      MaxAge: "'86400'"

    # REMOVE: MethodSettings throttling configuration
    MethodSettings:
      - ResourcePath: '/*'
        HttpMethod: '*'
        ThrottlingBurstLimit: !Ref PublicRateLimit
        ThrottlingRateLimit: !Ref PublicRateLimit

    DefinitionBody:
      "Fn::Transform":
        Name: "AWS::Include"
        Parameters:
          Location: ./template-openapi-spec.yml
```


**After:**

```yaml
WebApi:
  Type: AWS::Serverless::Api 
  Properties: 
    Name: !Sub '${Prefix}-${ProjectId}-${StageId}-WebApi'
    StageName: !Ref ApiPathBase

    Cors:
      AllowMethods: "'POST,OPTIONS'"
      AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
      AllowOrigin: "'*'"
      MaxAge: "'86400'"

    DefinitionBody:
      "Fn::Transform":
        Name: "AWS::Include"
        Parameters:
          Location: ./template-openapi-spec.yml

    # Logging configuration remains unchanged
    AccessLogSetting: !If
      - ApiGatewayLoggingIsEnabled
      - DestinationArn: !GetAtt ApiGatewayAccessLogGroup.Arn
        Format: '{"requestId":"$context.requestId", "extendedRequestId":"$context.extendedRequestId", "ip":"$context.identity.sourceIp", "caller":"$context.identity.caller", "user":"$context.identity.user", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod", "path":"$context.path", "resourcePath":"$context.resourcePath", "routeKey":"$context.routeKey", "status":"$context.status", "protocol":"$context.protocol", "responseLength":"$context.responseLength", "integrationError":"$context.integrationErrorMessage", "authorizerError":"$context.authorizer.error", "authorizerStatus":"$context.authorizer.status", "authorizerLatency":"$context.authorizer.latency"}'
      - !Ref 'AWS::NoValue'
    
    MethodSettings: !If
      - ApiGatewayLoggingIsEnabled
      - - LoggingLevel: !If [IsProduction, 'ERROR', 'INFO']
          ResourcePath: '/*'
          HttpMethod: '*'
          DataTraceEnabled: !If [IsProduction, False, True]
          MetricsEnabled: True
      - !Ref 'AWS::NoValue'
```

**Key Changes:**
- Removed MethodSettings throttling configuration that referenced PublicRateLimit
- Maintained all CORS configuration
- Maintained all logging configuration (AccessLogSetting and MethodSettings for logging)
- Note: The MethodSettings for logging is separate from throttling and remains intact


#### 4. Update Metadata Section

**File:** `application-infrastructure/template.yml`

**Before (around line 50):**

```yaml
Metadata:
  AWS::CloudFormation::Interface:
    ParameterGroups:
      # ... other groups ...
      -
        Label:
          default: "MCP Server Configuration"
        Parameters:
          - AtlantisS3Buckets
          - AtlantisGitHubUserOrgs
          - PublicRateLimit  # REMOVE THIS LINE
          - ReadLambdaExecRoleIncludeManagedPolicyArns
          - GitHubTokenParameter
          - LogLevel
```

**After:**

```yaml
Metadata:
  AWS::CloudFormation::Interface:
    ParameterGroups:
      # ... other groups ...
      -
        Label:
          default: "MCP Server Configuration"
        Parameters:
          - AtlantisS3Buckets
          - AtlantisGitHubUserOrgs
          - ReadLambdaExecRoleIncludeManagedPolicyArns
          - GitHubTokenParameter
          - LogLevel
```


#### 5. Update Lambda Environment Variables

**File:** `application-infrastructure/template.yml`

**Before (around line 700):**

```yaml
ReadLambdaFunction:
  Type: AWS::Serverless::Function
  Properties:
    # ... other properties ...
    Environment:
      Variables:
        # ... other variables ...
        PUBLIC_RATE_LIMIT: !Ref PublicRateLimit  # REMOVE THIS LINE
```

**After:**

```yaml
ReadLambdaFunction:
  Type: AWS::Serverless::Function
  Properties:
    # ... other properties ...
    Environment:
      Variables:
        # ... other variables ...
        # PUBLIC_RATE_LIMIT removed - no longer needed
```

**Rationale:** The Lambda function doesn't enforce rate limiting; that was handled by API Gateway usage plans. Removing this environment variable has no impact on Lambda function behavior.


### SAM Configuration Changes

#### 1. Update samconfig-test.toml

**File:** `application-infrastructure/samconfig-test.toml`

**Before:**

```toml
parameter_overrides = [
    # ... other parameters ...
    "AtlantisS3Buckets=",
    "AtlantisGitHubUserOrgs=63Klabs",
    "PublicRateLimit=100",  # REMOVE THIS LINE
    "ReadLambdaExecRoleIncludeManagedPolicyArns=",
    # ... other parameters ...
]
```

**After:**

```toml
parameter_overrides = [
    # ... other parameters ...
    "AtlantisS3Buckets=",
    "AtlantisGitHubUserOrgs=63Klabs",
    "ReadLambdaExecRoleIncludeManagedPolicyArns=",
    # ... other parameters ...
]
```

#### 2. Update samconfig-prod.toml

**File:** `application-infrastructure/samconfig-prod.toml`

**Before:**

```toml
parameter_overrides = [
    # ... other parameters ...
    "AtlantisS3Buckets=",
    "AtlantisGitHubUserOrgs=63Klabs",
    "PublicRateLimit=100",  # REMOVE THIS LINE
    "ReadLambdaExecRoleIncludeManagedPolicyArns=",
    # ... other parameters ...
]
```

**After:**

```toml
parameter_overrides = [
    # ... other parameters ...
    "AtlantisS3Buckets=",
    "AtlantisGitHubUserOrgs=63Klabs",
    "ReadLambdaExecRoleIncludeManagedPolicyArns=",
    # ... other parameters ...
]
```


### OpenAPI Specification Changes

**File:** `application-infrastructure/template-openapi-spec.yml`

**Current State:** The OpenAPI specification does not contain any security schemes or security requirements. All endpoints are already configured for public access.

**Verification Required:**
- Confirm no `securitySchemes` section exists in `components`
- Confirm no `security` requirements on individual endpoints
- Confirm all endpoints use `x-amazon-apigateway-integration` without API key requirements

**Expected State (No Changes Required):**

```yaml
openapi: '3.0.0'
info:
  title: "Atlantis MCP Server API"
  version: "0.0.1"

paths:
  /mcp/list_templates:
    post:
      # No security requirements
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MCPRequest'
      responses:
        '200':
          description: "Success response"
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MCPResponse'
      x-amazon-apigateway-integration:
        httpMethod: post
        type: aws_proxy
        uri:
          Fn::Sub: arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ReadLambdaFunction.Arn}/invocations

components:
  schemas:
    # MCP protocol schemas
    # No securitySchemes section
```

**Rationale:** The OpenAPI spec already supports public access. API key enforcement was handled by CloudFormation resources (MCPPublicApiKey, MCPPublicUsagePlan), not by OpenAPI security schemes.


## Data Models

### CloudFormation Parameters

**Removed Parameter:**

```yaml
PublicRateLimit:
  Type: Number
  Description: "Rate limit for public (unauthenticated) access in requests per hour per IP address"
  Default: 100
  MinValue: 1
  MaxValue: 10000
```

**Impact:** This parameter was only referenced by:
1. MCPPublicUsagePlan resource (removed)
2. WebApi MethodSettings throttling (removed)
3. ReadLambdaFunction environment variable (removed)

No other resources or outputs reference this parameter.

### CloudFormation Resources

**Removed Resources:**

1. **MCPPublicApiKey** (AWS::ApiGateway::ApiKey)
   - Purpose: Generated API key for public access
   - Dependencies: WebApi
   - Referenced by: MCPUsagePlanKey

2. **MCPPublicUsagePlan** (AWS::ApiGateway::UsagePlan)
   - Purpose: Rate limiting and quota management
   - Dependencies: WebApi
   - Referenced by: MCPUsagePlanKey

3. **MCPUsagePlanKey** (AWS::ApiGateway::UsagePlanKey)
   - Purpose: Associates API key with usage plan
   - Dependencies: MCPPublicApiKey, MCPPublicUsagePlan
   - Referenced by: None

**Impact Analysis:**
- No other resources depend on these three resources
- No outputs reference these resources
- No conditions reference these resources
- Removal is safe and isolated


### Lambda Function Interface

**No Changes Required**

The Lambda function interface remains unchanged:

```javascript
// Lambda handler signature (unchanged)
export const handler = async (event, context) => {
  // event.requestContext contains API Gateway context
  // event.body contains MCP request payload
  // No authentication context currently used
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(mcpResponse)
  };
};
```

**Future Lambda Authorizer Context:**

When Lambda authorizer is added in Phase 2, the event structure will include:

```javascript
export const handler = async (event, context) => {
  // event.requestContext.authorizer will contain:
  // - principalId: User identifier
  // - claims: JWT claims or custom context
  // - isAuthenticated: Boolean flag
  
  const authContext = event.requestContext.authorizer || {};
  const isAuthenticated = authContext.principalId !== undefined;
  
  // Apply per-user logic if authenticated
  if (isAuthenticated) {
    // Log user identity
    // Apply user-specific rate limits
    // Track user-specific metrics
  }
  
  // Process MCP request (works for both authenticated and public)
  return processRequest(event.body, authContext);
};
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing the acceptance criteria, I identified the following testable properties:

**Properties identified:**
- Property 1: API endpoints accept requests without API keys (from 2.1, 2.3)
- Property 2: No 403 errors due to missing API keys (from 2.4)
- Property 3: CORS headers present in responses (from 2.5)
- Property 4: JSON-RPC 2.0 request format accepted (from 7.3)
- Property 5: JSON-RPC 2.0 response format maintained (from 7.4)
- Property 6: All endpoints return successful responses (from 10.5)

**Redundancy analysis:**
- Property 1 and Property 6 overlap significantly - if all endpoints return successful responses without API keys, then they accept requests without API keys
- Property 2 is subsumed by Property 6 - if responses are successful, they won't be 403 errors
- Property 4 and Property 5 can be combined into a single round-trip property

**Consolidated properties:**
- Property 1: All MCP endpoints accept requests without API keys and return successful responses (combines 1, 2, 6)
- Property 2: CORS headers present in all responses (from 2.5)
- Property 3: JSON-RPC 2.0 round-trip (combines 7.3, 7.4)

### Property 1: Keyless Access to All Endpoints

*For any* valid MCP endpoint path and valid JSON-RPC 2.0 request body, when a POST request is sent without an API key header, the API Gateway SHALL return a successful response (HTTP 200) with valid JSON-RPC 2.0 content.

**Validates: Requirements 2.1, 2.3, 2.4, 10.5**

**Test Implementation:**
- Generate random MCP endpoint paths from the list: `/mcp/list_templates`, `/mcp/get_template`, `/mcp/list_starters`, `/mcp/get_starter_info`, `/mcp/search_documentation`, `/mcp/validate_naming`, `/mcp/check_template_updates`, `/mcp/list_template_versions`, `/mcp/list_categories`
- Generate random valid JSON-RPC 2.0 request bodies with method names matching the endpoint
- Send POST requests without `x-api-key` header
- Verify HTTP status code is 200
- Verify response body is valid JSON
- Verify response contains `jsonrpc: "2.0"` field


### Property 2: CORS Headers Present

*For any* valid MCP endpoint and valid request, the response SHALL include CORS headers allowing cross-origin access: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods` including POST and OPTIONS, and `Access-Control-Allow-Headers` including standard headers.

**Validates: Requirements 2.5**

**Test Implementation:**
- Generate random MCP endpoint paths
- Send POST requests with `Origin` header
- Verify response includes `Access-Control-Allow-Origin: *`
- Send OPTIONS requests (preflight)
- Verify response includes `Access-Control-Allow-Methods` containing POST and OPTIONS
- Verify response includes `Access-Control-Allow-Headers` containing Content-Type, Authorization

### Property 3: JSON-RPC 2.0 Round-Trip

*For any* valid JSON-RPC 2.0 request structure (with `jsonrpc: "2.0"`, `method`, `params`, and `id` fields), when sent to any MCP endpoint, the response SHALL be a valid JSON-RPC 2.0 response with matching `id` and `jsonrpc: "2.0"` fields.

**Validates: Requirements 7.3, 7.4**

**Test Implementation:**
- Generate random JSON-RPC 2.0 request structures with:
  - `jsonrpc: "2.0"`
  - Random method names from MCP endpoint list
  - Random params objects
  - Random id (string or number)
- Send to corresponding MCP endpoints
- Parse response as JSON
- Verify response has `jsonrpc: "2.0"`
- Verify response has `id` matching request `id`
- Verify response has either `result` or `error` field (not both)


## Error Handling

### CloudFormation Deployment Errors

**Error:** Stack creation fails with permission denied errors

**Cause:** CloudFormation service role lacks required permissions

**Resolution:** 
- Verify the removed resources (MCPPublicApiKey, MCPPublicUsagePlan, MCPUsagePlanKey) are not present in template
- These resources required `apigateway:GET` permissions that are no longer needed
- If deployment still fails, check CloudFormation service role has basic API Gateway permissions: `apigateway:POST`, `apigateway:PUT`, `apigateway:DELETE`

**Error:** Parameter validation fails for PublicRateLimit

**Cause:** SAM configuration files still reference the removed parameter

**Resolution:**
- Remove `PublicRateLimit` from `samconfig-test.toml` parameter_overrides
- Remove `PublicRateLimit` from `samconfig-prod.toml` parameter_overrides
- Clear SAM CLI cache: `sam build --use-container --cached false`

### API Gateway Runtime Errors

**Error:** 403 Forbidden responses from API Gateway

**Cause:** API key validation still enabled (should not occur after this change)

**Resolution:**
- Verify MCPPublicApiKey, MCPPublicUsagePlan, MCPUsagePlanKey resources are removed
- Verify OpenAPI spec has no `security` requirements
- Redeploy the API Gateway stage

**Error:** CORS preflight failures

**Cause:** CORS configuration missing or incorrect

**Resolution:**
- Verify WebApi resource maintains CORS configuration:
  - `AllowMethods: "'POST,OPTIONS'"`
  - `AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"`
  - `AllowOrigin: "'*'"`
  - `MaxAge: "'86400'"`
- Redeploy if CORS configuration was accidentally removed


### Lambda Function Errors

**Error:** Lambda function receives unexpected event structure

**Cause:** API Gateway event structure changed (should not occur)

**Resolution:**
- Lambda functions should not require changes
- Verify `event.requestContext` is still present
- Verify `event.body` contains request payload
- Check CloudWatch logs for actual event structure

**Error:** Environment variable PUBLIC_RATE_LIMIT not found

**Cause:** Lambda code references removed environment variable

**Resolution:**
- Remove references to `PUBLIC_RATE_LIMIT` from Lambda code
- This variable was not used for enforcement (API Gateway handled rate limiting)
- Redeploy Lambda function

### Logging Errors

**Error:** CloudWatch log groups not receiving logs

**Cause:** Logging configuration accidentally removed

**Resolution:**
- Verify `ApiGatewayAccessLogGroup` resource exists
- Verify `ApiGatewayExecutionLogGroup` resource exists
- Verify `WebApi` has `AccessLogSetting` when `ApiGatewayLoggingEnabled` is TRUE
- Verify `WebApi` has logging `MethodSettings` when `ApiGatewayLoggingEnabled` is TRUE
- Check API Gateway account settings for CloudWatch logging role


## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and integration tests to ensure correctness:

**Unit Tests:**
- Verify CloudFormation template syntax is valid
- Verify removed resources are not present in template
- Verify removed parameter is not present in template
- Verify SAM configuration files are valid TOML
- Verify OpenAPI specification is valid OpenAPI 3.0

**Integration Tests:**
- Deploy CloudFormation stack to TEST environment
- Verify deployment succeeds without permission errors
- Send test requests to all MCP endpoints without API keys
- Verify all endpoints return successful responses
- Verify CORS headers are present
- Verify CloudWatch logs capture requests

**Property-Based Tests:**
- Test keyless access across all endpoints with random valid requests (Property 1)
- Test CORS headers across all endpoints with random origins (Property 2)
- Test JSON-RPC 2.0 round-trip with random request structures (Property 3)

### Test Configuration

**Property-Based Testing Library:** fast-check (JavaScript/Node.js)

**Test Iterations:** Minimum 100 iterations per property test

**Test Tags:** Each property test must include a comment referencing the design property:

```javascript
/**
 * Feature: remove-api-key-requirement, Property 1: Keyless Access to All Endpoints
 * 
 * For any valid MCP endpoint path and valid JSON-RPC 2.0 request body,
 * when a POST request is sent without an API key header,
 * the API Gateway SHALL return a successful response (HTTP 200)
 * with valid JSON-RPC 2.0 content.
 */
```


### Unit Test Examples

**Test: CloudFormation Template Validation**

```javascript
// test/infrastructure/template-validation.test.js
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

describe('CloudFormation Template Validation', () => {
  let template;

  beforeAll(() => {
    const templateContent = readFileSync(
      'application-infrastructure/template.yml',
      'utf8'
    );
    template = yaml.load(templateContent);
  });

  it('should not include MCPPublicApiKey resource', () => {
    expect(template.Resources).not.toHaveProperty('MCPPublicApiKey');
  });

  it('should not include MCPPublicUsagePlan resource', () => {
    expect(template.Resources).not.toHaveProperty('MCPPublicUsagePlan');
  });

  it('should not include MCPUsagePlanKey resource', () => {
    expect(template.Resources).not.toHaveProperty('MCPUsagePlanKey');
  });

  it('should not include PublicRateLimit parameter', () => {
    expect(template.Parameters).not.toHaveProperty('PublicRateLimit');
  });

  it('should maintain WebApi resource', () => {
    expect(template.Resources).toHaveProperty('WebApi');
    expect(template.Resources.WebApi.Type).toBe('AWS::Serverless::Api');
  });

  it('should maintain CORS configuration', () => {
    const webApi = template.Resources.WebApi;
    expect(webApi.Properties.Cors).toBeDefined();
    expect(webApi.Properties.Cors.AllowOrigin).toBe("'*'");
    expect(webApi.Properties.Cors.AllowMethods).toContain('POST');
  });

  it('should not include MethodSettings throttling', () => {
    const webApi = template.Resources.WebApi;
    // MethodSettings may exist for logging, but should not reference PublicRateLimit
    if (webApi.Properties.MethodSettings) {
      const methodSettings = webApi.Properties.MethodSettings;
      methodSettings.forEach(setting => {
        expect(setting).not.toHaveProperty('ThrottlingBurstLimit');
        expect(setting).not.toHaveProperty('ThrottlingRateLimit');
      });
    }
  });
});
```


**Test: SAM Configuration Validation**

```javascript
// test/infrastructure/samconfig-validation.test.js
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import toml from 'toml';

describe('SAM Configuration Validation', () => {
  it('should not include PublicRateLimit in samconfig-test.toml', () => {
    const configContent = readFileSync(
      'application-infrastructure/samconfig-test.toml',
      'utf8'
    );
    const config = toml.parse(configContent);
    
    const paramOverrides = config.default.deploy.parameters.parameter_overrides;
    const hasPublicRateLimit = paramOverrides.some(param => 
      param.includes('PublicRateLimit')
    );
    
    expect(hasPublicRateLimit).toBe(false);
  });

  it('should not include PublicRateLimit in samconfig-prod.toml', () => {
    const configContent = readFileSync(
      'application-infrastructure/samconfig-prod.toml',
      'utf8'
    );
    const config = toml.parse(configContent);
    
    const paramOverrides = config.default.deploy.parameters.parameter_overrides;
    const hasPublicRateLimit = paramOverrides.some(param => 
      param.includes('PublicRateLimit')
    );
    
    expect(hasPublicRateLimit).toBe(false);
  });

  it('should maintain other required parameters in test config', () => {
    const configContent = readFileSync(
      'application-infrastructure/samconfig-test.toml',
      'utf8'
    );
    const config = toml.parse(configContent);
    
    const paramOverrides = config.default.deploy.parameters.parameter_overrides;
    const paramString = paramOverrides.join(',');
    
    expect(paramString).toContain('Prefix=');
    expect(paramString).toContain('ProjectId=');
    expect(paramString).toContain('StageId=');
    expect(paramString).toContain('DeployEnvironment=TEST');
  });
});
```


### Integration Test Examples

**Test: Deployment Success**

```javascript
// test/integration/deployment.test.js
import { describe, it, expect } from '@jest/globals';
import { 
  CloudFormationClient, 
  DescribeStacksCommand 
} from '@aws-sdk/client-cloudformation';

describe('CloudFormation Deployment', () => {
  const cfnClient = new CloudFormationClient({ region: 'us-east-1' });
  const stackName = 'atlantis-mcp-test'; // From samconfig-test.toml

  it('should deploy stack successfully', async () => {
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfnClient.send(command);
    
    expect(response.Stacks).toHaveLength(1);
    expect(response.Stacks[0].StackStatus).toBe('CREATE_COMPLETE');
  }, 30000);

  it('should not create API key resources', async () => {
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfnClient.send(command);
    
    const resources = response.Stacks[0].Outputs || [];
    const resourceNames = resources.map(r => r.OutputKey);
    
    expect(resourceNames).not.toContain('MCPPublicApiKey');
    expect(resourceNames).not.toContain('MCPPublicUsagePlan');
  }, 30000);
});
```

**Test: Endpoint Accessibility**

```javascript
// test/integration/endpoint-access.test.js
import { describe, it, expect } from '@jest/globals';
import fetch from 'node-fetch';

describe('MCP Endpoint Access', () => {
  const apiEndpoint = process.env.API_ENDPOINT || 
    'https://example.execute-api.us-east-1.amazonaws.com/api';

  const mcpEndpoints = [
    '/mcp/list_templates',
    '/mcp/get_template',
    '/mcp/list_starters',
    '/mcp/get_starter_info',
    '/mcp/search_documentation',
    '/mcp/validate_naming',
    '/mcp/check_template_updates',
    '/mcp/list_template_versions',
    '/mcp/list_categories'
  ];

  mcpEndpoints.forEach(endpoint => {
    it(`should access ${endpoint} without API key`, async () => {
      const response = await fetch(`${apiEndpoint}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // No x-api-key header
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: endpoint.replace('/mcp/', ''),
          params: {},
          id: 1
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
    }, 10000);
  });
});
```


### Property-Based Test Examples

**Test: Property 1 - Keyless Access**

```javascript
// test/property/keyless-access-property.test.js
import { describe, it } from '@jest/globals';
import fc from 'fast-check';
import fetch from 'node-fetch';

/**
 * Feature: remove-api-key-requirement, Property 1: Keyless Access to All Endpoints
 * 
 * For any valid MCP endpoint path and valid JSON-RPC 2.0 request body,
 * when a POST request is sent without an API key header,
 * the API Gateway SHALL return a successful response (HTTP 200)
 * with valid JSON-RPC 2.0 content.
 */
describe('Property 1: Keyless Access to All Endpoints', () => {
  const apiEndpoint = process.env.API_ENDPOINT || 
    'https://example.execute-api.us-east-1.amazonaws.com/api';

  const mcpEndpoints = [
    'list_templates',
    'get_template',
    'list_starters',
    'get_starter_info',
    'search_documentation',
    'validate_naming',
    'check_template_updates',
    'list_template_versions',
    'list_categories'
  ];

  it('should accept requests without API key for any endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...mcpEndpoints),
        fc.oneof(fc.string(), fc.integer()),
        fc.record({
          namespace: fc.option(fc.string(), { nil: undefined }),
          category: fc.option(fc.string(), { nil: undefined })
        }),
        async (method, id, params) => {
          const response = await fetch(`${apiEndpoint}/mcp/${method}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
              // No x-api-key header
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method,
              params,
              id
            })
          });

          // Verify successful response
          expect(response.status).toBe(200);

          // Verify JSON response
          const data = await response.json();
          expect(data).toHaveProperty('jsonrpc', '2.0');
          expect(data).toHaveProperty('id', id);
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);
});
```


**Test: Property 2 - CORS Headers**

```javascript
// test/property/cors-headers-property.test.js
import { describe, it } from '@jest/globals';
import fc from 'fast-check';
import fetch from 'node-fetch';

/**
 * Feature: remove-api-key-requirement, Property 2: CORS Headers Present
 * 
 * For any valid MCP endpoint and valid request, the response SHALL include
 * CORS headers allowing cross-origin access.
 */
describe('Property 2: CORS Headers Present', () => {
  const apiEndpoint = process.env.API_ENDPOINT || 
    'https://example.execute-api.us-east-1.amazonaws.com/api';

  const mcpEndpoints = [
    'list_templates',
    'get_template',
    'list_starters',
    'get_starter_info',
    'search_documentation',
    'validate_naming',
    'check_template_updates',
    'list_template_versions',
    'list_categories'
  ];

  it('should include CORS headers for any endpoint and origin', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...mcpEndpoints),
        fc.webUrl(),
        async (method, origin) => {
          const response = await fetch(`${apiEndpoint}/mcp/${method}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': origin
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method,
              params: {},
              id: 1
            })
          });

          // Verify CORS headers
          expect(response.headers.get('access-control-allow-origin')).toBe('*');
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);

  it('should handle OPTIONS preflight for any endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...mcpEndpoints),
        async (method) => {
          const response = await fetch(`${apiEndpoint}/mcp/${method}`, {
            method: 'OPTIONS',
            headers: {
              'Origin': 'https://example.com',
              'Access-Control-Request-Method': 'POST'
            }
          });

          // Verify preflight response
          const allowMethods = response.headers.get('access-control-allow-methods');
          expect(allowMethods).toContain('POST');
          expect(allowMethods).toContain('OPTIONS');
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);
});
```


**Test: Property 3 - JSON-RPC 2.0 Round-Trip**

```javascript
// test/property/jsonrpc-roundtrip-property.test.js
import { describe, it } from '@jest/globals';
import fc from 'fast-check';
import fetch from 'node-fetch';

/**
 * Feature: remove-api-key-requirement, Property 3: JSON-RPC 2.0 Round-Trip
 * 
 * For any valid JSON-RPC 2.0 request structure, when sent to any MCP endpoint,
 * the response SHALL be a valid JSON-RPC 2.0 response with matching id
 * and jsonrpc: "2.0" fields.
 */
describe('Property 3: JSON-RPC 2.0 Round-Trip', () => {
  const apiEndpoint = process.env.API_ENDPOINT || 
    'https://example.execute-api.us-east-1.amazonaws.com/api';

  const mcpEndpoints = [
    'list_templates',
    'get_template',
    'list_starters',
    'get_starter_info',
    'search_documentation',
    'validate_naming',
    'check_template_updates',
    'list_template_versions',
    'list_categories'
  ];

  it('should maintain JSON-RPC 2.0 structure for any request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...mcpEndpoints),
        fc.oneof(fc.string(), fc.integer()),
        fc.record({
          namespace: fc.option(fc.string(), { nil: undefined }),
          category: fc.option(fc.string(), { nil: undefined }),
          query: fc.option(fc.string(), { nil: undefined })
        }),
        async (method, id, params) => {
          const request = {
            jsonrpc: '2.0',
            method,
            params,
            id
          };

          const response = await fetch(`${apiEndpoint}/mcp/${method}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
          });

          const data = await response.json();

          // Verify JSON-RPC 2.0 response structure
          expect(data).toHaveProperty('jsonrpc', '2.0');
          expect(data).toHaveProperty('id', id);
          
          // Must have either result or error, not both
          const hasResult = data.hasOwnProperty('result');
          const hasError = data.hasOwnProperty('error');
          expect(hasResult || hasError).toBe(true);
          expect(hasResult && hasError).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);
});
```


## Future Extensibility: Lambda Authorizer Integration

### Overview

This section documents how to add per-user authentication via Lambda authorizer in Phase 2 while maintaining backward compatibility with public access.

### Lambda Authorizer Architecture

```
┌─────────────┐
│ MCP Client  │
└──────┬──────┘
       │ POST /mcp/* + Authorization: Bearer <token> (optional)
       ▼
┌─────────────────────────────────────────┐
│ API Gateway (WebApi)                    │
│ ┌─────────────────────────────────────┐ │
│ │ Lambda Authorizer (Optional)        │ │
│ │ - Validates JWT/API key             │ │
│ │ - Returns authorization policy      │ │
│ │ - Allows unauthenticated requests   │ │
│ └──────────────┬──────────────────────┘ │
│                │ authorization context   │
│                ▼                         │
│ ┌─────────────────────────────────────┐ │
│ │ Lambda Integration                  │ │
│ └─────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │ event.requestContext.authorizer
               ▼
┌─────────────────────────────────────────┐
│ ReadLambdaFunction                      │
│ - Receives authorization context        │
│ - Applies per-user rate limits          │
│ - Logs user identity                    │
└─────────────────────────────────────────┘
```

### OpenAPI Specification Changes for Lambda Authorizer

**Add Security Scheme (Optional Authentication):**

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      x-amazon-apigateway-authtype: custom
      x-amazon-apigateway-authorizer:
        type: request
        authorizerUri:
          Fn::Sub: arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AuthorizerFunction.Arn}/invocations
        authorizerResultTtlInSeconds: 300
        identitySource: method.request.header.Authorization

# Security is optional - endpoints work with or without authentication
security: []  # No global security requirement

paths:
  /mcp/list_templates:
    post:
      # No security requirement - allows both authenticated and public access
      # If Authorization header present, authorizer validates it
      # If Authorization header absent, request proceeds as public
```


### Lambda Authorizer Function

**CloudFormation Resource:**

```yaml
AuthorizerFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Sub '${Prefix}-${ProjectId}-${StageId}-Authorizer'
    Description: "Lambda authorizer for optional per-user authentication"
    CodeUri: src/lambda/authorizer/
    Handler: index.handler
    Runtime: nodejs24.x
    Timeout: 5
    MemorySize: 256
    Environment:
      Variables:
        USER_TABLE_NAME: !Ref UserTable
        JWT_SECRET_PARAMETER: !Ref JwtSecretParameter

AuthorizerPermission:
  Type: AWS::Lambda::Permission
  Properties:
    Action: lambda:InvokeFunction
    FunctionName: !Ref AuthorizerFunction
    Principal: apigateway.amazonaws.com
    SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${WebApi}/authorizers/*"
```

**Authorizer Function Logic:**

```javascript
// src/lambda/authorizer/index.js
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken';

const dynamoDb = new DynamoDBClient({});
const USER_TABLE_NAME = process.env.USER_TABLE_NAME;

export const handler = async (event) => {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  
  // If no Authorization header, allow public access
  if (!authHeader) {
    return generatePolicy('public', 'Allow', event.methodArn, {
      userId: 'public',
      tier: 'free',
      rateLimit: 100
    });
  }
  
  try {
    // Extract token from "Bearer <token>"
    const token = authHeader.replace(/^Bearer\s+/i, '');
    
    // Validate JWT or API key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Look up user in DynamoDB
    const user = await getUserFromDatabase(decoded.userId);
    
    if (!user) {
      return generatePolicy('unknown', 'Deny', event.methodArn);
    }
    
    // Return policy with user context
    return generatePolicy(user.userId, 'Allow', event.methodArn, {
      userId: user.userId,
      tier: user.tier,
      rateLimit: user.rateLimit,
      email: user.email
    });
  } catch (error) {
    console.error('Authorization error:', error);
    // On error, deny access (could also allow public access)
    return generatePolicy('unknown', 'Deny', event.methodArn);
  }
};

function generatePolicy(principalId, effect, resource, context = {}) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }]
    },
    context  // Passed to Lambda function in event.requestContext.authorizer
  };
}

async function getUserFromDatabase(userId) {
  const command = new GetItemCommand({
    TableName: USER_TABLE_NAME,
    Key: { userId: { S: userId } }
  });
  
  const response = await dynamoDb.send(command);
  if (!response.Item) return null;
  
  return {
    userId: response.Item.userId.S,
    tier: response.Item.tier.S,
    rateLimit: parseInt(response.Item.rateLimit.N),
    email: response.Item.email.S
  };
}
```


### Lambda Function Changes for Authorization Context

**Current Lambda Function (No Changes Required):**

```javascript
// src/lambda/read/index.js
export const handler = async (event, context) => {
  // Current implementation - no authorization logic
  const body = JSON.parse(event.body);
  
  // Process MCP request
  const result = await processMcpRequest(body);
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result)
  };
};
```

**Future Lambda Function (With Authorization Context):**

```javascript
// src/lambda/read/index.js
export const handler = async (event, context) => {
  // Extract authorization context (if present)
  const authContext = event.requestContext?.authorizer || {};
  const userId = authContext.userId || 'public';
  const tier = authContext.tier || 'free';
  const rateLimit = authContext.rateLimit || 100;
  
  // Log user identity for analytics
  console.log('Request from user:', userId, 'tier:', tier);
  
  // Parse MCP request
  const body = JSON.parse(event.body);
  
  // Apply per-user rate limiting (if authenticated)
  if (userId !== 'public') {
    await checkUserRateLimit(userId, rateLimit);
  }
  
  // Process MCP request (same logic as before)
  const result = await processMcpRequest(body);
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-User-Id': userId,  // Optional: include user ID in response
      'X-Rate-Limit-Remaining': await getRateLimitRemaining(userId)
    },
    body: JSON.stringify(result)
  };
};

async function checkUserRateLimit(userId, limit) {
  // Check DynamoDB or cache for user's request count
  // Throw error if limit exceeded
}

async function getRateLimitRemaining(userId) {
  // Return remaining requests for this user
}
```

**Key Points:**
- Lambda function works with or without authorization context
- `event.requestContext.authorizer` is undefined for public requests
- No breaking changes to existing functionality
- Authorization context is additive, not required


### User Table for Per-User Authentication

**DynamoDB Table:**

```yaml
UserTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub '${Prefix}-${ProjectId}-${StageId}-Users'
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: userId
        AttributeType: S
      - AttributeName: email
        AttributeType: S
    KeySchema:
      - AttributeName: userId
        KeyType: HASH
    GlobalSecondaryIndexes:
      - IndexName: EmailIndex
        KeySchema:
          - AttributeName: email
            KeyType: HASH
        Projection:
          ProjectionType: ALL
    Tags:
      - Key: Environment
        Value: !Ref StageId
      - Key: Project
        Value: !Ref ProjectId
```

**User Table Schema:**

```javascript
{
  userId: 'user-123',           // Partition key
  email: 'user@example.com',    // GSI key
  apiKey: 'hashed-api-key',     // Hashed API key
  tier: 'pro',                  // free, pro, enterprise
  rateLimit: 1000,              // Requests per hour
  createdAt: '2025-01-24T00:00:00Z',
  lastAccessAt: '2025-01-24T12:00:00Z',
  requestCount: 42,             // Total requests
  quotaResetAt: '2025-01-24T13:00:00Z'
}
```

### Migration Path Summary

**Phase 1 (Current Spec):**
1. Remove API key resources
2. Enable public keyless access
3. Maintain all existing functionality
4. No Lambda function changes

**Phase 2 (Future):**
1. Add Lambda authorizer function
2. Add UserTable for user accounts
3. Update OpenAPI spec with optional security scheme
4. Update Lambda functions to use authorization context
5. Add user registration endpoints
6. Implement per-user rate limiting

**Phase 3 (Future):**
1. Add user dashboard for API key management
2. Add usage analytics and reporting
3. Add tiered pricing (free, pro, enterprise)
4. Add webhook notifications for quota limits


## Implementation Steps

### Step 1: Update CloudFormation Template

**File:** `application-infrastructure/template.yml`

1. Remove MCPPublicApiKey resource (lines 591-605)
2. Remove MCPPublicUsagePlan resource (lines 607-625)
3. Remove MCPUsagePlanKey resource (lines 627-632)
4. Remove PublicRateLimit parameter from Parameters section (around line 300)
5. Remove PublicRateLimit from Metadata ParameterGroups (around line 50)
6. Remove MethodSettings throttling from WebApi resource (lines 560-565)
7. Remove PUBLIC_RATE_LIMIT from ReadLambdaFunction environment variables (around line 700)
8. Verify CORS configuration remains in WebApi resource
9. Verify logging configuration remains in WebApi resource

**Validation:**
- Run `sam validate --template application-infrastructure/template.yml`
- Verify no syntax errors
- Verify removed resources are not referenced elsewhere

### Step 2: Update SAM Configuration Files

**File:** `application-infrastructure/samconfig-test.toml`

1. Remove `"PublicRateLimit=100"` from parameter_overrides array
2. Verify all other parameters remain

**File:** `application-infrastructure/samconfig-prod.toml`

1. Remove `"PublicRateLimit=100"` from parameter_overrides array
2. Verify all other parameters remain

**Validation:**
- Parse TOML files to verify syntax
- Verify no references to PublicRateLimit

### Step 3: Verify OpenAPI Specification

**File:** `application-infrastructure/template-openapi-spec.yml`

1. Verify no `securitySchemes` section exists in components
2. Verify no `security` requirements on any endpoint
3. Verify all 9 MCP endpoints are defined
4. Verify all endpoints use `x-amazon-apigateway-integration`

**Validation:**
- Validate OpenAPI 3.0 syntax
- Verify all endpoints reference ReadLambdaFunction


### Step 4: Deploy to TEST Environment

**Using Atlantis Platform Scripts:**

```bash
# Deployment is handled by Atlantis CI/CD pipeline
# Merge changes to 'test' branch to trigger deployment
git checkout test
git merge dev
git push origin test

# Monitor deployment in AWS CodePipeline console
# Pipeline: atlantis-mcp-test-pipeline
```

**Manual Deployment (Local Testing Only):**

```bash
# Build SAM application
sam build --config-file application-infrastructure/samconfig-test.toml

# Deploy to TEST environment
sam deploy --config-file application-infrastructure/samconfig-test.toml --guided

# Verify deployment
aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --query 'Stacks[0].StackStatus'
```

**Validation:**
- Verify stack status is CREATE_COMPLETE or UPDATE_COMPLETE
- Verify no API key resources in stack outputs
- Verify API Gateway endpoint is accessible

### Step 5: Test Endpoints

**Test Script:**

```bash
#!/bin/bash
# test-endpoints.sh

API_ENDPOINT="https://example.execute-api.us-east-1.amazonaws.com/api"

# Test each MCP endpoint without API key
for endpoint in list_templates get_template list_starters get_starter_info \
                search_documentation validate_naming check_template_updates \
                list_template_versions list_categories; do
  echo "Testing /mcp/${endpoint}..."
  
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_ENDPOINT}/mcp/${endpoint}" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"${endpoint}\",\"params\":{},\"id\":1}")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" = "200" ]; then
    echo "✓ ${endpoint} returned 200"
  else
    echo "✗ ${endpoint} returned ${http_code}"
    echo "Response: ${body}"
  fi
done
```

**Validation:**
- All endpoints return HTTP 200
- All responses contain valid JSON-RPC 2.0 structure
- CORS headers present in all responses


### Step 6: Run Test Suite

**Unit Tests:**

```bash
# Run CloudFormation template validation tests
npm test -- test/infrastructure/template-validation.test.js

# Run SAM configuration validation tests
npm test -- test/infrastructure/samconfig-validation.test.js
```

**Integration Tests:**

```bash
# Set API endpoint from CloudFormation outputs
export API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Run integration tests
npm test -- test/integration/deployment.test.js
npm test -- test/integration/endpoint-access.test.js
```

**Property-Based Tests:**

```bash
# Run property tests (100 iterations each)
npm test -- test/property/keyless-access-property.test.js
npm test -- test/property/cors-headers-property.test.js
npm test -- test/property/jsonrpc-roundtrip-property.test.js
```

**Validation:**
- All unit tests pass
- All integration tests pass
- All property tests pass (100 iterations each)

### Step 7: Deploy to PROD Environment

**Using Atlantis Platform Scripts:**

```bash
# Merge to beta/stage for staging deployment
git checkout beta
git merge test
git push origin beta

# After validation, merge to main for production
git checkout main
git merge beta
git push origin main

# Monitor deployment in AWS CodePipeline console
# Pipeline: atlantis-mcp-prod-pipeline
```

**Validation:**
- Verify gradual deployment completes successfully
- Verify CloudWatch alarms do not trigger
- Verify production endpoints accessible
- Run smoke tests against production


### Step 8: Verify Logging and Monitoring

**CloudWatch Logs:**

```bash
# Check API Gateway access logs
aws logs tail /aws/apigateway/acme-atlantis-mcp-test-WebApi-access-logs --follow

# Check API Gateway execution logs
aws logs tail API-Gateway-Execution-Logs_${API_ID}/api --follow

# Check Lambda function logs
aws logs tail /aws/lambda/acme-atlantis-mcp-test-ReadFunction --follow
```

**CloudWatch Metrics:**

- Verify API Gateway request count metrics
- Verify Lambda invocation metrics
- Verify Lambda error metrics
- Verify API Gateway 4xx/5xx error metrics

**CloudWatch Alarms (PROD only):**

- Verify ReadLambdaErrorsAlarm is not triggered
- Verify ApiGatewayErrorsAlarm is not triggered
- Verify ReadLambdaLatencyAlarm is not triggered

**Validation:**
- Logs show successful requests without API key errors
- Metrics show normal request patterns
- No alarms triggered

### Step 9: Update Documentation

**Files to Update:**

1. `README.md` - Update API usage examples to remove API key references
2. `docs/api-reference.md` - Update endpoint documentation
3. `CHANGELOG.md` - Document the removal of API key requirement

**Example README Update:**

```markdown
## Quick Start

Send a POST request to any MCP endpoint:

```bash
curl -X POST https://api.example.com/api/mcp/list_templates \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "list_templates",
    "params": {},
    "id": 1
  }'
```

No API key required!
```

**Validation:**
- Documentation accurately reflects keyless access
- All code examples work without API keys
- Migration notes explain the change


## Rollback Plan

### Scenario 1: Deployment Fails

**Symptoms:**
- CloudFormation stack creation/update fails
- Stack status is ROLLBACK_IN_PROGRESS or UPDATE_ROLLBACK_IN_PROGRESS

**Action:**
1. CloudFormation automatically rolls back to previous version
2. Review CloudFormation events for error details
3. Fix issues in template
4. Redeploy

**No manual intervention required** - CloudFormation handles rollback automatically.

### Scenario 2: Endpoints Return Errors After Deployment

**Symptoms:**
- API Gateway returns 403 Forbidden errors
- API Gateway returns 500 Internal Server Error
- Lambda functions fail to execute

**Action:**

```bash
# Rollback CloudFormation stack to previous version
aws cloudformation update-stack \
  --stack-name atlantis-mcp-test \
  --use-previous-template \
  --parameters UsePreviousValue=true

# Or delete and recreate from previous commit
git revert HEAD
git push origin test
# Wait for CI/CD pipeline to redeploy
```

### Scenario 3: Excessive Traffic Without Rate Limiting

**Symptoms:**
- Lambda invocation count spikes unexpectedly
- AWS costs increase significantly
- API becomes unresponsive

**Action:**

**Immediate (Emergency):**

```bash
# Set Lambda reserved concurrency to limit invocations
aws lambda put-function-concurrency \
  --function-name acme-atlantis-mcp-test-ReadFunction \
  --reserved-concurrent-executions 10

# Or disable API Gateway stage
aws apigateway update-stage \
  --rest-api-id ${API_ID} \
  --stage-name api \
  --patch-operations op=replace,path=/deploymentId,value=${PREVIOUS_DEPLOYMENT_ID}
```

**Long-term:**
- Deploy CloudFront and WAF for rate limiting
- Rollback to API key version if necessary
- Implement Lambda authorizer with rate limiting


### Rollback Decision Matrix

| Scenario | Severity | Rollback? | Action |
|----------|----------|-----------|--------|
| Deployment fails | High | Automatic | CloudFormation auto-rollback |
| 403 errors on all endpoints | High | Yes | Revert commit, redeploy |
| 500 errors from Lambda | High | Yes | Revert commit, redeploy |
| Excessive traffic spike | High | No | Set Lambda concurrency limit, deploy WAF |
| Missing CORS headers | Medium | Yes | Fix CORS config, redeploy |
| Logging not working | Low | No | Fix logging config, redeploy |
| Single endpoint fails | Low | No | Debug specific endpoint |

## Security Considerations

### DDoS Protection Strategy

**Without API Gateway Rate Limiting:**

The removal of API Gateway usage plans eliminates built-in rate limiting. Protection is provided by:

1. **AWS Service Limits:** API Gateway has account-level throttling (10,000 requests per second default)
2. **Lambda Concurrency Limits:** Set reserved concurrency to prevent runaway costs
3. **CloudFront (Future):** Edge caching and traffic absorption
4. **AWS WAF (Future):** IP-based rate limiting and bot detection

**Recommended Lambda Concurrency Limits:**

```yaml
ReadLambdaFunction:
  Type: AWS::Serverless::Function
  Properties:
    # ... other properties ...
    ReservedConcurrentExecutions: !If 
      - IsProduction
      - 100  # PROD: Allow higher concurrency
      - 10   # TEST: Limit concurrency to control costs
```

### Cost Protection

**CloudWatch Alarms for Cost Control:**

```yaml
LambdaInvocationAlarm:
  Type: AWS::CloudWatch::Alarm
  Condition: CreateAlarms
  Properties:
    AlarmDescription: Lambda invocations exceed threshold
    MetricName: Invocations
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 1
    Threshold: 10000  # Alert if > 10k invocations in 5 minutes
    ComparisonOperator: GreaterThanThreshold
    Dimensions:
      - Name: FunctionName
        Value: !Ref ReadLambdaFunction
    AlarmActions:
      - !Ref CostAlarmNotification
```

**AWS Budgets:**

Set up AWS Budgets to alert when costs exceed thresholds:
- TEST environment: $10/month
- PROD environment: $100/month


### Input Validation

**Lambda Function Input Validation:**

Even without API key authentication, Lambda functions must validate all inputs:

```javascript
// src/lambda/read/index.js
export const handler = async (event, context) => {
  try {
    // Validate request body exists
    if (!event.body) {
      return errorResponse(400, 'Missing request body');
    }

    // Parse and validate JSON
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      return errorResponse(400, 'Invalid JSON');
    }

    // Validate JSON-RPC 2.0 structure
    if (body.jsonrpc !== '2.0') {
      return errorResponse(400, 'Invalid JSON-RPC version');
    }

    if (!body.method || typeof body.method !== 'string') {
      return errorResponse(400, 'Missing or invalid method');
    }

    if (body.id === undefined) {
      return errorResponse(400, 'Missing request id');
    }

    // Validate method is allowed
    const allowedMethods = [
      'list_templates',
      'get_template',
      'list_starters',
      'get_starter_info',
      'search_documentation',
      'validate_naming',
      'check_template_updates',
      'list_template_versions',
      'list_categories'
    ];

    if (!allowedMethods.includes(body.method)) {
      return errorResponse(400, `Unknown method: ${body.method}`);
    }

    // Process request
    const result = await processMcpRequest(body);
    return successResponse(result, body.id);

  } catch (error) {
    console.error('Error processing request:', error);
    return errorResponse(500, 'Internal server error');
  }
};

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: statusCode === 400 ? -32600 : -32603,
        message
      },
      id: null
    })
  };
}

function successResponse(result, id) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      result,
      id
    })
  };
}
```


### Logging and Monitoring

**Security Event Logging:**

Log all requests for security monitoring and analytics:

```javascript
// Log request metadata (no sensitive data)
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  requestId: context.requestId,
  method: body.method,
  sourceIp: event.requestContext?.identity?.sourceIp,
  userAgent: event.requestContext?.identity?.userAgent,
  success: true
}));
```

**CloudWatch Insights Queries:**

Monitor for suspicious activity:

```sql
-- Find IPs with high request rates
fields @timestamp, requestContext.identity.sourceIp as ip
| stats count() as requestCount by ip
| filter requestCount > 100
| sort requestCount desc

-- Find failed requests
fields @timestamp, body.method, statusCode
| filter statusCode >= 400
| stats count() by statusCode, body.method

-- Find requests from specific countries (if using CloudFront)
fields @timestamp, requestContext.identity.sourceIp as ip
| filter ip like /^(?!10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
```

## Performance Considerations

### API Gateway Performance

**Expected Performance:**
- Latency: < 100ms (API Gateway overhead)
- Throughput: 10,000 requests/second (AWS account limit)
- Cold start: 1-2 seconds (Lambda cold start)
- Warm request: 50-200ms (Lambda execution)

**Optimization Strategies:**
1. Use Lambda provisioned concurrency for production (reduces cold starts)
2. Enable API Gateway caching for frequently accessed endpoints
3. Use CloudFront for edge caching (future)
4. Optimize Lambda function code for fast execution

### Lambda Function Performance

**Memory Configuration:**
- Current: 1024 MB
- Recommended: Monitor CloudWatch metrics and adjust based on actual usage
- Higher memory = faster CPU = potentially lower cost per request

**Timeout Configuration:**
- Current: 10 seconds
- Recommended: Keep at 10 seconds (API Gateway timeout is 30 seconds)
- Most MCP operations should complete in < 5 seconds


## Compliance and Governance

### Atlantis Platform Compliance

This design follows Atlantis platform requirements:

**✓ Serverless-First Architecture:**
- Uses API Gateway and Lambda (no EC2 instances)
- Event-driven design (API Gateway triggers Lambda)
- Modular stack (single application stack)

**✓ Naming Conventions:**
- All resources follow `Prefix-ProjectId-StageId-Resource` pattern
- Examples: `acme-atlantis-mcp-test-WebApi`, `acme-atlantis-mcp-prod-ReadFunction`

**✓ IAM Least Privilege:**
- ReadLambdaExecutionRole has minimal permissions
- No AWS managed policies used
- Resource-scoped permissions only

**✓ Separation of Concerns:**
- Application stack only (no shared infrastructure)
- CloudFront/WAF managed separately by platform team
- No account-level resources created

**✓ CI/CD Pipeline Integration:**
- Deploys through Atlantis platform scripts
- Branch-to-environment mapping: test → beta → main
- Gradual deployment in PROD, immediate in TEST

**✓ Environment-Specific Configuration:**
- Conditional resources based on DeployEnvironment parameter
- Different log retention for TEST vs PROD
- Alarms only in PROD environment

### AWS Well-Architected Framework

**Operational Excellence:**
- Infrastructure as Code (CloudFormation/SAM)
- Automated deployments via CI/CD
- CloudWatch logging and monitoring
- Rollback capabilities

**Security:**
- No hardcoded credentials
- Input validation in Lambda functions
- HTTPS only (API Gateway enforces)
- CloudWatch logging for audit trail

**Reliability:**
- Automatic CloudFormation rollback on failure
- Lambda retry behavior (API Gateway handles)
- CloudWatch alarms for error detection
- Multi-AZ deployment (API Gateway and Lambda default)

**Performance Efficiency:**
- Serverless architecture (auto-scaling)
- Lambda right-sizing (1024 MB memory)
- API Gateway caching capability
- CloudFront edge caching (future)

**Cost Optimization:**
- Pay-per-request pricing (no idle costs)
- Lambda concurrency limits prevent runaway costs
- CloudWatch alarms for cost monitoring
- Shorter log retention in TEST environment


## Summary

This design document specifies the removal of API key authentication from the Atlantis MCP Server to enable public keyless access. The implementation removes three CloudFormation resources (MCPPublicApiKey, MCPPublicUsagePlan, MCPUsagePlanKey) and the PublicRateLimit parameter while maintaining all existing functionality, logging, and CORS configuration.

**Key Changes:**
- Remove API key resources from CloudFormation template
- Remove PublicRateLimit parameter from template and SAM configs
- Remove MethodSettings throttling configuration
- Maintain all CORS and logging configuration
- No Lambda function code changes required

**Benefits:**
- Fixes deployment failures due to missing CloudFormation permissions
- Enables seamless MCP client integration without API key configuration
- Prepares architecture for future Lambda authorizer integration
- Maintains backward compatibility with existing integrations

**Testing Strategy:**
- Unit tests validate template structure and configuration
- Integration tests verify deployment success and endpoint accessibility
- Property-based tests validate keyless access, CORS headers, and JSON-RPC compliance
- Minimum 100 iterations per property test

**Deployment Path:**
- Deploy to TEST environment via Atlantis CI/CD pipeline
- Validate all endpoints accessible without API keys
- Run full test suite (unit, integration, property tests)
- Deploy to PROD via gradual deployment (beta → main)

**Future Extensibility:**
- Architecture supports adding Lambda authorizer without breaking changes
- OpenAPI spec can be extended with optional security schemes
- Lambda functions can receive authorization context without code changes
- Public access and authenticated access can coexist

This design follows Atlantis platform requirements for serverless architecture, naming conventions, IAM least privilege, and CI/CD integration. The implementation is isolated to application-specific resources and does not modify shared infrastructure.

