---
inclusion: fileMatch
fileMatchPattern: 'application-infrastructure/template.yml'
---

# OpenAPI Specification Synchronization

## Purpose

This steering document ensures that the OpenAPI specification (`template-openapi-spec.yml`) stays synchronized with the SAM template (`template.yml`) API Gateway definitions. When you modify API endpoints in the SAM template, you must also update the OpenAPI specification.

## When This Applies

This guidance applies when you are working on `application-infrastructure/template.yml` and making changes to:

- Lambda function `Events` sections that define API Gateway endpoints
- API Gateway path definitions
- HTTP methods for endpoints
- Lambda function handlers that process API requests

## Required Actions

### When Adding a New API Endpoint

If you add a new API Gateway event to a Lambda function in `template.yml`:

```yaml
Events:
  NewEndpoint:
    Type: Api
    Properties:
      Path: /mcp/new_endpoint
      Method: post
      RestApiId: !Ref WebApi
```

**You MUST also add the endpoint to `template-openapi-spec.yml`:**

```yaml
paths:
  /mcp/new_endpoint:
    post:
      description: "Description of what this endpoint does"
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
          Fn::Sub: arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ReadLambdaFunction.Alias}/invocations
```

### When Removing an API Endpoint

If you remove an API Gateway event from `template.yml`, **you MUST also remove the corresponding path from `template-openapi-spec.yml`**.

### When Modifying an Endpoint

If you change the path or method of an endpoint in `template.yml`, **you MUST update the corresponding entry in `template-openapi-spec.yml`**.

## Operations With No Lambda Integration

The one-to-one rule between SAM `Events` and OpenAPI operations applies to operations that invoke a
Lambda function. An operation whose integration is `mock` has no `Events` entry and needs no Lambda
permission. `/mcp/v1` carries one: an `x-amazon-apigateway-any-method` mock that answers `405` with
`Allow: POST` for every method other than `POST` and `OPTIONS`.

Such an operation must never answer `403` or `404`, because CloudFront rewrites both to the site's
landing page with HTTP 200.

## OpenAPI Spec Structure for MCP Endpoints

All MCP endpoints follow this pattern:

### Path Definition

```yaml
/mcp/endpoint_name:
  post:
    description: "Clear description of what this endpoint does"
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
      '400':
        description: "Bad request"
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MCPError'
      '500':
        description: "Internal server error"
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MCPError'
    x-amazon-apigateway-integration:
      httpMethod: post
      type: aws_proxy
      uri:
        Fn::Sub: arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ReadLambdaFunction.Alias}/invocations
```

### Lambda Function Reference

The `x-amazon-apigateway-integration` section must reference the correct Lambda function:

- For read-only operations: `${ReadLambdaFunction.Alias}` (the Read function is invoked through its
  `live` alias so CodeDeploy traffic shifting and alarm rollback apply to API callers)
- For the Auth function: `${AuthLambdaFunction.Arn}` (it has no alias)
- For write operations (Phase 2): `${WriteLambdaFunction.Arn}`

## Integration Targets and Lambda Permissions

A function that declares `AutoPublishAlias` MUST be referenced by its alias (`${Function.Alias}`) in
`template-openapi-spec.yml`. The unqualified ARN (`${Function.Arn}`) runs `$LATEST`, which CodeDeploy
never shifts, so a gradual deployment would protect nobody.

SAM generates an `AWS::Lambda::Permission` for the alias from each function's `Api` event, scoped to the
event's method and path. An integration that targets the alias is therefore already covered. Do not add a
hand-written `Permission`/`PermissionLive` pair for it.

> **Note**: This repository deliberately departs from the permission-pair guidance in
> `atlantis-multi-resource-src.md` for the Read function. That file is published by the Atlantis project
> and is not edited here. The reasoning and evidence are in
> `.kiro/specs/0-0-7-api-gateway-live-alias/PLAN.md`.

The test `read-function/tests/unit/architecture/openapi-integration-targets.test.js` enforces the Read
and Auth integration targets. Adding a function to the OpenAPI spec requires a decision, recorded in that
test, about whether it is aliased.

## MCP Protocol Schemas

The OpenAPI spec should include these reusable schemas in the `components/schemas` section:

### MCPRequest Schema

```yaml
MCPRequest:
  type: object
  required:
    - jsonrpc
    - method
    - id
  properties:
    jsonrpc:
      type: string
      enum: ['2.0']
      description: "JSON-RPC version"
    method:
      type: string
      description: "MCP method name"
    params:
      type: object
      description: "Method-specific parameters"
    id:
      oneOf:
        - type: string
        - type: number
      description: "Request identifier"
```

### MCPResponse Schema

```yaml
MCPResponse:
  type: object
  required:
    - jsonrpc
    - id
  properties:
    jsonrpc:
      type: string
      enum: ['2.0']
      description: "JSON-RPC version"
    result:
      type: object
      description: "Method result"
    id:
      oneOf:
        - type: string
        - type: number
      description: "Request identifier matching the request"
```

### MCPError Schema

```yaml
MCPError:
  type: object
  required:
    - jsonrpc
    - error
    - id
  properties:
    jsonrpc:
      type: string
      enum: ['2.0']
      description: "JSON-RPC version"
    error:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: integer
          description: "Error code"
        message:
          type: string
          description: "Error message"
        data:
          type: object
          description: "Additional error data"
    id:
      oneOf:
        - type: string
        - type: number
        - type: 'null'
      description: "Request identifier or null"
```

## Validation Checklist

Before committing changes to `template.yml`, verify:

- [ ] All API Gateway events in `template.yml` have corresponding paths in `template-openapi-spec.yml`
- [ ] All paths in `template-openapi-spec.yml` correspond to events in `template.yml`
- [ ] HTTP methods match between both files
- [ ] Lambda function references are correct in `x-amazon-apigateway-integration` sections
- [ ] Request and response schemas are defined
- [ ] Endpoint descriptions are clear and accurate

## Current MCP Endpoints

As of the last update, these endpoints are defined in `template.yml`:

1. POST /mcp/list_templates
2. POST /mcp/get_template
3. POST /mcp/list_starters
4. POST /mcp/get_starter_info
5. POST /mcp/search_documentation
6. POST /mcp/validate_naming
7. POST /mcp/check_template_updates
8. POST /mcp/list_template_versions
9. POST /mcp/list_categories

**All of these must be documented in `template-openapi-spec.yml`.**

## Summary

**Remember:** When you modify API endpoints in `template.yml`, you must also update `template-openapi-spec.yml`. The OpenAPI spec is included in the SAM template via `Fn::Transform` and is used by API Gateway to define the API structure.

**Key Points:**
- One-to-one correspondence between SAM Events and OpenAPI paths
- Use MCP protocol schemas for consistency
- Reference the correct Lambda function in integrations
- Validate before committing
