# Requirements Document

## Introduction

**Agent Assets MCP Tools.** This feature adds an expandable, DRY family of read-only MCP tools to the Atlantis MCP Server's read-function Lambda that let AI assistants discover and retrieve example Kiro AI "agent assets" — steering documents, hooks, and AGENTS.md files today, with skills and other types addable later. Assets are sourced from S3 under the same bucket + namespace model already used for CloudFormation templates and application starters, published there by the source repository's pipeline (`63Klabs/atlantis-with-kiro-ai`). Each asset type is exposed through explicit per-type tools (`list_steering`/`get_steering`, `list_hooks`/`get_hooks`, `list_agents_md`/`get_agents_md`) that are thin wrappers over a single registry-driven controller, service, and data-access layer. Tools return content-identity metadata (size, ETag, SHA-256) so a local agent can compare a project's existing assets against the remote and pull updated versions.

This feature adds no new AWS infrastructure or IAM to the stack: it reuses the configured S3 buckets, existing outbound access, and admin-managed permissions.

## Glossary

- **Agent asset**: An example AI-assistant enhancement file (steering document, hook, AGENTS.md, or future type) hosted for reuse.
- **Asset type**: A category of agent asset (`steering`, `hooks`, `agents-md`; future `skills`), mapped to an S3 subfolder.
- **Registry**: The single `AGENT_ASSET_TYPES` configuration that drives tool generation, schemas, descriptions, and dispatch.
- **Namespace**: A root-level S3 prefix within a bucket that partitions assets by org/team (default `atlantis`).
- **S3 layout**: `{bucket}/{namespace}/utilities/v2/agent_assets/{type}/{filename}`.
- **System**: The Agent Assets tools feature within the read-function Lambda as a whole — collectively the Registry, Controller, Service, Data Access Layer, and Router that serve the agent-asset tools. Where an acceptance criterion names a specific layer, that layer is the responsible component.
- **Controller**: The generic layer that implements the shared `list` and `get` request handling for all asset types and exposes the per-type tool wrappers.
- **Service**: The generic business-logic layer that orchestrates asset listing and retrieval between the Controller and the Data Access Layer.
- **Data Access Layer (DAO)**: The generic layer that reads assets from S3, applies extension filtering and deduplication, and computes content-identity metadata.
- **Router**: The MCP JSON-RPC dispatcher that maps incoming tool names to their controller wrappers and formats responses.
- **Brown-out**: Graceful degradation in which an inaccessible bucket or source is skipped with a warning while the remaining sources continue to serve results.

## Requirements

### Requirement 1: List assets of a type

**User Story:** As an AI assistant user, I want to list the available assets for a type (e.g. steering documents), so that I can discover what example assets exist before retrieving one.

#### Acceptance Criteria

1. WHEN a client calls `list_steering`, `list_hooks`, or `list_agents_md` THEN THE System SHALL return the assets located directly under `{namespace}/utilities/v2/agent_assets/{type}/` (excluding any object nested within a subfolder of that prefix) in each configured bucket and indexed namespace.
2. WHEN returning each listed asset THEN THE System SHALL include its `name` (the filename with no path separators), `type`, the `namespace` and `bucket` of the retained source, `s3Path`, `size` in bytes, `etag`, and `lastModified`.
3. WHEN no assets match the requested type across all searched buckets and namespaces THEN THE System SHALL return a successful response containing an empty asset list and SHALL NOT return an error.
4. WHEN the same asset `name` appears in more than one bucket or namespace THEN THE System SHALL retain only the first occurrence found while iterating buckets in their configured `settings.s3.buckets` order and, within each bucket, namespaces in indexed priority order, and SHALL discard all later occurrences of that `name`.
5. WHEN listing assets for a type THEN THE System SHALL include only objects whose filename ends with one of the extensions configured for that type in the `AGENT_ASSET_TYPES` registry, and SHALL exclude all other objects under the prefix.
6. WHEN returning the asset list THEN THE System SHALL order the results deterministically by configured `settings.s3.buckets` order, then indexed namespace priority order, then ascending asset `name`, so that identical inputs always produce identically ordered results.

### Requirement 2: Retrieve a single asset with full content

**User Story:** As an AI assistant user, I want to retrieve one asset's full content, so that I can read it or install it into my project.

#### Acceptance Criteria

1. WHEN a client calls `get_steering`, `get_hooks`, or `get_agents_md` with a valid `name` THEN THE System SHALL return exactly one asset comprising its complete `content` plus `name`, `type`, `namespace`, `bucket`, `s3Path`, `size` (the object size in bytes), `etag`, `sha256`, and `lastModified`; for assets exceeding the configured size threshold, the large-asset handling in Requirement 9 applies instead.
2. WHEN the requested `name` matches assets in more than one configured bucket or namespace THEN THE System SHALL return the single asset that is the first occurrence in bucket-then-namespace priority order, consistent with the list deduplication order in Requirement 1.
3. WHEN computing `sha256` THEN THE System SHALL compute a SHA-256 digest over the exact object bytes returned by S3 and SHALL represent it as a lowercase hexadecimal string.
4. IF the requested `name` is not found in any successfully read bucket or namespace THEN THE System SHALL return an `ASSET_NOT_FOUND` error whose payload includes the list of available asset names of that type from the successfully read sources, returning an empty list when none are available.
5. WHEN a `get_*` tool is invoked THEN THE System SHALL return the latest object version only, without version-history browsing in this release.

### Requirement 3: Client-side comparison support

**User Story:** As an AI assistant, I want stable content identifiers exposed through the tools, so that I can compare a project's local assets to the remote without a server-side compare operation.

#### Acceptance Criteria

1. WHEN a `list_*` tool returns assets THEN THE System SHALL include, for every asset in the result, a `size` in bytes and a non-empty `etag`, so that a caller can detect a changed asset without retrieving its `content`.
2. WHEN a `get_*` tool returns an asset THEN THE System SHALL include a `sha256` computed over the asset's exact byte content together with the asset's `content`, so that a caller can compute the SHA-256 of its local file and compare it to `sha256`.
3. THE System SHALL NOT provide or expose a server-side asset-comparison operation, and SHALL rely on the calling agent to compare assets using the returned `size`, `etag`, and `sha256` values.
4. WHEN a `get_*` tool is called more than once for an unchanged asset THEN THE System SHALL return an identical `sha256` value on each call, so that the identifier is a stable basis for comparison.

### Requirement 4: S3 sourcing under the shared bucket + namespace model

**User Story:** As a self-hosted operator, I want agent assets read from the same S3 buckets and namespaces as templates and starters, so that my organization can publish and serve its own assets.

#### Acceptance Criteria

1. WHEN resolving asset locations, THE System SHALL read only from the buckets configured in `settings.s3.buckets` (`ATLANTIS_S3_BUCKETS`, default `63klabs`) and SHALL NOT read from any bucket outside that configured set.
2. IF a configured bucket does not carry the `atlantis-mcp:Allow=true` tag, THEN THE System SHALL exclude that bucket from the search and continue with the remaining configured buckets (brown-out), logging a warning that identifies the excluded bucket.
3. WHEN a request includes a `namespace` parameter, THE System SHALL restrict the search to that single namespace.
4. WHEN a request omits the `namespace` parameter, THE System SHALL search all indexed namespaces across the configured buckets in bucket-then-namespace priority order.
5. WHEN an `s3Buckets` filter is provided and every bucket it lists is present in the configured bucket list, THE System SHALL restrict the search to the buckets named in the filter.
6. IF an `s3Buckets` filter includes one or more buckets that are not in the configured bucket list, THEN THE System SHALL reject the request with an error that identifies the invalid bucket(s) and SHALL NOT read from S3.
7. WHEN building an S3 key, THE System SHALL use the layout `{namespace}/utilities/v2/agent_assets/{type}/{filename}`.
8. IF a bucket or namespace read fails, THEN THE System SHALL log the error, continue with the remaining sources, record an entry identifying the failed source in the `errors` array, and set `partialData: true` in the response.

### Requirement 5: Expandable, registry-driven, DRY design

**User Story:** As a maintainer, I want a single registry to drive all asset types, so that adding a new type (e.g. skills) requires a one-entry change rather than edits across many files.

#### Acceptance Criteria

1. THE Registry SHALL be a single `AGENT_ASSET_TYPES` definition in which every entry declares all five required, non-empty fields — `name` (the canonical type identifier), `toolToken`, `folder`, `extensions`, and `description` — where `extensions` lists one or more allowed file extensions, and no two entries share the same `name`, `toolToken`, or `folder`.
2. THE System SHALL derive the agent-asset tool set solely from the Registry, producing for each enabled entry exactly one `list_<toolToken>` tool and one `get_<toolToken>` tool — each with its input schema, extended description, and JSON-RPC dispatch entry — and SHALL produce no tools for any type absent from the Registry or whose entry is disabled.
3. THE Controller, Service, and Data Access Layer SHALL each expose one generic `list(assetType, …)` operation and one generic `get(assetType, …)` operation that accept the asset type as a parameter, apply identical processing to every registered type, and derive all type-specific behavior (such as `folder` and `extensions`) solely from that type's Registry entry.
4. WHEN an entry is added to the Registry, or a disabled entry is enabled, as the only source change, THEN its `list_<toolToken>` and `get_<toolToken>` tools SHALL appear in the `tools/list` response and be invocable through `tools/call`, with no edits to the generic Controller, Service, or Data Access Layer logic and no other tool definitions altered.
5. THE Registry SHALL include a fully configured `skills` entry that is disabled by default; WHILE the `skills` entry is disabled, THE System SHALL exclude `list_skills` and `get_skills` from the `tools/list` response and SHALL treat any `tools/call` for them as an unknown tool.
6. THE System SHALL place the shared S3 helpers `checkBucketAccess` and `getIndexedNamespaces` in a common module consumed by the new agent-asset Data Access Layer, with behavior equivalent to the helpers currently used by the template and starter Data Access Layers, and SHALL leave those existing Data Access Layers unchanged so their current tests continue to pass.
7. IF an `AGENT_ASSET_TYPES` entry is missing a required field or duplicates the `name`, `toolToken`, or `folder` of another entry, THEN THE System SHALL fail initialization with an error identifying the offending entry and SHALL NOT expose any agent-asset tools.

### Requirement 6: MCP protocol integration

**User Story:** As an AI assistant, I want the new tools available through the standard MCP discovery and invocation flow, so that I can call them like any other tool.

#### Acceptance Criteria

1. WHEN a client calls `tools/list` THEN THE System SHALL include, for every enabled asset type, both its generated list and get tools, each with a non-empty description and an input schema object.
2. WHEN a client calls `tools/call` with the name of an enabled agent-asset tool THEN THE Router SHALL dispatch the request to that tool's controller wrapper and SHALL return an MCP tool result that carries the output of the invoked tool.
3. WHERE the `list_agent_asset_types` tool is enabled, WHEN a client calls it, THE System SHALL return each enabled asset type together with a count of the assets discoverable for that type across the configured buckets and indexed namespaces.
4. IF a client supplies a tool name that does not appear in the `tools/list` response THEN THE Router SHALL return a JSON-RPC "method not found" error identifying the requested name and SHALL NOT invoke any controller wrapper.
5. WHERE an asset type is not enabled in the Registry, THE System SHALL NOT include that type's list or get tools in the `tools/list` response.

### Requirement 7: Input validation and security

**User Story:** As an operator, I want tool inputs validated and path traversal prevented, so that the tools cannot be used to read outside the intended prefix.

#### Acceptance Criteria

1. WHEN a `get_*` tool is called THEN THE System SHALL require a `name` parameter of 1 to 255 characters that matches `^[^/\\]+$` and contains no path separators (`/` or `\`).
2. WHEN a tool is called THEN THE System SHALL accept only the optional `s3Buckets` and `namespace` parameters, each conforming to the same schema as the corresponding template-tool parameter, and SHALL permit no other properties.
3. WHEN constructing an S3 key from a validated `name` THEN THE System SHALL append the `name` to the fixed `{namespace}/utilities/v2/agent_assets/{type}/` prefix so that the resulting key always begins with that prefix and references no location outside it.
4. WHEN returning remote content THEN THE System SHALL return that content verbatim as untrusted text and SHALL NOT execute or evaluate that content.
5. THE System SHALL compute content hashes using the runtime's built-in cryptographic functions without invoking a shell.
6. THE System SHALL NOT log secrets such as credentials, tokens, or signing keys.
7. IF input validation fails — including a missing `name`, a `name` that does not match `^[^/\\]+$` or exceeds 255 characters, an unknown property, or an `s3Buckets` or `namespace` value that does not conform to its schema — THEN THE System SHALL reject the request with a validation error that identifies the rejected parameter and SHALL NOT perform any S3 read.

### Requirement 8: Caching

**User Story:** As an operator, I want asset listings and content cached, so that repeated calls are fast and S3 request volume stays low.

#### Acceptance Criteria

1. THE System SHALL define an `s3-agent-assets` connection that provides an `assets-list` cache profile used for `list_*` responses and an `asset-detail` cache profile used for `get_*` responses, each with a defined cache TTL.
2. WHEN serving a `list_*` request THEN THE System SHALL return the response from a pass-through cache keyed by the asset type, bucket set, and namespace, serving a repeated request with identical key components from the cache without issuing new S3 requests and caching a request that differs in any key component as a separate entry.
3. WHEN serving a `get_*` request THEN THE System SHALL return the response from a pass-through cache keyed by the asset type, asset name, bucket set, and namespace, serving a repeated request with identical key components from the cache without issuing new S3 requests and caching a request that differs in any key component as a separate entry.
4. WHILE running in a production environment THE System SHALL set the `assets-list` and `asset-detail` cache TTLs following the same environment-based convention as the template cache profiles, with each TTL being at least 3600 seconds (1 hour).
5. WHILE running in a non-production (test) environment THE System SHALL set each of the `assets-list` and `asset-detail` cache TTLs to a value that is shorter than its corresponding production TTL and no greater than 300 seconds (5 minutes), to support rapid iteration.

### Requirement 9: Large-asset handling (deferrable, parity with templates)

**User Story:** As an AI assistant, I want large assets to degrade gracefully like large templates, so that responses stay within size limits.

#### Acceptance Criteria

1. WHEN the byte size of a `get_*` response exceeds the configured size threshold (the same threshold applied by `get_template`, default 50,000 bytes) THEN THE System SHALL return a summary that includes `contentTruncated: true` and a `totalChunks` value equal to the number of chunks into which the full content is divided, where `totalChunks` is an integer of at least 1.
2. WHEN a client calls the `get_agent_asset_chunk` tool for an asset with a `chunkIndex` in the range 0 through `totalChunks` minus 1 THEN THE System SHALL return the content chunk at that zero-based index together with its `chunkIndex` and the `totalChunks` value.
3. IF `chunkIndex` is negative or is greater than or equal to `totalChunks` THEN THE System SHALL return an `INVALID_CHUNK_INDEX` error that indicates the valid index range (0 through `totalChunks` minus 1).
4. WHEN a client requests every chunk index from 0 through `totalChunks` minus 1 in order THEN THE System SHALL return chunks that together reconstruct the asset's complete content, consistent with `get_template` chunk retrieval.

*This requirement may be delivered after the core tools; current assets fit well under the threshold.*

### Requirement 10: Documentation and configuration

**User Story:** As a user and operator, I want the new tools documented and safe to auto-approve, so that I can adopt them quickly.

#### Acceptance Criteria

1. THE end-user tools reference SHALL document each of the six per-type tools (`list_steering`, `get_steering`, `list_hooks`, `get_hooks`, `list_agents_md`, `get_agents_md`) with its parameters, at least one example prompt, and at least one use case, SHALL include the `63klabs`/`atlantis` bucket-and-namespace note and the client-side compare workflow, and SHALL list the `ASSET_NOT_FOUND` error code together with the condition under which it is returned.
2. THE Kiro integration guide's `autoApprove` example SHALL list each of the six read-only agent-asset tools by name (`list_steering`, `get_steering`, `list_hooks`, `get_hooks`, `list_agents_md`, `get_agents_md`).
3. THE admin-ops documentation SHALL describe the `{namespace}/utilities/v2/agent_assets/{type}/` layout and SHALL note that prefix-scoped admin IAM policies must add `utilities/v2/*`.
4. THE developer documentation and `ARCHITECTURE.md` SHALL describe the registry-driven flow from the `AGENT_ASSET_TYPES` registry through the controller, service, and data-access layers, and SHALL provide the steps to add a new asset type as a single registry entry that requires no changes to the generic controller, service, or data-access logic.
5. THE `CHANGELOG.md` SHALL record the feature under `v0.0.6 (unreleased)` referencing this spec.
6. THE feature SHALL reuse the existing S3 buckets, outbound access, and admin-managed IAM, and SHALL add no new AWS infrastructure or IAM to the stack template; publishing assets to S3 is owned by the source repository and is out of scope for this feature.

### Requirement 11: Testing and verification

**User Story:** As a maintainer, I want the feature covered by tests in the existing framework, so that it is safe to deploy through CI/CD.

#### Acceptance Criteria

1. THE new tests SHALL be named `*.test.js`, with per-layer unit tests placed under `tests/unit/<layer>/` and cross-layer integration tests placed under `tests/integration/`, matching the read-function's existing Jest layout.
2. WHEN the Data Access Layer is exercised against mocked S3 objects THEN THE new tests SHALL assert that a list operation returns only assets whose file extensions match the type's configured extensions with duplicate names removed in bucket-then-namespace priority order, that a get operation returns the full mocked object content, and that the returned `sha256` equals the SHA-256 computed over the mocked object bytes.
3. WHEN the Data Access Layer is exercised against mocked S3 error and edge conditions THEN THE new tests SHALL assert that a request for a missing asset returns an `ASSET_NOT_FOUND` error containing the available asset names for that type, that a bucket lacking access is skipped (brown-out) while the remaining mocked sources still return results, and that a `name` containing a `/` or `\` separator is rejected before any S3 read occurs.
4. WHEN the Router is exercised by an integration test THEN THE new tests SHALL assert that every generated agent-asset tool appears in the `tools/list` response with its description and input schema, that a `tools/call` to a `list_*` tool returns the mocked assets, and that a `tools/call` to a `get_*` tool returns content equal to the mocked object bytes with a `sha256` equal to the SHA-256 of those bytes.
5. THE new and existing Jest test suites SHALL complete with zero failing tests before the change is considered complete.
