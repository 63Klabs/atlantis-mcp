# Implementation Plan: MCP Large Content Response

## Overview

Add content-aware response handling for the `get_template` MCP tool. When a template response exceeds a configurable size threshold, return a structured summary with metadata instead of the full content, and provide a new `get_template_chunk` tool for incremental retrieval of the full content in manageable segments. The implementation builds utility modules first, then registers the new tool, modifies the router for size-aware responses, and adds the chunk controller.

## Tasks

- [ ] 1. Create Content Sizer utility module
  - [x] 1.1 Create `utils/content-sizer.js` with `measure()` function
    - Implement `measure(serializedJson, threshold)` that calculates `Buffer.byteLength(serializedJson, 'utf8')` and returns `{ byteLength, exceedsThreshold }` per design
    - Default threshold to `MCP_CONTENT_SIZE_THRESHOLD` env var or 50000 bytes
    - Handle non-string input gracefully (return byteLength 0, exceedsThreshold false)
    - Handle non-numeric env var by falling back to default
    - Export `measure` and `DEFAULT_SIZE_THRESHOLD`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Write property test for Content Sizer (Property 1)
    - **Property 1: Content sizer measures byte length and threshold correctly**
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - Create `tests/property/content-sizer.property.test.js`
    - Generate random UTF-8 strings via `fc.string()` and positive integer thresholds via `fc.integer({ min: 1, max: 200000 })`
    - Verify `byteLength` equals `Buffer.byteLength(string, 'utf8')` and `exceedsThreshold` is `true` iff `byteLength > threshold`
    - Minimum 100 iterations

  - [x] 1.3 Write unit tests for Content Sizer
    - Create `tests/unit/utils/content-sizer.test.js`
    - Test default threshold (50000), env var override, empty string, multi-byte characters, non-string input
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Create Content Chunker utility module
  - [x] 2.1 Create `utils/content-chunker.js` with `chunk()` function
    - Implement `chunk(content, maxChunkSize)` that splits content into sequential segments preferring line boundaries per design
    - Default max chunk size to `MCP_CHUNK_SIZE` env var or 40000 bytes
    - When a single line exceeds the limit, split at byte boundary
    - Handle empty string by returning `['']`
    - Handle non-numeric or zero/negative env var by falling back to default
    - Export `chunk` and `DEFAULT_CHUNK_SIZE`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 2.2 Write property test: Chunking round-trip preserves content (Property 2)
    - **Property 2: Chunking round-trip preserves content**
    - **Validates: Requirements 4.5, 3.4**
    - Create `tests/property/content-chunker.property.test.js`
    - Generate non-empty strings via `fc.string({ minLength: 1 })` and positive chunk sizes via `fc.integer({ min: 1, max: 100000 })`
    - Verify concatenating all chunks in order reconstructs the original content exactly
    - Minimum 100 iterations

  - [ ] 2.3 Write property test: Every chunk respects the size bound (Property 3)
    - **Property 3: Every chunk respects the size bound**
    - **Validates: Requirements 4.1**
    - Add to `tests/property/content-chunker.property.test.js`
    - Generate non-empty strings and positive chunk sizes
    - Verify every chunk has `Buffer.byteLength(chunk, 'utf8') <= maxChunkSize`
    - Minimum 100 iterations

  - [ ] 2.4 Write property test: Line-boundary splitting when lines fit (Property 4)
    - **Property 4: Line-boundary splitting when lines fit**
    - **Validates: Requirements 4.3**
    - Add to `tests/property/content-chunker.property.test.js`
    - Generate content where every individual line has byte length ≤ max chunk size
    - Verify no line is split across two chunks
    - Minimum 100 iterations

  - [x] 2.5 Write unit tests for Content Chunker
    - Create `tests/unit/utils/content-chunker.test.js`
    - Test single chunk (small content), multi-chunk, single oversized line, empty content, exact boundary
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3. Checkpoint - Ensure utility module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Register `get_template_chunk` tool
  - [x] 4.1 Add `get_template_chunk` tool definition to `config/settings.js` `availableToolsList`
    - Add tool with name `get_template_chunk`, description, and inputSchema defining `templateName` (string, required), `category` (string, required, enum of categories), `chunkIndex` (integer, required, minimum 0), and optional `version`, `versionId`, `s3Buckets`, `namespace`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 Add `get_template_chunk` schema to `utils/schema-validator.js`
    - Add schema with required `templateName`, `category`, `chunkIndex` (integer, minimum 0) and optional `version`, `versionId`, `s3Buckets`, `namespace`
    - _Requirements: 6.3, 3.2, 3.3_

  - [x] 4.3 Add extended description for `get_template_chunk` in `config/tool-descriptions.js`
    - Add entry explaining the tool retrieves a specific chunk of a large CloudFormation template that was too large to return in a single `get_template` response
    - _Requirements: 6.4_

  - [x] 4.4 Update `get_template` extended description in `config/tool-descriptions.js`
    - Document that responses exceeding the size threshold return a Template_Summary with `contentTruncated: true`
    - Mention `get_template_chunk` as the mechanism for retrieving full content
    - Document `totalChunks` and `retrievalHint` fields
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 5. Implement `getChunk` controller and wire routing
  - [x] 5.1 Add `getChunk()` function to `controllers/templates.js`
    - Validate input via SchemaValidator for `get_template_chunk`
    - Fetch full template via `Services.Templates.get()`
    - Serialize template content and chunk via `ContentChunker.chunk()`
    - Validate `chunkIndex` range; return `INVALID_CHUNK_INDEX` error if out of range with valid range in message
    - Return chunk data: `{ chunkIndex, totalChunks, templateName, category, content }`
    - Export `getChunk` from the module
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.2 Add `get_template_chunk` to `TOOL_DISPATCH` in `utils/json-rpc-router.js`
    - Add `get_template_chunk: Controllers.Templates.getChunk` to the dispatch map
    - _Requirements: 6.1_

  - [ ] 5.3 Write property test: Invalid chunk index returns error (Property 6)
    - **Property 6: Invalid chunk index returns error**
    - **Validates: Requirements 3.6**
    - Create `tests/property/template-chunk-invalid-index.property.test.js`
    - Generate template content that produces N chunks, and integer `chunkIndex` where `chunkIndex < 0` or `chunkIndex >= N`
    - Verify the `getChunk` controller returns error with code `INVALID_CHUNK_INDEX` and message indicating valid range `[0, N-1]`
    - Mock `Services.Templates.get()` to return generated template data
    - Minimum 100 iterations

  - [x] 5.4 Write unit tests for `getChunk` controller
    - Create `tests/unit/controllers/templates-get-chunk.test.js`
    - Test valid chunk retrieval, invalid chunkIndex, template not found, schema validation failure
    - Mock `Services.Templates.get()` and `ContentChunker`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Checkpoint - Ensure chunk controller tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Modify router for size-aware `get_template` responses
  - [x] 7.1 Add size check and summary generation to `handleToolsCall()` in `utils/json-rpc-router.js`
    - Import `ContentSizer` and `ContentChunker`
    - After building `resultData` for `get_template`, serialize to JSON and call `ContentSizer.measure()`
    - If `exceedsThreshold`, call `buildTemplateSummary(resultData)` to generate a Template_Summary and return it instead of the full content
    - Wrap size check and summary generation in try-catch; on failure, fall back to returning the original full response
    - _Requirements: 2.1, 5.1, 5.2_

  - [x] 7.2 Implement `buildTemplateSummary()` helper in `utils/json-rpc-router.js`
    - Extract `name`, `version`, `versionId`, `description`, `category`, `namespace`, `bucket`, `s3Path` from template data
    - Extract `parameters` and `outputs` objects
    - Extract top-level resource logical IDs and types into `resources` array of `{ logicalId, type }`
    - Set `contentTruncated: true`
    - Calculate `totalChunks` using `ContentChunker.chunk()` on the serialized content
    - Set `retrievalHint` to a human-readable instruction mentioning `get_template_chunk`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 7.3 Write property test: Template summary contains all required fields (Property 5)
    - **Property 5: Template summary contains all required fields**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
    - Create `tests/property/template-summary.property.test.js`
    - Generate random template data objects with name, version, description, category, namespace, bucket, s3Path, parameters, outputs, and content exceeding SIZE_THRESHOLD
    - Verify summary contains all required fields: `name`, `version`, `versionId`, `description`, `category`, `namespace`, `bucket`, `s3Path`, `parameters`, `outputs`, `resources`, `contentTruncated` (true), `totalChunks` (matching actual chunk count), `retrievalHint` (non-empty string containing `get_template_chunk`)
    - Minimum 100 iterations

  - [ ] 7.4 Write property test: Backward compatibility (Property 7)
    - **Property 7: Backward compatibility for non-oversized and non-get_template responses**
    - **Validates: Requirements 5.1, 5.2**
    - Create `tests/property/large-content-backward-compat.property.test.js`
    - Generate tool calls where tool name is not `get_template`; verify response format is unchanged `{ content: [{ type: 'text', text: JSON.stringify(resultData) }] }`
    - Generate `get_template` calls where payload does not exceed SIZE_THRESHOLD; verify response format is unchanged
    - Mock controllers to return generated data
    - Minimum 100 iterations

  - [x] 7.5 Write unit tests for router chunking behavior
    - Create `tests/unit/utils/json-rpc-router-chunking.test.js`
    - Test `get_template` oversized response returns summary with `contentTruncated: true` and `totalChunks`
    - Test `get_template` under threshold returns unchanged response
    - Test non-`get_template` tool returns unchanged response regardless of size
    - Test graceful fallback when summary generation fails
    - Mock controllers, `ContentSizer`, and `ContentChunker`
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 5.1, 5.2_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate the 7 correctness properties from the design document
- All tests use Jest with fast-check for property-based tests (per project conventions)
- All source files are under `application-infrastructure/src/lambda/read/`
- All test files are under `application-infrastructure/src/lambda/read/tests/`
- The project uses CommonJS (`require`/`module.exports`)
- Checkpoints ensure incremental validation
