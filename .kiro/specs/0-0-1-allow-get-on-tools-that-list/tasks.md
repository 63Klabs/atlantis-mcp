# Implementation Plan: Allow GET on Tools That List

## Overview

Add HTTP GET method support to MCP tool endpoints that have no required parameters. The implementation derives GET eligibility from the existing `availableToolsList` in settings, adds GET method enforcement in the router with query string parameter mapping, updates the SAM template and OpenAPI spec, and includes comprehensive unit and property-based tests. Controllers require no changes.

## Tasks

- [x] 1. Add `getGetEligibleTools()` method to settings
  - [x] 1.1 Implement `getGetEligibleTools()` on `settings.tools`
    - Add a method to `config/settings.js` that filters `availableToolsList` for tools whose `inputSchema` has no `required` array (or an empty one) and returns their names
    - Include JSDoc documentation with `@returns` and `@example` tags
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1_

  - [x] 1.2 Write unit tests for `getGetEligibleTools()`
    - Create `tests/unit/config/settings-get-eligible.test.js`
    - Verify returned array contains `list_tools`, `list_templates`, `list_categories`, `list_starters`
    - Verify returned array excludes `get_template`, `list_template_versions`, `get_starter_info`, `search_documentation`, `validate_naming`, `check_template_updates`
    - Test edge case: returns empty array when all tools have required parameters (mock settings)
    - _Requirements: 1.4, 1.5, 7.1_

  - [x] 1.3 Write property test for GET eligibility derivation
    - Create `tests/unit/config/settings-get-eligible.property.test.js`
    - **Property 1: GET eligibility is determined by absence of required parameters**
    - Generate random tool definitions with and without `required` arrays; verify `getGetEligibleTools()` returns exactly those without `required`
    - **Validates: Requirements 1.2, 1.3**

- [x] 2. Checkpoint - Verify settings changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add GET method enforcement and query string mapping to router
  - [x] 3.1 Implement GET eligibility check in router
    - In `routes/index.js`, after extracting the tool name and before the switch statement, check if `props.method === 'GET'`
    - Call `settings.tools.getGetEligibleTools()` and return 405 Method Not Allowed if the tool is not in the GET-eligible list
    - Include the list of GET-eligible tools and allowed methods in the error response details
    - Update JSDoc to reflect GET method handling
    - _Requirements: 4.1, 4.3, 6.2_

  - [x] 3.2 Implement query string parameter mapping for GET requests
    - In `routes/index.js`, before routing to the controller, map `props.queryStringParameters` into `props.bodyParameters.input` for GET requests
    - This ensures controllers receive the same input structure regardless of HTTP method
    - _Requirements: 4.2_

  - [x] 3.3 Write unit tests for GET method handling
    - Create `tests/unit/lambda/get-method-support.test.js`
    - Test GET request to `list_tools` returns 200
    - Test GET request to `list_templates?category=storage` passes `category` to controller
    - Test GET request to `get_template` returns 405 with descriptive error
    - Test GET request to `search_documentation` returns 405
    - Test GET request to unknown tool returns 404 (not 405)
    - Test POST request to `list_tools` still works after GET support added
    - Test POST request to `get_template` still works after GET support added
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.2, 7.3, 7.4, 7.5_

  - [x] 3.4 Write property test for query string mapping
    - Create `tests/unit/lambda/get-query-string-mapping.property.test.js`
    - **Property 2: Query string parameters are mapped to controller input**
    - Generate random key-value pairs as query string parameters; verify they appear in `props.bodyParameters.input`
    - **Validates: Requirements 4.2**

  - [x] 3.5 Write property test for 405 on non-GET-eligible tools
    - Create `tests/unit/lambda/get-method-405.property.test.js`
    - **Property 3: GET to non-GET-eligible tools returns 405**
    - For each tool with a non-empty `required` array, send a GET request and verify 405 response
    - **Validates: Requirements 4.3**

  - [x] 3.6 Write property test for POST still works
    - Create `tests/unit/lambda/post-still-works.property.test.js`
    - **Property 4: POST continues to work for all tools**
    - For each tool in `availableToolsList`, send a POST request and verify it is accepted (not 405)
    - **Validates: Requirements 4.4**

- [x] 4. Checkpoint - Verify router changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add response parity tests
  - [x] 5.1 Write unit tests for GET/POST response parity
    - Create `tests/unit/lambda/get-post-parity.test.js`
    - Test GET and POST to `list_tools` return same response body structure
    - Test GET and POST to `list_templates` return same response body structure
    - Test error responses from GET have same format as POST errors
    - Test CORS headers are identical for GET and POST responses
    - _Requirements: 5.1, 5.2, 5.3, 7.6_

  - [x] 5.2 Write property test for GET/POST response parity
    - Create `tests/unit/lambda/get-post-response-parity.property.test.js`
    - **Property 5: GET and POST response parity**
    - For each GET-eligible tool, generate random optional parameters, send both GET and POST, verify response bodies and headers match
    - **Validates: Requirements 5.1, 5.2**

  - [x] 5.3 Write property test for GET/POST error parity
    - Create `tests/unit/lambda/get-post-error-parity.property.test.js`
    - **Property 6: GET and POST error response parity**
    - For each GET-eligible tool, trigger error conditions via both GET and POST, verify error response format matches
    - **Validates: Requirements 5.3**

- [x] 6. Update SAM template and OpenAPI spec
  - [x] 6.1 Add GET event to SAM template
    - In `template.yml`, add a `UseToolGet` API event with `Method: get` for the `/mcp/{tool}` path alongside the existing POST event
    - Update CORS `AllowMethods` from `'POST,OPTIONS'` to `'GET,POST,OPTIONS'`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.2 Add GET method definitions to OpenAPI spec
    - In `template-openapi-spec.yml`, add `get` method definitions for `/mcp/list_tools`, `/mcp/list_templates`, `/mcp/list_categories`, `/mcp/list_starters`
    - Include query string parameter definitions matching each tool's `inputSchema.properties`
    - Include `x-amazon-apigateway-integration` section referencing the ReadLambdaFunction
    - Retain all existing POST definitions without modification
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.3_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Controllers require no changes since the router normalizes input before routing
- Test files follow existing project patterns: `.test.js` for unit tests, `.property.test.js` for property-based tests
