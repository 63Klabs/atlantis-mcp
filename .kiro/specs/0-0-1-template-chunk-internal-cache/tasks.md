# Implementation Plan: Template Chunk Internal Cache

## Overview

Add internal caching for the `getChunk` controller using `CacheableDataAccess` from `@63klabs/cache-data`. This involves adding a new `template-chunks` connection with a `chunk-data` cache profile to `config/connections.js`, then refactoring the `getChunk` controller to delegate to `CacheableDataAccess.getData()` with a fetch function that reads all parameters from `connection.parameters`.

## Tasks

- [x] 1. Add `template-chunks` connection to `config/connections.js`
  - [x] 1.1 Add the `template-chunks` connection entry with `host: 'internal'`, `path: '/chunks'`, and a `chunk-data` cache profile
    - Add a new object to the `connections` array after the `documentation-index` entry
    - `chunk-data` profile: `hostId: 'template-chunks'`, `pathId: 'data'`, `overrideOriginHeaderExpiration: true`, `encrypt: false`, `expirationIsOnInterval: false`
    - Production TTL: `24 * 60 * 60` (matching `template-detail`), Non-prod TTL: `TTL_NON_PROD`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write unit test for `template-chunks` connection configuration
    - Verify `template-chunks` connection exists with correct `host`, `path`, and `chunk-data` profile fields
    - Verify `chunk-data` TTL ≤ `template-detail` TTL for both prod and non-prod
    - Verify `expirationIsOnInterval` is `false`
    - Test file: `tests/unit/config/template-chunks-connection.test.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1_

  - [x] 1.3 Write property test: Chunk cache TTL does not exceed template-detail TTL
    - **Property 5: Chunk cache TTL does not exceed template-detail TTL**
    - Read both `chunk-data` and `template-detail` cache profiles from connections config and verify the TTL constraint holds
    - Test file: `tests/property/template-chunk-cache-ttl.property.test.js`
    - **Validates: Requirements 5.1**

- [x] 2. Refactor `getChunk` controller to use `CacheableDataAccess`
  - [x] 2.1 Add new imports and refactor `getChunk` in `controllers/templates.js`
    - Add imports: `CacheableDataAccess`, `ApiRequest` from `@63klabs/cache-data`, and `Config` from `../config`
    - Replace direct `Services.Templates.get()` + `ContentChunker.chunk()` calls with `CacheableDataAccess.getData()`
    - Retrieve `{ conn, cacheProfile }` via `Config.getConnCacheProfile('template-chunks', 'chunk-data')`
    - Set `conn.host` to resolved S3 buckets (default from settings if not provided)
    - Set `conn.parameters` to `{ templateName, category, chunkIndex, version, versionId, s3Buckets, namespace }`
    - Define fetch function that reads all parameters from `connection.parameters` (not closure variables)
    - Fetch function: call `Services.Templates.get()`, `JSON.stringify()`, `ContentChunker.chunk()`, validate chunkIndex, return `ApiRequest.success()` or `ApiRequest.error()`
    - Fetch function: throw `TEMPLATE_NOT_FOUND` (not cached), return `ApiRequest.error()` for `INVALID_CHUNK_INDEX` (cached)
    - Extract result via `cacheObj.getBody(true)`, check for `INVALID_CHUNK_INDEX` in body, return MCP response
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

  - [x] 2.2 Write property test: Fetch function produces correct chunk content
    - **Property 1: Fetch function produces correct chunk content**
    - Generate random template-like objects and valid chunk indices; verify fetch function output matches direct `JSON.stringify` + `ContentChunker.chunk` computation
    - Test file: `tests/property/template-chunk-fetch.property.test.js`
    - **Validates: Requirements 2.1, 2.2**

  - [x] 2.3 Write property test: Out-of-range chunkIndex produces error with valid range
    - **Property 2: Out-of-range chunkIndex produces error with valid range**
    - Generate random template objects and out-of-range indices (negative or ≥ totalChunks); verify the fetch function returns an error with the correct valid range
    - Test file: `tests/property/template-chunk-fetch.property.test.js` (same file, additional property)
    - **Validates: Requirements 2.4**

- [x] 3. Checkpoint - Verify connection config and controller refactor
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Controller integration and error handling tests
  - [x] 4.1 Write property test: Controller sets conn.parameters and conn.host correctly
    - **Property 3: Controller sets conn.parameters and conn.host correctly**
    - Generate random input parameter combinations; verify `conn.parameters` contains all fields and `conn.host` resolves correctly
    - Test file: `tests/property/template-chunk-controller.property.test.js`
    - **Validates: Requirements 3.1, 3.2**

  - [x] 4.2 Write property test: Controller output preserves chunk data in MCP format
    - **Property 4: Controller output preserves chunk data in MCP format**
    - Generate random chunk body objects; verify the MCP response data matches the input body
    - Test file: `tests/property/template-chunk-controller.property.test.js` (same file, additional property)
    - **Validates: Requirements 4.2**

  - [x] 4.3 Write unit tests for refactored `getChunk` controller
    - Mock `CacheableDataAccess.getData()` and verify controller calls it with correct arguments
    - Test cache hit path: verify `cacheObj.getBody(true)` extraction and MCP response formatting
    - Test `TEMPLATE_NOT_FOUND` error propagation through catch block
    - Test `INVALID_CHUNK_INDEX` detection from cached body and MCP error response
    - Test schema validation rejection before cache lookup
    - Test default bucket resolution when `s3Buckets` not provided
    - Test file: `tests/unit/controllers/templates-get-chunk-cached.test.js`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific scenarios with mocked dependencies
- All new test files use `.test.js` extension following existing workspace conventions
- Property test files use `.property.test.js` extension following existing workspace conventions
- Tests use Jest with fast-check for property-based testing
