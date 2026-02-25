# Implementation Plan: Remove API Key Requirement

## Overview

This implementation plan breaks down the removal of API key authentication from the Atlantis MCP Server into discrete, actionable tasks. The implementation removes three CloudFormation resources (MCPPublicApiKey, MCPPublicUsagePlan, MCPUsagePlanKey) and associated configuration to enable public keyless access while maintaining all existing functionality.

## Tasks

- [x] 1. Update CloudFormation template to remove API key resources
  - [x] 1.1 Remove MCPPublicApiKey resource from template.yml
    - Remove lines 591-605 containing the AWS::ApiGateway::ApiKey resource
    - _Requirements: 1.1_
  
  - [x] 1.2 Remove MCPPublicUsagePlan resource from template.yml
    - Remove lines 607-625 containing the AWS::ApiGateway::UsagePlan resource
    - _Requirements: 1.2_
  
  - [x] 1.3 Remove MCPUsagePlanKey resource from template.yml
    - Remove lines 627-632 containing the AWS::ApiGateway::UsagePlanKey resource
    - _Requirements: 1.3_
  
  - [x] 1.4 Remove PublicRateLimit parameter from template.yml
    - Remove PublicRateLimit parameter definition from Parameters section (around line 300)
    - Remove PublicRateLimit from Metadata ParameterGroups section (around line 50)
    - _Requirements: 1.4, 1.5_
  
  - [x] 1.5 Remove MethodSettings throttling configuration from WebApi resource
    - Remove ThrottlingBurstLimit and ThrottlingRateLimit from MethodSettings in WebApi resource (lines 560-565)
    - Maintain MethodSettings for logging configuration
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  
  - [x] 1.6 Remove PUBLIC_RATE_LIMIT environment variable from ReadLambdaFunction
    - Remove PUBLIC_RATE_LIMIT from ReadLambdaFunction environment variables (around line 700)
    - _Requirements: 7.5_
  
  - [x] 1.7 Validate CloudFormation template syntax
    - Run `sam validate --template application-infrastructure/template.yml`
    - Verify no syntax errors
    - Verify removed resources are not referenced elsewhere in template
    - _Requirements: 1.6, 10.1_

- [x] 2. Update SAM configuration files
  - [x] 2.1 Remove PublicRateLimit from samconfig-test.toml
    - Remove `"PublicRateLimit=100"` from parameter_overrides array
    - Verify all other parameters remain intact
    - _Requirements: 8.1, 8.3_
  
  - [x] 2.2 Remove PublicRateLimit from samconfig-prod.toml
    - Remove `"PublicRateLimit=100"` from parameter_overrides array
    - Verify all other parameters remain intact
    - _Requirements: 8.2, 8.3_
  
  - [x] 2.3 Validate SAM configuration files
    - Parse TOML files to verify syntax is valid
    - Verify no references to PublicRateLimit remain
    - _Requirements: 8.3, 8.4_

- [x] 3. Verify OpenAPI specification
  - [x] 3.1 Verify no securitySchemes in template-openapi-spec.yml
    - Confirm no `securitySchemes` section exists in components
    - _Requirements: 5.1_
  
  - [x] 3.2 Verify no security requirements on endpoints
    - Confirm no `security` requirements on any endpoint definition
    - _Requirements: 5.2_
  
  - [x] 3.3 Verify all MCP endpoints are defined
    - Confirm all 9 MCP endpoints are present: list_templates, get_template, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates, list_template_versions, list_categories
    - _Requirements: 5.3_
  
  - [x] 3.4 Verify x-amazon-apigateway-integration configurations
    - Confirm all endpoints use `x-amazon-apigateway-integration` with ReadLambdaFunction
    - _Requirements: 5.5_
  
  - [x] 3.5 Validate OpenAPI specification syntax
    - Validate OpenAPI 3.0 syntax
    - Verify all endpoints reference ReadLambdaFunction correctly
    - _Requirements: 5.4_

- [x] 4. Checkpoint - Ensure all configuration changes are complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Deploy to TEST environment
  - [ ] 5.1 Build SAM application for TEST
    - Run `sam build --config-file application-infrastructure/samconfig-test.toml`
    - Verify build completes successfully
    - _Requirements: 10.1_
  
  - [ ] 5.2 Deploy CloudFormation stack to TEST
    - Deploy using Atlantis platform CI/CD pipeline (merge to test branch)
    - Or manual deployment: `sam deploy --config-file application-infrastructure/samconfig-test.toml`
    - _Requirements: 10.1, 10.2_
  
  - [ ] 5.3 Verify deployment success
    - Verify stack status is CREATE_COMPLETE or UPDATE_COMPLETE
    - Verify no API key resources in stack outputs
    - Verify API Gateway endpoint is accessible
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 6. Test keyless endpoint access in TEST environment
  - [ ] 6.1 Test all MCP endpoints without API key
    - Send POST requests to all 9 MCP endpoints without x-api-key header
    - Verify all endpoints return HTTP 200
    - Verify responses contain valid JSON-RPC 2.0 structure
    - _Requirements: 2.1, 2.3, 2.4, 10.4, 10.5_
  
  - [ ] 6.2 Verify CORS headers in responses
    - Verify Access-Control-Allow-Origin: * header present
    - Verify Access-Control-Allow-Methods includes POST and OPTIONS
    - Send OPTIONS preflight requests and verify responses
    - _Requirements: 2.5_
  
  - [ ] 6.3 Verify JSON-RPC 2.0 protocol compliance
    - Verify request format is accepted (jsonrpc: "2.0", method, params, id)
    - Verify response format is correct (jsonrpc: "2.0", result/error, id)
    - _Requirements: 7.3, 7.4_

- [ ] 7. Write and run unit tests
  - [ ]* 7.1 Write unit tests for CloudFormation template validation
    - Test that MCPPublicApiKey resource is not present
    - Test that MCPPublicUsagePlan resource is not present
    - Test that MCPUsagePlanKey resource is not present
    - Test that PublicRateLimit parameter is not present
    - Test that WebApi resource maintains CORS configuration
    - Test that MethodSettings does not include throttling configuration
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_
  
  - [ ]* 7.2 Write unit tests for SAM configuration validation
    - Test that samconfig-test.toml does not include PublicRateLimit
    - Test that samconfig-prod.toml does not include PublicRateLimit
    - Test that other required parameters remain in both files
    - _Requirements: 8.1, 8.2, 8.4_
  
  - [ ]* 7.3 Run all unit tests
    - Execute unit test suite
    - Verify all tests pass
    - _Requirements: 10.1_

- [ ] 8. Write and run integration tests
  - [ ]* 8.1 Write integration test for deployment success
    - Test that CloudFormation stack deploys successfully
    - Test that no API key resources are created
    - Test that API Gateway endpoint is accessible
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [ ]* 8.2 Write integration test for endpoint accessibility
    - Test that all 9 MCP endpoints accept requests without API key
    - Test that all endpoints return HTTP 200
    - Test that responses contain valid JSON
    - _Requirements: 2.1, 2.3, 2.4, 10.4, 10.5_
  
  - [ ]* 8.3 Run all integration tests
    - Set API_ENDPOINT environment variable from CloudFormation outputs
    - Execute integration test suite
    - Verify all tests pass
    - _Requirements: 10.4, 10.5_

- [ ] 9. Write and run property-based tests
  - [ ]* 9.1 Write property test for keyless access to all endpoints
    - **Property 1: Keyless Access to All Endpoints**
    - **Validates: Requirements 2.1, 2.3, 2.4, 10.5**
    - Test that any valid MCP endpoint accepts requests without API key
    - Test with random valid JSON-RPC 2.0 request bodies
    - Verify HTTP 200 responses with valid JSON-RPC 2.0 content
    - Run 100 iterations
    - _Requirements: 2.1, 2.3, 2.4, 10.5_
  
  - [ ]* 9.2 Write property test for CORS headers
    - **Property 2: CORS Headers Present**
    - **Validates: Requirements 2.5**
    - Test that any valid MCP endpoint includes CORS headers
    - Test with random origins
    - Verify Access-Control-Allow-Origin: * header
    - Test OPTIONS preflight requests
    - Run 100 iterations
    - _Requirements: 2.5_
  
  - [ ]* 9.3 Write property test for JSON-RPC 2.0 round-trip
    - **Property 3: JSON-RPC 2.0 Round-Trip**
    - **Validates: Requirements 7.3, 7.4**
    - Test that any valid JSON-RPC 2.0 request structure is accepted
    - Test with random method names, params, and id values
    - Verify response has matching id and jsonrpc: "2.0"
    - Verify response has either result or error field
    - Run 100 iterations
    - _Requirements: 7.3, 7.4_
  
  - [ ]* 9.4 Run all property-based tests
    - Execute property test suite
    - Verify all tests pass with 100 iterations each
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 7.3, 7.4, 10.5_

- [ ] 10. Checkpoint - Ensure all tests pass in TEST environment
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Verify logging and monitoring in TEST environment
  - [ ] 11.1 Verify CloudWatch logs capture requests
    - Check API Gateway access logs for successful requests
    - Check API Gateway execution logs for request processing
    - Check Lambda function logs for MCP request handling
    - Verify logs show no API key errors
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 11.2 Verify CloudWatch metrics are collected
    - Verify API Gateway request count metrics
    - Verify Lambda invocation metrics
    - Verify Lambda error metrics
    - Verify API Gateway 4xx/5xx error metrics
    - _Requirements: 4.4_

- [ ] 12. Deploy to PROD environment
  - [ ] 12.1 Merge to beta/stage branch for staging deployment
    - Merge test branch to beta branch
    - Push to origin to trigger Atlantis CI/CD pipeline
    - Monitor deployment in AWS CodePipeline console
    - Verify staging deployment completes successfully
    - _Requirements: 10.1_
  
  - [ ] 12.2 Deploy to production (main branch)
    - Merge beta branch to main branch
    - Push to origin to trigger Atlantis CI/CD pipeline
    - Monitor gradual deployment in AWS CodePipeline console
    - Verify production deployment completes successfully
    - _Requirements: 10.1, 10.2_
  
  - [ ] 12.3 Verify production endpoints are accessible
    - Test all 9 MCP endpoints in production without API key
    - Verify all endpoints return HTTP 200
    - Verify CORS headers present
    - _Requirements: 10.3, 10.4, 10.5_
  
  - [ ] 12.4 Verify CloudWatch alarms do not trigger
    - Check ReadLambdaErrorsAlarm status
    - Check ApiGatewayErrorsAlarm status
    - Check ReadLambdaLatencyAlarm status
    - Verify no alarms triggered
    - _Requirements: 10.1_

- [ ] 13. Update documentation
  - [ ] 13.1 Update README.md
    - Remove API key references from usage examples
    - Update Quick Start section to show keyless access
    - Add note that no API key is required
    - _Requirements: 9.1_
  
  - [ ] 13.2 Update API reference documentation
    - Update endpoint documentation to remove API key requirements
    - Update code examples to remove x-api-key headers
    - Verify all examples work without API keys
    - _Requirements: 9.1_
  
  - [ ] 13.3 Update CHANGELOG.md
    - Document removal of API key requirement
    - Explain that endpoints now support keyless public access
    - Note that this is a non-breaking change (existing integrations continue working)
    - Add migration notes explaining the architecture change
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 14. Final checkpoint - Verify production deployment
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No Lambda function code changes required - Lambda functions continue processing requests identically
- CORS configuration is maintained throughout all changes
- Logging configuration is maintained throughout all changes
- CloudFront and WAF resources are managed separately by platform team (not in this stack)
- Deployment follows Atlantis platform workflow: test → beta → main
- Tasks marked with `*` are optional testing tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties with 100 iterations each
