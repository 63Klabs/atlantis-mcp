# Requirements Document

## Introduction

The Read Lambda handler and routes module currently use a manual, "roll your own" approach to extract request properties (`rawPath`, `httpMethod`, `requestId`) from the raw API Gateway event and to construct response objects. The `@63klabs/cache-data` package already provides `ClientRequest` and `Response` classes purpose-built for this work. `AppConfig.init()` already initializes both classes during cold start via the existing config module, but neither is used in the handler or routes.

This feature refactors the handler (`index.js`) and routes (`routes/index.js`) to create a `ClientRequest` instance from the incoming event/context, pass it to a `Response` instance, route using `clientRequest.getProps()`, and return `response.finalize()` — replacing manual property extraction, manual header management, and the ad-hoc `{ finalize: () => plainObject }` wrapper pattern.

## Glossary

- **Handler**: The Lambda entry-point function exported from `application-infrastructure/src/lambda/read/index.js` that receives API Gateway events and returns HTTP responses.
- **Routes_Module**: The routing module at `application-infrastructure/src/lambda/read/routes/index.js` that matches the request path and HTTP method to the appropriate controller.
- **ClientRequest**: A class from `@63klabs/cache-data` (`tools.ClientRequest`) that parses and validates an incoming Lambda event and context, exposing properties via `getProps()`.
- **Response**: A class from `@63klabs/cache-data` (`tools.Response`) that, when constructed with a `ClientRequest` instance, formats the HTTP response and automatically handles CORS headers, cache-control headers, execution-time headers, and request/response logging on `finalize()`.
- **JSON_RPC_Router**: The utility module at `application-infrastructure/src/lambda/read/utils/json-rpc-router.js` that processes JSON-RPC 2.0 requests and returns plain response objects (`{ statusCode, headers, body }`).
- **Rate_Limiter**: The utility module at `application-infrastructure/src/lambda/read/utils/rate-limiter.js` that checks per-IP request limits and returns rate-limit headers.
- **AppConfig**: The configuration class from `@63klabs/cache-data` that initializes `ClientRequest` validations, `Response` settings, connections, and application settings during cold start.
- **Props**: The object returned by `clientRequest.getProps()` containing `method`, `path`, `pathArray`, and other parsed request properties.

## Requirements

### Requirement 1: Create ClientRequest in Handler

**User Story:** As a maintainer, I want the Handler to instantiate a ClientRequest from the event and context, so that request parsing and validation are handled by the framework instead of manual extraction.

#### Acceptance Criteria

1. WHEN an API Gateway event is received, THE Handler SHALL import `ClientRequest` from `@63klabs/cache-data` and create a new `ClientRequest` instance by passing the event and context to the constructor.
2. THE Handler SHALL create the `ClientRequest` instance after cold-start initialization completes (after `Config.promise()` and `Config.prime()`) and before rate-limit checking.
3. THE Handler SHALL remove manual extraction of `requestId` from `event.requestContext?.requestId`, using `ClientRequest` or `context.awsRequestId` as the source instead.

### Requirement 2: Create Response from ClientRequest in Handler

**User Story:** As a maintainer, I want the Handler to instantiate a Response linked to the ClientRequest, so that response formatting, CORS, cache-control, execution-time headers, and request logging are handled automatically by the framework.

#### Acceptance Criteria

1. WHEN a `ClientRequest` instance has been created, THE Handler SHALL create a new `Response` instance by passing the `ClientRequest` instance to the `Response` constructor.
2. THE Handler SHALL pass both the `ClientRequest` instance and the `Response` instance to the Routes_Module for request processing.
3. THE Handler SHALL call `response.finalize()` to produce the final API Gateway response object, replacing the current pattern of calling `finalize()` on the object returned by Routes_Module.
4. THE Handler SHALL remove manual addition of CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`) since `Response.finalize()` handles CORS automatically based on referrer validation.

### Requirement 3: Add Rate-Limit and MCP Headers to Response

**User Story:** As a maintainer, I want rate-limit headers and the MCP version header to be added to the Response before finalization, so that these custom headers are included in the finalized output alongside the framework-managed headers.

#### Acceptance Criteria

1. WHEN the Rate_Limiter returns rate-limit headers, THE Handler SHALL add each rate-limit header to the `Response` instance using `response.addHeader()` before calling `response.finalize()`.
2. THE Handler SHALL add the `X-MCP-Version` header to the `Response` instance using `response.addHeader()` before calling `response.finalize()`.
3. WHEN the Rate_Limiter indicates the request is not allowed, THE Handler SHALL still return the rate-limit response using the existing `RateLimiter.createRateLimitResponse()` method without requiring a `Response` instance.

### Requirement 4: Refactor Routes to Accept ClientRequest and Response

**User Story:** As a maintainer, I want the Routes_Module to accept a ClientRequest and Response instead of the raw event and context, so that routing uses framework-parsed properties and the response is built through the Response class.

#### Acceptance Criteria

1. THE Routes_Module `process` function SHALL accept a `ClientRequest` instance and a `Response` instance as parameters instead of the raw `event` and `context` objects.
2. THE Routes_Module SHALL obtain the request path from `clientRequest.getProps().path` or `clientRequest.getProps().pathArray` instead of manually extracting it from `event.path` or `event.requestContext?.resourcePath`.
3. THE Routes_Module SHALL obtain the HTTP method from `clientRequest.getProps().method` instead of manually extracting it from `event.httpMethod`.
4. THE Routes_Module SHALL remove all manual extraction of `rawPath` and `httpMethod` from the event object.

### Requirement 5: Routes Set Response Body and Status from Router Results

**User Story:** As a maintainer, I want the Routes_Module to populate the Response instance with the result from the JSON_RPC_Router, so that the response flows through the framework's finalize pipeline instead of wrapping plain objects.

#### Acceptance Criteria

1. WHEN the JSON_RPC_Router returns a plain response object, THE Routes_Module SHALL set the response status code on the `Response` instance using `response.setStatusCode()`.
2. WHEN the JSON_RPC_Router returns a plain response object, THE Routes_Module SHALL set the response body on the `Response` instance using `response.setBody()`.
3. WHEN the JSON_RPC_Router returns response headers, THE Routes_Module SHALL add relevant headers to the `Response` instance using `response.addHeader()`.
4. THE Routes_Module SHALL stop returning `{ finalize: () => plainObject }` wrapper objects and instead populate the shared `Response` instance directly.

### Requirement 6: Error Response Uses ClientRequest-Linked Response

**User Story:** As a maintainer, I want the Handler's catch block to use a ClientRequest-linked Response when available, so that error responses benefit from automatic request logging and consistent header management.

#### Acceptance Criteria

1. WHEN an error occurs after the `ClientRequest` and `Response` have been created, THE Handler SHALL use the existing `Response` instance to build the error response.
2. WHEN an error occurs before the `ClientRequest` could be created, THE Handler SHALL create a standalone `Response` instance (without a `ClientRequest`) for the error response, preserving current fallback behavior.
3. THE Handler SHALL set the status code to 500, set an error body with a message and request ID, and call `response.finalize()` for error responses.
4. THE Handler SHALL remove manual addition of CORS and Content-Type headers in the catch block since `Response.finalize()` handles these automatically.

### Requirement 7: Pass Event and Context Through for Downstream Use

**User Story:** As a maintainer, I want the raw event and context to remain accessible to downstream modules that still need them (such as the JSON_RPC_Router), so that the refactoring does not break existing functionality.

#### Acceptance Criteria

1. THE Routes_Module SHALL continue to pass the raw `event` and `context` to the JSON_RPC_Router's `handleJsonRpc()` function, since the JSON_RPC_Router parses the event body independently.
2. IF the JSON_RPC_Router requires the raw event, THE Routes_Module SHALL retrieve it from `clientRequest.getProps()` or pass it as an additional parameter alongside the `ClientRequest`.

### Requirement 8: Remove Commented-Out Metric and Logging Code

**User Story:** As a maintainer, I want the commented-out metric and logging code in the Handler to be removed, so that the codebase is clean and the TODO is resolved now that Response handles request logging.

#### Acceptance Criteria

1. WHEN the `Response` class is linked to a `ClientRequest`, THE Handler SHALL rely on `Response.finalize()` for request and response logging instead of manual logging code.
2. THE Handler SHALL remove the commented-out `ErrorHandler.logRequest()`, `ErrorHandler.emitLatencyMetric()`, and `ErrorHandler.emitErrorMetric()` code blocks and the associated TODO comment.

### Requirement 9: Existing Tests Continue to Pass

**User Story:** As a maintainer, I want all existing tests to continue passing after the refactoring, so that the change does not introduce regressions.

#### Acceptance Criteria

1. WHEN the refactoring is complete, THE Handler and Routes_Module SHALL produce functionally equivalent HTTP responses (same status codes, same response bodies, same custom headers) as the current implementation.
2. IF existing tests mock `Routes.process(event, context)`, THEN those tests SHALL be updated to match the new function signature `Routes.process(clientRequest, response)`.
3. THE refactored code SHALL pass all existing unit and property-based tests after test updates for the new signatures.
