# Requirements Document

## Introduction

The `getChunk` controller in the Atlantis MCP Server Read Lambda currently serializes and chunks template content on every request, even when the underlying template data has not changed. This is process-intensive and redundant because the template data is already cached upstream via `CacheableDataAccess`. This feature introduces internal caching for the chunking operation itself using the established `@63klabs/cache-data` `CacheableDataAccess` pattern, so that repeated chunk requests for the same template return cached results instead of re-serializing and re-chunking.

## Glossary

- **Chunk_Controller**: The `getChunk` function in `controllers/templates.js` that handles MCP tool requests for retrieving a specific chunk of a template's serialized content.
- **Content_Chunker**: The `chunk` function in `utils/content-chunker.js` that splits a content string into sequential segments at line boundaries.
- **CacheableDataAccess**: The caching wrapper from `@63klabs/cache-data` that manages cache reads, writes, and expiration for data retrieved via a fetch function.
- **Connection_Config**: An entry in `config/connections.js` that defines a named connection with host, path, and an array of cache profiles.
- **Cache_Profile**: A configuration object within a Connection_Config that specifies TTL, cache key identifiers (hostId, pathId), expiration strategy, and encryption settings.
- **Fetch_Function**: An async function passed to `CacheableDataAccess.getData()` that produces the data to be cached when a cache miss occurs. It receives a connection object and options, and returns an `ApiRequest.success()` or `ApiRequest.error()` response.
- **Conn_Parameters**: The `conn.parameters` property on a connection object, used by `CacheableDataAccess` for cache key generation and passed to the Fetch_Function.
- **Template_Chunk_Cache**: The new internal cache layer that caches individual chunk results (content string, totalChunks, chunkIndex) keyed by template identity and chunk index.

## Requirements

### Requirement 1: Template Chunk Connection Configuration

**User Story:** As a maintainer, I want a dedicated connection and cache profile defined in `config/connections.js` for template chunk caching, so that chunk cache behavior is configurable and follows the established pattern.

#### Acceptance Criteria

1. THE Connection_Config module SHALL include a connection entry named `template-chunks` with `host` set to `'internal'` and an appropriate `path` value.
2. THE `template-chunks` connection SHALL include a Cache_Profile named `chunk-data` with `hostId` set to `'template-chunks'`, a unique `pathId`, `overrideOriginHeaderExpiration` set to `true`, and `encrypt` set to `false`.
3. THE `chunk-data` Cache_Profile SHALL use environment-appropriate TTL values: a longer TTL for production and a shorter TTL for non-production, consistent with the existing TTL pattern in Connection_Config.
4. THE `chunk-data` Cache_Profile SHALL set `expirationIsOnInterval` to `false` so that cached chunks expire on-demand rather than on a fixed interval.

### Requirement 2: Chunk Fetch Function

**User Story:** As a developer, I want the serialization and chunking logic wrapped in a fetch function compatible with `CacheableDataAccess.getData()`, so that chunk results can be cached and retrieved transparently.

#### Acceptance Criteria

1. WHEN a cache miss occurs for a requested chunk, THE Fetch_Function SHALL retrieve the full template via `Services.Templates.get()`, serialize the template to JSON using `JSON.stringify()`, and split the serialized content using `Content_Chunker.chunk()`.
2. WHEN the Fetch_Function produces chunks successfully, THE Fetch_Function SHALL return an `ApiRequest.success()` response with a body containing the chunk `content`, `totalChunks`, and `chunkIndex`.
3. IF the template is not found during the fetch, THEN THE Fetch_Function SHALL propagate the `TEMPLATE_NOT_FOUND` error with the `availableTemplates` property intact.
4. IF the `chunkIndex` from Conn_Parameters is outside the valid range of produced chunks, THEN THE Fetch_Function SHALL return an `ApiRequest.error()` response with a descriptive message including the valid range.

### Requirement 3: Cache Key Generation via conn.parameters

**User Story:** As a developer, I want `chunkIndex` passed as part of `conn.parameters` to `CacheableDataAccess.getData()`, so that each chunk is cached individually and the cache key uniquely identifies a specific chunk of a specific template version.

#### Acceptance Criteria

1. THE Chunk_Controller SHALL set `conn.parameters` to include `templateName`, `category`, `chunkIndex`, `version`, `versionId`, `s3Buckets`, and `namespace` before calling `CacheableDataAccess.getData()`.
2. THE Chunk_Controller SHALL set `conn.host` to the resolved list of S3 buckets (or the default buckets from settings) so that the cache key reflects the bucket scope.
3. WHEN `CacheableDataAccess.getData()` is called, THE Chunk_Controller SHALL pass the `chunk-data` Cache_Profile, the Fetch_Function, and the configured connection object.
4. THE Fetch_Function SHALL read `chunkIndex` and template identity parameters from the connection's `parameters` property, not from closure variables.

### Requirement 4: Controller Integration

**User Story:** As a user of the `get_template_chunk` MCP tool, I want chunk requests to return cached results when available, so that repeated requests for the same chunk are fast and do not re-process the template.

#### Acceptance Criteria

1. WHEN a `get_template_chunk` request is received with valid parameters, THE Chunk_Controller SHALL call `CacheableDataAccess.getData()` with the configured connection and cache profile instead of directly calling `Services.Templates.get()` and `Content_Chunker.chunk()`.
2. WHEN `CacheableDataAccess.getData()` returns a cached result, THE Chunk_Controller SHALL extract the body using `cacheObj.getBody(true)` and return the chunk data in the existing MCP response format.
3. THE Chunk_Controller SHALL continue to validate input parameters via `SchemaValidator.validate()` before attempting any cache or fetch operations.
4. THE Chunk_Controller SHALL continue to handle `TEMPLATE_NOT_FOUND` and `INVALID_CHUNK_INDEX` errors with the same MCP error response format as the current implementation.

### Requirement 5: Cache Consistency with Template Data

**User Story:** As a maintainer, I want the chunk cache TTL to be equal to or shorter than the template detail cache TTL, so that stale chunks do not persist longer than the underlying template data.

#### Acceptance Criteria

1. THE `chunk-data` Cache_Profile `defaultExpirationInSeconds` SHALL be less than or equal to the `template-detail` Cache_Profile `defaultExpirationInSeconds` for both production and non-production environments.
2. WHEN the underlying template data changes and its cache expires, THE Template_Chunk_Cache entries SHALL expire within the same or a shorter time window.
