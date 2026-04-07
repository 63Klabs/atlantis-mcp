# Implementation Plan: Use ClientRequest and Response Classes

## Overview

Refactor the Read Lambda handler (`index.js`) and routes module (`routes/index.js`) to use `ClientRequest` and `Response` classes from `@63klabs/cache-data`. The handler will create a `ClientRequest` from the event/context, create a `Response` linked to it, pass both to routes, and call `response.finalize()` once at the end. Routes will use `clientRequest.getProps()` for path/method extraction and populate the shared `Response` instance instead of returning wrapper objects.

## Tasks

- [x] 1. Refactor Handler to use ClientRequest and Response
  - [x] 1.1 Update imports and create ClientRequest/Response instances in handler
    - In `application-infrastructure/src/lambda/read/index.js`, add `ClientRequest` to the destructured import from `@63klabs/cache-data`
    - Declare `clientRequest` and `response` in the outer scope (before try block) so the catch block can access them
    - After cold-start init (`Config.promise()` / `Config.prime()`), create `clientRequest = new ClientRequest(event, context)` and `response = new Response(clientRequest)`
    - _Requirements: 1.1, 1.2, 2.1_

  - [x] 1.2 Refactor rate-limit and MCP header addition
    - After rate-limit check, iterate `rateLimitCheck.headers` and call `response.addHeader(name, value)` for each
    - Add `response.addHeader('X-MCP-Version', '1.0')` before routing
    - Remove the manual header merge block (`apiGatewayResponse.headers = { ...apiGatewayResponse.headers, ...rateLimitCheck.headers, 'X-MCP-Version': '1.0', ... }`)
    - _Requirements: 3.1, 3.2_

  - [x] 1.3 Update Routes.process call and response finalization
    - Change `Routes.process(event, context)` to `await Routes.process(clientRequest, response, event, context)`
    - Remove the `const response = await Routes.process(...)` inner-scope variable (routes is now void)
    - Replace `const apiGatewayResponse = response.finalize()` and its header merge with a single `return response.finalize()`
    - Remove `console.log("SETTINGS", Config.settings())` debug line
    - _Requirements: 2.2, 2.3, 2.4, 4.1_

  - [x] 1.4 Refactor catch block to reuse ClientRequest-linked Response
    - If `response` already exists (created before the error), call `response.setStatusCode(500)` instead of creating a new `Response`
    - If `response` is null, fall back to `response = new Response({ statusCode: 500 })`
    - Add `X-Request-Id` and `X-MCP-Version` headers via `response.addHeader()`
    - Remove manual CORS and `Content-Type` header additions from catch block (handled by `Response.finalize()`)
    - Set error body and call `return response.finalize()`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 1.5 Remove commented-out metric and logging code
    - Delete the commented-out `ErrorHandler.logRequest()`, `ErrorHandler.emitLatencyMetric()`, `ErrorHandler.emitErrorMetric()` blocks in both the try and catch sections
    - Delete the associated TODO comment
    - _Requirements: 8.1, 8.2_

- [x] 2. Refactor Routes to accept ClientRequest and Response
  - [x] 2.1 Update Routes.process signature and use clientRequest.getProps()
    - In `application-infrastructure/src/lambda/read/routes/index.js`, change `process(event, context)` to `process(clientRequest, response, event, context)`
    - Replace `event.path || event.requestContext?.resourcePath` with `clientRequest.getProps().path`
    - Replace `event.httpMethod` with `clientRequest.getProps().method`
    - Remove manual `rawPath` and `httpMethod` extraction
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.2 Populate Response instead of returning wrapper objects
    - For the `/mcp/v1` POST path: call `response.setStatusCode(jsonRpcResponse.statusCode)`, `response.setBody(JSON.parse(jsonRpcResponse.body))`, and forward non-CORS/non-Content-Type headers via `response.addHeader()`
    - For the error path: call `response.setStatusCode(400)` and `response.setBody(errorBody)` instead of using `JsonRpcRouter.buildResponse()`
    - Remove all `return { finalize: () => ... }` wrapper patterns
    - Make the function return void (no return value)
    - Continue passing raw `event` and `context` to `JsonRpcRouter.handleJsonRpc(event, context)`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.1_

- [x] 3. Checkpoint - Verify handler and routes refactoring
  - Ensure the handler and routes modules are syntactically correct and consistent with the design
  - Ensure all tests pass, ask the user if questions arise

- [x] 4. Update unit tests for new signatures
  - [x] 4.1 Update handler tests for ClientRequest and Response
    - In `application-infrastructure/src/lambda/read/tests/unit/lambda/read-handler.test.js`:
    - Add `ClientRequest` mock to the `@63klabs/cache-data` mock (constructor that stores event/context)
    - Update `Routes.process` mock to expect new signature `(clientRequest, response, event, context)`
    - Verify `ClientRequest` is constructed with `(event, context)`
    - Verify `Response` is constructed with the `ClientRequest` instance
    - Verify `response.addHeader()` is called for each rate-limit header and `X-MCP-Version`
    - Verify `response.finalize()` is called and its return value is the handler's return value
    - Verify catch block reuses existing `response` when available (calls `setStatusCode(500)`)
    - Verify catch block creates standalone `Response({statusCode: 500})` when `response` is null
    - Verify no manual CORS headers are added in happy path or catch block
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 4.2 Update routes tests for new signature and void return
    - In `application-infrastructure/src/lambda/read/tests/unit/routes/routes-mcp-v1.test.js`:
    - Create mock `clientRequest` with `getProps()` returning `{ path, method }`
    - Create mock `response` with `setStatusCode()`, `setBody()`, `addHeader()` methods
    - Update all `Routes.process(event, context)` calls to `Routes.process(clientRequest, response, event, context)`
    - Verify `handleJsonRpc` still receives raw `(event, context)`
    - Verify `response.setStatusCode()` and `response.setBody()` are called with JSON-RPC Router results
    - Verify `Routes.process` returns `undefined` (void)
    - Verify error path sets statusCode 400 and error body on response
    - Remove assertions on `result.finalize` (no longer returned)
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 5. Checkpoint - Ensure all unit tests pass
  - Ensure all tests pass, ask the user if questions arise

- [x] 6. Property-based tests for correctness properties
  - [x] 6.1 Write property test: JSON-RPC Router result transfer (Property 1)
    - Create `application-infrastructure/src/lambda/read/tests/property/client-request-response.property.test.js`
    - Use `fast-check` to generate random `{ statusCode, headers, body }` objects from the JSON-RPC Router
    - Mock `clientRequest.getProps()` to return a valid `/mcp/v1` POST path
    - Call `Routes.process(clientRequest, response, event, context)` with mocked JSON-RPC Router
    - Verify `response.setStatusCode()` called with generated statusCode
    - Verify `response.setBody()` called with parsed body
    - Verify non-CORS headers forwarded via `response.addHeader()`
    - Minimum 100 iterations
    - **Property 1: JSON-RPC Router result transfer preserves statusCode, body, and headers**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 6.2 Write property test: Error responses always have statusCode 500 (Property 2)
    - In the same test file or a new one in `tests/property/`
    - Use `fast-check` to generate random error messages and request IDs
    - Trigger errors at various points in the handler (Config failure, Routes failure)
    - Verify finalized response has statusCode 500
    - Verify body contains `message` and `requestId` fields
    - Minimum 100 iterations
    - **Property 2: Error responses always have statusCode 500 with message and requestId**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 6.3 Write property test: Final response includes all custom headers (Property 3)
    - Use `fast-check` to generate random rate-limit header values (valid numeric strings)
    - Run handler with mocked dependencies returning `allowed: true` with generated headers
    - Verify finalized response contains all rate-limit headers and `X-MCP-Version: '1.0'`
    - Minimum 100 iterations
    - **Property 3: Final response includes all custom headers (rate-limit and MCP)**
    - **Validates: Requirements 3.1, 3.2, 9.1**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The JSON-RPC Router and Rate Limiter modules are unchanged by this refactoring
- Raw `event` and `context` are still passed through to downstream modules that need them
