# Implementation Plan: Add Namespace Filter to List Templates

## Overview

Thread an optional `namespace` parameter through four MCP tools (`list_templates`, `get_template`, `list_template_versions`, `check_template_updates`) across five layers: schema validation, controllers, service, and model. When provided, the model layer skips namespace discovery and searches only the specified namespace. When omitted, behavior is unchanged.

## Tasks

- [x] 1. Add namespace property to schema validator
  - [x] 1.1 Add `namespace` property to `list_templates`, `get_template`, `list_template_versions`, and `check_template_updates` schemas in `utils/schema-validator.js`
    - Property: `{ type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 63, description: 'Filter to a specific namespace (S3 root prefix)' }`
    - Add to `properties` object of each schema; do NOT add to `required` array
    - Do NOT add to `list_categories` schema
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_

  - [x] 1.2 Write property test: Invalid namespace values are rejected (Property 1)
    - **Property 1: Invalid namespace values are rejected by validation**
    - Use fast-check to generate strings not matching `^[a-z0-9][a-z0-9-]*$` or exceeding 63 chars
    - Verify `SchemaValidator.validate()` returns `{ valid: false }` for all four tool schemas
    - Create test file: `tests/unit/utils/schema-validator-namespace.property.jest.mjs`
    - **Validates: Requirements 1.6, 1.7, 6.1, 6.2, 6.3, 6.4, 6.5**

  - [x] 1.3 Write property test: Valid inputs without namespace pass validation (Property 2)
    - **Property 2: Valid inputs without namespace continue to pass validation**
    - Use fast-check to generate valid input objects without `namespace`
    - Verify `SchemaValidator.validate()` returns `{ valid: true }` for all four tool schemas
    - Add to same test file as 1.2
    - **Validates: Requirements 1.8, 5.1, 5.2**

  - [x] 1.4 Write unit tests for schema validator namespace validation
    - Test specific invalid inputs: uppercase, spaces, slashes, leading hyphen, empty string, >63 chars
    - Test valid namespace values: `atlantis`, `acme`, `turbo-kiln`, `x1`
    - Verify `list_categories` schema does NOT accept `namespace`
    - Create test file: `tests/unit/utils/schema-validator-namespace.jest.mjs`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 2. Thread namespace through controllers
  - [x] 2.1 Update templates controller to extract and pass namespace
    - In `list()`: destructure `namespace` from `input`, pass to `Services.Templates.list()`
    - In `get()`: destructure `namespace` from `input`, pass to `Services.Templates.get()`
    - In `listVersions()`: destructure `namespace` from `input`, pass to `Services.Templates.listVersions()`
    - File: `controllers/templates.js`
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 2.2 Update updates controller to extract and pass namespace
    - In `check()`: destructure `namespace` from `input`, pass to `Services.Templates.checkUpdates()`
    - File: `controllers/updates.js`
    - _Requirements: 2.4, 2.5_

  - [x] 2.3 Write property test: Controller passes namespace through to service (Property 3)
    - **Property 3: Controller passes namespace through to service layer**
    - Use fast-check to generate valid namespace strings
    - Mock service layer, verify exact namespace value is passed for all four handlers
    - Verify `undefined` is passed when namespace is omitted
    - Create test file: `tests/unit/controllers/controller-namespace-passthrough.property.jest.mjs`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [x] 2.4 Write unit tests for controller namespace extraction
    - Test that each controller handler extracts namespace and passes it to the service
    - Test that omitted namespace passes `undefined`
    - Create test file: `tests/unit/controllers/controller-namespace.jest.mjs`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Include namespace in service layer connection parameters
  - [x] 4.1 Update service functions to include namespace in `conn.parameters`
    - In `list()`: accept `namespace` in options, add to `conn.parameters`
    - In `get()`: accept `namespace` in options, add to `conn.parameters`
    - In `listVersions()`: accept `namespace` in options, add to `conn.parameters`
    - In `checkUpdates()`: accept `namespace` in options, pass through to inner `get()` calls
    - File: `services/templates.js`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 4.2 Write property test: Service includes namespace in connection parameters (Property 4)
    - **Property 4: Service includes namespace in connection parameters**
    - Use fast-check to generate valid namespace strings
    - Mock model layer, verify `conn.parameters.namespace` matches for all four operations
    - Create test file: `tests/unit/services/service-namespace-params.property.jest.mjs`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x] 4.3 Write property test: Different namespace values produce different cache keys (Property 5)
    - **Property 5: Different namespace values produce different cache keys**
    - Use fast-check to generate pairs of distinct namespace values (including `undefined`)
    - Verify `conn.parameters` objects differ for same operation with different namespaces
    - Add to same test file as 4.2
    - **Validates: Requirements 3.5, 3.6**

  - [x] 4.4 Write unit tests for service namespace handling
    - Test `conn.parameters` includes namespace when provided
    - Test `conn.parameters` does not include namespace when omitted
    - Test cache key differs with different namespace values
    - Create test file: `tests/unit/services/service-namespace.jest.mjs`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5. Implement model layer namespace filtering
  - [x] 5.1 Update `list()`, `get()`, and `listVersions()` in S3 templates model
    - Extract `namespace` from `connection.parameters`
    - When namespace is provided: use `[namespace]` directly instead of calling `getIndexedNamespaces(bucket)`
    - When namespace is omitted: continue calling `getIndexedNamespaces(bucket)` as today
    - Non-existent namespace returns empty results without error
    - File: `models/s3-templates.js`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.2 Write property test: Model skips namespace discovery when namespace is provided (Property 6)
    - **Property 6: Model skips namespace discovery when namespace is provided**
    - Use fast-check to generate valid namespace strings
    - Mock S3 client and spy on `getIndexedNamespaces`
    - Verify `getIndexedNamespaces` is NOT called when namespace is provided
    - Verify `getIndexedNamespaces` IS called when namespace is omitted
    - Create test file: `tests/unit/models/model-namespace-filtering.property.jest.mjs`
    - **Validates: Requirements 4.1, 4.3, 4.5**

  - [x] 5.3 Write property test: Non-existent namespace returns empty results (Property 7)
    - **Property 7: Non-existent namespace returns empty results without error**
    - Use fast-check to generate random namespace strings
    - Mock S3 to return empty results
    - Verify `list()` returns `{ templates: [] }`, `get()` returns `null`, `listVersions()` returns `{ versions: [] }`
    - Add to same test file as 5.2
    - **Validates: Requirements 4.7**

  - [x] 5.4 Write unit tests for model namespace filtering
    - Test `list()` uses `[namespace]` when provided, calls `getIndexedNamespaces` when omitted
    - Test `get()` searches only specified namespace when provided
    - Test `listVersions()` searches only specified namespace when provided
    - Test empty results for non-existent namespace (no error thrown)
    - Create test file: `tests/unit/models/model-namespace.jest.mjs`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify backward compatibility: existing requests without namespace work identically
  - Verify `list_categories` is unchanged and does not accept namespace
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

## Notes

- All tasks are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All new test files use Jest (`.jest.mjs`) per project conventions
- Property-based tests use `fast-check` with minimum 100 iterations
- All file paths are relative to `application-infrastructure/src/lambda/read/`
