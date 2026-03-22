# Requirements Document

## Introduction

The Atlantis MCP Server (v0.0.1) currently fails to integrate with MCP clients such as Kiro IDE. Three root causes were identified from connection logs:

1. The server returns a custom response format (`protocol`, `version`, `tool`, `success`, `data`, `timestamp`) instead of JSON-RPC 2.0 messages required by the MCP specification.
2. The endpoint structure uses per-tool paths (`/mcp/list_tools`, `/mcp/get_template`, etc.) instead of a single MCP endpoint at `/{api_base}/mcp/v1` that handles JSON-RPC 2.0 method dispatch.
3. User documentation contains incorrect URLs and MCP client configuration examples.

This spec addresses making the MCP server compliant with the MCP protocol (JSON-RPC 2.0 over Streamable HTTP), consolidating endpoints, updating documentation, and correcting the OpenAPI specification.

The production instance is located at `https://mcp.atlantis.63klabs.net/mcp/v1`.

## Glossary

- **MCP_Server**: The Atlantis MCP Server Lambda function handling read-only MCP operations
- **MCP_Client**: An AI assistant or IDE (Kiro, Claude Desktop, Cursor, etc.) connecting to the MCP_Server via the MCP protocol
- **JSON_RPC_Router**: The routing layer that receives JSON-RPC 2.0 requests and dispatches to the appropriate controller based on the `method` field
- **MCP_Protocol_Layer**: The utility module (`mcp-protocol.js`) responsible for formatting responses in JSON-RPC 2.0 format
- **OpenAPI_Spec**: The `template-openapi-spec.yml` file defining API Gateway endpoint structure
- **SAM_Template**: The `template.yml` CloudFormation/SAM template defining infrastructure resources
- **Integration_Docs**: User-facing documentation in `docs/integration/` describing how to connect MCP clients
- **Streamable_HTTP**: The MCP transport mechanism where JSON-RPC 2.0 messages are sent over HTTP POST to a single endpoint

## Requirements

### Requirement 1: JSON-RPC 2.0 Response Format

**User Story:** As an MCP_Client developer, I want the MCP_Server to return JSON-RPC 2.0 compliant responses, so that standard MCP clients can parse and process server responses.

#### Acceptance Criteria

1. WHEN an MCP_Client sends a valid JSON-RPC 2.0 request, THE MCP_Protocol_Layer SHALL return a response containing `jsonrpc` set to `"2.0"`, an `id` matching the request `id`, and a `result` object containing the tool output.
2. WHEN an MCP_Client sends a request that causes an error, THE MCP_Protocol_Layer SHALL return a response containing `jsonrpc` set to `"2.0"`, an `id` matching the request `id` (or `null` if the request `id` could not be determined), and an `error` object with integer `code` and string `message` fields.
3. THE MCP_Protocol_Layer SHALL NOT include keys `protocol`, `version`, `tool`, `success`, `data`, or `timestamp` at the top level of any response.
4. WHEN an MCP_Client sends a request with a missing or non-string/non-number `id`, THE MCP_Protocol_Layer SHALL return an error response with `id` set to `null`.

### Requirement 2: JSON-RPC 2.0 Request Parsing

**User Story:** As an MCP_Client developer, I want the MCP_Server to accept JSON-RPC 2.0 formatted requests, so that standard MCP clients can communicate with the server.

#### Acceptance Criteria

1. WHEN an MCP_Client sends a POST request with a JSON body containing `jsonrpc: "2.0"`, a `method` string, an `id`, and optional `params` object, THE JSON_RPC_Router SHALL extract the `method` field and dispatch to the corresponding controller.
2. WHEN an MCP_Client sends a request with `method` set to `"initialize"`, THE MCP_Server SHALL respond with server capabilities including `serverInfo` (name, version), `capabilities` (tools listing), and `protocolVersion`.
3. WHEN an MCP_Client sends a request with `method` set to `"tools/list"`, THE MCP_Server SHALL respond with the list of available tools in the `result` field.
4. WHEN an MCP_Client sends a request with `method` set to `"tools/call"` and `params` containing `name` and `arguments`, THE JSON_RPC_Router SHALL dispatch to the controller matching the tool `name`.
5. WHEN an MCP_Client sends a request with an unrecognized `method`, THE MCP_Server SHALL return a JSON-RPC 2.0 error with code `-32601` (Method not found).
6. WHEN an MCP_Client sends a request with invalid JSON, THE MCP_Server SHALL return a JSON-RPC 2.0 error with code `-32700` (Parse error).
7. WHEN an MCP_Client sends a request missing required JSON-RPC 2.0 fields (`jsonrpc`, `method`), THE MCP_Server SHALL return a JSON-RPC 2.0 error with code `-32600` (Invalid Request).

### Requirement 3: Single MCP Endpoint

**User Story:** As an MCP_Client developer, I want a single endpoint at `/{api_base}/mcp/v1` that handles all MCP operations, so that the server conforms to the Streamable HTTP transport specification.

#### Acceptance Criteria

1. THE SAM_Template SHALL define an API Gateway endpoint at path `/mcp/v1` accepting POST requests routed to the ReadLambdaFunction.
2. WHEN an MCP_Client sends a POST request to `/{api_base}/mcp/v1`, THE JSON_RPC_Router SHALL parse the JSON-RPC 2.0 `method` field and dispatch to the appropriate controller.
3. THE SAM_Template SHALL retain the existing per-tool endpoints (`/mcp/list_tools`, `/mcp/get_template`, etc.) for backward compatibility during the transition period.
4. WHEN an MCP_Client sends a GET request to `/{api_base}/mcp/v1`, THE MCP_Server SHALL return a 200 OK response with the list of available tools.
5. THE OpenAPI_Spec SHALL include the `/mcp/v1` path definition with POST and GET methods and the correct `x-amazon-apigateway-integration` referencing the ReadLambdaFunction.

### Requirement 4: Correct Content-Type Headers

**User Story:** As an MCP_Client developer, I want the MCP_Server to return the correct `Content-Type` header, so that MCP clients do not reject the response as unexpected content.

#### Acceptance Criteria

1. THE MCP_Server SHALL return `Content-Type: application/json` on all JSON-RPC 2.0 responses from the `/mcp/v1` endpoint.
2. IF the MCP_Server encounters a request to `/mcp/v1` that results in an error, THEN THE MCP_Server SHALL return the error as a JSON-RPC 2.0 error response with `Content-Type: application/json` (not `text/html`).

### Requirement 5: User Documentation for MCP Client Installation

**User Story:** As a developer, I want accurate installation instructions for connecting MCP clients to the Atlantis MCP Server, so that I can configure my AI assistant without trial and error.

#### Acceptance Criteria

1. THE Integration_Docs for Kiro SHALL specify the MCP server configuration using the `url` field set to `https://mcp.atlantis.63klabs.net/mcp/v1` in the `mcp.json` format.
2. THE Integration_Docs for Kiro SHALL provide a working `mcp.json` example using the Streamable HTTP transport format (with `url` key, not `command`/`args`).
3. THE Integration_Docs for Claude Desktop SHALL specify the production URL as `https://mcp.atlantis.63klabs.net/mcp/v1`.
4. THE Integration_Docs for Cursor SHALL specify the production URL as `https://mcp.atlantis.63klabs.net/mcp/v1`.
5. THE Integration_Docs for Amazon Q SHALL specify the production URL as `https://mcp.atlantis.63klabs.net/mcp/v1`.
6. THE Integration_Docs for ChatGPT SHALL specify the production URL as `https://mcp.atlantis.63klabs.net/mcp/v1`.
7. WHEN a self-hosted instance is described, THE Integration_Docs SHALL instruct users to use the URL pattern `https://{api-gateway-url}/{api_base}/mcp/v1`.

### Requirement 6: OpenAPI Specification Accuracy

**User Story:** As a platform maintainer, I want the OpenAPI specification to accurately reflect the deployed API structure, so that API Gateway is configured correctly and generated documentation is accurate.

#### Acceptance Criteria

1. THE OpenAPI_Spec SHALL define the `/mcp/v1` endpoint with POST and GET methods.
2. THE OpenAPI_Spec SHALL use the JSON-RPC 2.0 `MCPRequest` schema (with `jsonrpc`, `method`, `id`, `params` fields) for the request body of the `/mcp/v1` POST endpoint.
3. THE OpenAPI_Spec SHALL use the JSON-RPC 2.0 `MCPResponse` schema (with `jsonrpc`, `result`, `id` fields) for the 200 response of the `/mcp/v1` POST endpoint.
4. THE OpenAPI_Spec SHALL use the JSON-RPC 2.0 `MCPError` schema (with `jsonrpc`, `error`, `id` fields) for error responses.
5. THE OpenAPI_Spec SHALL retain existing per-tool path definitions for backward compatibility.

### Requirement 7: SAM Template Endpoint Configuration

**User Story:** As a platform maintainer, I want the SAM template to define the `/mcp/v1` endpoint correctly, so that API Gateway routes MCP traffic to the Lambda function.

#### Acceptance Criteria

1. THE SAM_Template SHALL define API Gateway events on the ReadLambdaFunction for `POST /mcp/v1` and `GET /mcp/v1`.
2. THE SAM_Template SHALL retain existing per-tool API Gateway events for backward compatibility.
3. THE SAM_Template SHALL configure CORS headers for the `/mcp/v1` endpoint allowing `GET, POST, OPTIONS` methods.

### Requirement 8: Backward-Compatible Routing

**User Story:** As a developer using the existing per-tool endpoints, I want the existing endpoints to continue working, so that my integrations are not broken by the new unified endpoint.

#### Acceptance Criteria

1. WHEN an MCP_Client sends a POST request to an existing per-tool endpoint (e.g., `/mcp/list_tools`), THE JSON_RPC_Router SHALL continue to process the request using the existing request format (`tool` and `input` fields in the body).
2. WHEN an MCP_Client sends a POST request to `/mcp/v1` with a JSON-RPC 2.0 formatted body, THE JSON_RPC_Router SHALL process the request using the JSON-RPC 2.0 format.
3. THE JSON_RPC_Router SHALL distinguish between legacy per-tool requests and JSON-RPC 2.0 requests by checking for the presence of the `jsonrpc` field in the request body.

### Requirement 9: Test Coverage for MCP Protocol Compliance

**User Story:** As a platform maintainer, I want tests that verify JSON-RPC 2.0 compliance, so that protocol regressions are caught before deployment.

#### Acceptance Criteria

1. THE MCP_Server test suite SHALL include tests verifying that responses to the `/mcp/v1` endpoint contain `jsonrpc: "2.0"`, a matching `id`, and either a `result` or `error` field.
2. THE MCP_Server test suite SHALL include tests verifying that `initialize`, `tools/list`, and `tools/call` methods produce correct JSON-RPC 2.0 responses.
3. THE MCP_Server test suite SHALL include tests verifying that invalid JSON-RPC 2.0 requests return appropriate error codes (`-32700`, `-32600`, `-32601`).
4. THE MCP_Server test suite SHALL include a round-trip test: sending a JSON-RPC 2.0 `tools/list` request and verifying the response can be parsed as a valid JSON-RPC 2.0 response containing tool definitions.
