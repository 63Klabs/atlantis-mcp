# Implementation Plan: Get Integration Working

## Overview

Convert the Atlantis MCP Server to full JSON-RPC 2.0 compliance at a single `/mcp/v1` endpoint, while maintaining backward compatibility with existing per-tool endpoints. Implementation proceeds bottom-up: protocol layer first, then router, then routing integration, then infrastructure, then documentation.

All source code is under `application-infrastructure/src/lambda/read/`. Tests are at `application-infrastructure/src/lambda/read/tests/`.

## Tasks

- [x] 1. Refactor MCP Protocol Layer for JSON-RPC 2.0
  - [x] 1.1 Add JSON-RPC 2.0 response formatters to `utils/mcp-protocol.js`
    - Add `JSON_RPC_ERRORS` constant with standard error codes (`-32700`, `-32600`, `-32601`, `-32602`, `-32603`)
    - Add `jsonRpcSuccess(id, result)` function returning `{ jsonrpc: "2.0", id, result }`
    - Add `jsonRpcError(id, code, message, data?)` function returning `{ jsonrpc: "2.0", id, error: { code, message, data? } }`
    - Add `initializeResponse(id)` returning JSON-RPC 2.0 response with `serverInfo`, `capabilities`, `protocolVersion`
    - Add `toolsListResponse(id, tools)` returning JSON-RPC 2.0 response with tools array in `result`
    - Keep existing `successResponse`/`errorResponse` for backward compatibility with legacy endpoints
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3_

  - [x] 1.2 Write property test for JSON-RPC 2.0 Response Envelope (Property 1)
    - **Property 1: JSON-RPC 2.0 Response Envelope**
    - Generate random `id` values (strings, numbers, null, objects, arrays, booleans) and verify response always contains `jsonrpc: "2.0"` with correct `id` handling and either `result` or `error`
    - Test file: `tests/property/json-rpc-envelope.property.test.js`
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [x] 1.3 Write property test for No Legacy Keys (Property 2)
    - **Property 2: No Legacy Keys in JSON-RPC Responses**
    - Generate random inputs to `jsonRpcSuccess` and `jsonRpcError`, assert output never contains `protocol`, `version`, `tool`, `success`, `data`, `timestamp` at top level
    - Test file: `tests/property/no-legacy-keys.property.test.js`
    - **Validates: Requirements 1.3**

- [x] 2. Implement JSON-RPC Router
  - [x] 2.1 Create `utils/json-rpc-router.js` with `handleJsonRpc(event, context)`
    - Parse and validate JSON body (return `-32700` on failure)
    - Validate required fields `jsonrpc`, `method` (return `-32600` if missing)
    - Extract `id` from request (use `null` if missing or invalid type)
    - Dispatch `initialize` → return server capabilities via `initializeResponse`
    - Dispatch `tools/list` → return tool list via `toolsListResponse`
    - Dispatch `tools/call` → extract `params.name` and `params.arguments`, dispatch to existing controllers
    - Return `-32601` for unrecognized methods
    - Return `-32602` for `tools/call` with missing `params.name`
    - Wrap all responses using `mcp-protocol.js` JSON-RPC 2.0 formatters
    - Set `Content-Type: application/json` on all responses
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2_

  - [x] 2.2 Write unit tests for JSON-RPC Router
    - Test file: `tests/unit/utils/json-rpc-router.test.js`
    - Test `initialize` returns correct `serverInfo`, `capabilities`, `protocolVersion`
    - Test `tools/list` returns all defined tools
    - Test `tools/call` dispatches to correct controller
    - Test empty body returns Parse error (`-32700`)
    - Test `jsonrpc: "1.0"` returns Invalid Request (`-32600`)
    - Test `tools/call` with missing `params.name` returns Invalid params (`-32602`)
    - Test unrecognized method returns Method not found (`-32601`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.3 Write property test for Correct Method Dispatch (Property 3)
    - **Property 3: Correct Method Dispatch**
    - Generate random tool names from the known set, random arguments, mock controllers, verify correct controller called
    - Test file: `tests/property/method-dispatch.property.test.js`
    - **Validates: Requirements 2.1, 2.4, 3.2, 8.2**

  - [x] 2.4 Write property test for Standard Error Codes (Property 4)
    - **Property 4: Standard Error Codes for Invalid Requests**
    - Generate three categories: non-JSON strings (→ `-32700`), valid JSON missing fields (→ `-32600`), valid JSON-RPC with unknown methods (→ `-32601`)
    - Test file: `tests/property/error-codes.property.test.js`
    - **Validates: Requirements 2.5, 2.6, 2.7**

- [x] 3. Integrate JSON-RPC Router into Routes and Lambda Handler
  - [x] 3.1 Modify `routes/index.js` to detect `/mcp/v1` path and delegate to JSON-RPC Router
    - If path ends with `/mcp/v1`: delegate POST to `JsonRpcRouter.handleJsonRpc(event, context)`
    - If path ends with `/mcp/v1` and method is GET: return `tools/list` response (200 OK with tool definitions)
    - Existing per-tool routing remains unchanged for backward compatibility
    - _Requirements: 3.1, 3.2, 3.4, 8.1, 8.2, 8.3_

  - [x] 3.2 Verify Lambda handler (`index.js`) sets `Content-Type: application/json` on all responses
    - Ensure `Content-Type` is not overridden to `text/html` by the Response framework
    - Verify CORS headers and `X-MCP-Version` header are present on `/mcp/v1` responses
    - _Requirements: 4.1, 4.2_

  - [x] 3.3 Write unit tests for `/mcp/v1` routing
    - Test file: `tests/unit/routes/routes-mcp-v1.test.js`
    - Test POST to `/mcp/v1` delegates to JSON-RPC Router
    - Test GET to `/mcp/v1` returns 200 with tool list
    - Test existing per-tool endpoints still work (backward compatibility)
    - Test legacy requests (no `jsonrpc` field) use legacy routing
    - _Requirements: 3.2, 3.4, 8.1, 8.3_

  - [x] 3.4 Write property test for Content-Type Header (Property 5)
    - **Property 5: Content-Type Header on All Responses**
    - Generate random valid and invalid requests to `/mcp/v1`, assert `Content-Type: application/json` on all responses
    - Test file: `tests/property/content-type.property.test.js`
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.5 Write property test for Legacy Format Backward Compatibility (Property 6)
    - **Property 6: Legacy Format Backward Compatibility**
    - Generate random legacy-format requests (with `tool` and `input`, without `jsonrpc`), assert they are processed using legacy routing
    - Test file: `tests/property/legacy-compat.property.test.js`
    - **Validates: Requirements 8.1, 8.3**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update SAM Template and OpenAPI Spec
  - [x] 5.1 Add `/mcp/v1` API Gateway events to SAM template (`application-infrastructure/template.yml`)
    - Add `McpV1Post` event (POST `/mcp/v1`) to `ReadLambdaFunction`
    - Add `McpV1Get` event (GET `/mcp/v1`) to `ReadLambdaFunction`
    - Retain existing per-tool API Gateway events for backward compatibility
    - Ensure CORS headers configured for `/mcp/v1` allowing `GET, POST, OPTIONS`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.2 Add `/mcp/v1` path to OpenAPI spec (`application-infrastructure/template-openapi-spec.yml`)
    - Add `/mcp/v1` path with POST and GET methods
    - Define `MCPRequest` schema (with `jsonrpc`, `method`, `id`, `params` fields) for POST request body
    - Define `MCPResponse` schema (with `jsonrpc`, `result`, `id` fields) for 200 response
    - Define `MCPError` schema (with `jsonrpc`, `error`, `id` fields) for error responses
    - Add correct `x-amazon-apigateway-integration` referencing `ReadLambdaFunction`
    - Retain existing per-tool path definitions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 6. Update Integration Documentation
  - [x] 6.1 Update all client integration guides in `docs/integration/`
    - Update `docs/integration/kiro.md`: set URL to `https://mcp.atlantis.63klabs.net/mcp/v1`, provide working `mcp.json` example using Streamable HTTP transport (with `url` key, not `command`/`args`)
    - Update `docs/integration/claude.md`: set production URL to `https://mcp.atlantis.63klabs.net/mcp/v1`
    - Update `docs/integration/cursor.md`: set production URL to `https://mcp.atlantis.63klabs.net/mcp/v1`
    - Update `docs/integration/amazon-q.md`: set production URL to `https://mcp.atlantis.63klabs.net/mcp/v1`
    - Update `docs/integration/chatgpt.md`: set production URL to `https://mcp.atlantis.63klabs.net/mcp/v1`
    - Include self-hosted URL pattern: `https://{api-gateway-url}/{api_base}/mcp/v1`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 7. Integration Tests and Round-Trip Validation
  - [x] 7.1 Write unit tests for JSON-RPC formatters in `mcp-protocol.js`
    - Test file: `tests/unit/utils/mcp-protocol-jsonrpc.test.js`
    - Test `jsonRpcSuccess` produces correct envelope
    - Test `jsonRpcError` produces correct error envelope
    - Test `initializeResponse` structure
    - Test `toolsListResponse` structure
    - _Requirements: 9.1, 9.2_

  - [x] 7.2 Update integration test for MCP protocol compliance
    - Test file: `tests/integration/mcp-protocol-compliance.test.js`
    - Un-skip or add tests verifying `initialize`, `tools/list`, and `tools/call` produce correct JSON-RPC 2.0 responses
    - Verify invalid requests return appropriate error codes (`-32700`, `-32600`, `-32601`)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.3 Write property test for JSON-RPC 2.0 Round-Trip (Property 7)
    - **Property 7: JSON-RPC 2.0 Round-Trip**
    - Generate random valid `id` values, construct `tools/list` requests, send through handler, parse response, verify valid JSON-RPC 2.0 with `tools` array where each element has `name`, `description`, and `inputSchema`
    - Test file: `tests/property/jsonrpc-roundtrip.property.test.js`
    - **Validates: Requirements 9.4**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (already in devDependencies) with Jest
- All new test files use `.test.js` extension per project Jest config (`**/lambda/read/tests/**/*.test.js`)
- Existing `successResponse`/`errorResponse` in `mcp-protocol.js` are kept for legacy endpoint backward compatibility
- Checkpoints ensure incremental validation
