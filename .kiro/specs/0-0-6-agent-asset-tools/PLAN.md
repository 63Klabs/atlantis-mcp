# Requirements: Agent Assets MCP Tools

## Introduction

This feature adds an expandable, DRY family of read-only MCP tools to the Atlantis MCP Server's read-function Lambda that let AI assistants discover and retrieve example Kiro AI "agent assets" — steering documents, hooks, and AGENTS.md files today, with skills and other types addable later. Assets are sourced from S3 under the same bucket + namespace model already used for CloudFormation templates and application starters, published there by the source repository's pipeline (`63Klabs/atlantis-with-kiro-ai`). Each asset type is exposed through explicit per-type tools (`list_steering`/`get_steering`, `list_hooks`/`get_hooks`, `list_agents_md`/`get_agents_md`) that are thin wrappers over a single registry-driven controller, service, and data-access layer. Tools return content-identity metadata (size, ETag, SHA-256) so a local agent can compare a project's existing assets against the remote and pull updated versions.

This feature adds no new AWS infrastructure or IAM to the stack: it reuses the configured S3 buckets, existing outbound access, and admin-managed permissions.

## Glossary

- **Agent asset**: An example AI-assistant enhancement file (steering document, hook, AGENTS.md, or future type) hosted for reuse.
- **Asset type**: A category of agent asset (`steering`, `hooks`, `agents-md`; future `skills`), mapped to an S3 subfolder.
- **Registry**: The single `AGENT_ASSET_TYPES` configuration that drives tool generation, schemas, descriptions, and dispatch.
- **Namespace**: A root-level S3 prefix within a bucket that partitions assets by org/team (default `atlantis`).
- **S3 layout**: `{bucket}/{namespace}/utilities/v2/agent_assets/{type}/{filename}`.

## Requirements

### Requirement 1: List assets of a type

**User Story:** As an AI assistant user, I want to list the available assets for a type (e.g. steering documents), so that I can discover what example assets exist before retrieving one.

#### Acceptance Criteria

1. WHEN a client calls `list_steering`, `list_hooks`, or `list_agents_md` THEN the system SHALL return the assets found under `{namespace}/utilities/v2/agent_assets/{type}/` across the configured buckets and indexed namespaces.
2. WHEN returning each asset THEN the system SHALL include `name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`, and `lastModified`.
3. WHEN no assets exist for the requested type THEN the system SHALL return an empty asset list and SHALL NOT return an error.
4. WHEN the same asset name exists in multiple buckets or namespaces THEN the system SHALL deduplicate by first occurrence in bucket-then-namespace priority order.
5. WHEN filtering only files that match the type's configured extensions THEN the system SHALL exclude any other objects under the prefix.

### Requirement 2: Retrieve a single asset with full content

**User Story:** As an AI assistant user, I want to retrieve one asset's full content, so that I can read it or install it into my project.

#### Acceptance Criteria

1. WHEN a client calls `get_steering`, `get_hooks`, or `get_agents_md` with a valid `name` THEN the system SHALL return the asset's full `content` plus `name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`, `sha256`, and `lastModified`.
2. WHEN computing `sha256` THEN the system SHALL hash the exact object bytes returned by S3.
3. IF the requested asset does not exist in any configured bucket or namespace THEN the system SHALL return an `ASSET_NOT_FOUND` error that includes the list of available asset names for that type.
4. WHEN `get_*` is invoked THEN the system SHALL return the latest object version only (no version-history browsing in this release).

### Requirement 3: Client-side comparison support

**User Story:** As an AI assistant, I want stable content identifiers exposed through the tools, so that I can compare a project's local assets to the remote without a server-side compare operation.

#### Acceptance Criteria

1. WHEN `list_*` returns assets THEN the system SHALL include `size` and `etag` for each asset so a caller can quickly detect differences.
2. WHEN `get_*` returns an asset THEN the system SHALL include `sha256` and full `content` so a caller can compute and compare its local file's hash.
3. The system SHALL NOT provide a server-side compare tool; comparison is performed by the calling agent.

### Requirement 4: S3 sourcing under the shared bucket + namespace model

**User Story:** As a self-hosted operator, I want agent assets read from the same S3 buckets and namespaces as templates and starters, so that my organization can publish and serve its own assets.

#### Acceptance Criteria

1. WHEN resolving asset locations THEN the system SHALL read from the buckets configured in `settings.s3.buckets` (`ATLANTIS_S3_BUCKETS`, default `63klabs`).
2. WHEN a bucket lacks the `atlantis-mcp:Allow=true` tag THEN the system SHALL skip that bucket and continue (brown-out) with a warning.
3. WHEN a `namespace` is provided THEN the system SHALL restrict the search to that namespace; WHEN it is omitted THEN the system SHALL search all indexed namespaces in priority order.
4. WHEN an `s3Buckets` filter is provided THEN the system SHALL restrict the search to those buckets after validating them against the configured list.
5. WHEN building an S3 key THEN the system SHALL use the layout `{namespace}/utilities/v2/agent_assets/{type}/{filename}`.
6. WHEN a bucket or namespace read fails THEN the system SHALL log the error, continue with the remaining sources, and mark the response `partialData: true` with an `errors` array.

### Requirement 5: Expandable, registry-driven, DRY design

**User Story:** As a maintainer, I want a single registry to drive all asset types, so that adding a new type (e.g. skills) requires a one-entry change rather than edits across many files.

#### Acceptance Criteria

1. The system SHALL define an `AGENT_ASSET_TYPES` registry where each entry declares the canonical `name`, tool-name `toolToken`, S3 `folder`, allowed `extensions`, and a `description`.
2. The system SHALL generate the per-type tool definitions, input schemas, extended descriptions, and JSON-RPC dispatch entries from the registry.
3. The controller, service, and data-access layers SHALL implement generic `list(assetType, …)` and `get(assetType, …)` logic shared by all types.
4. WHEN a new type is added to the registry THEN its list/get tools SHALL become available without changes to the generic controller, service, or DAO logic.
5. The registry SHALL include a ready-to-enable `skills` entry that is not exposed as tools until enabled.
6. Shared S3 helpers (`checkBucketAccess`, `getIndexedNamespaces`) SHALL be extracted into a common module used by the new DAO, without modifying the existing template and starter DAOs.

### Requirement 6: MCP protocol integration

**User Story:** As an AI assistant, I want the new tools available through the standard MCP discovery and invocation flow, so that I can call them like any other tool.

#### Acceptance Criteria

1. WHEN a client calls `tools/list` THEN the response SHALL include every generated agent-asset tool with its description and input schema.
2. WHEN a client calls `tools/call` with an agent-asset tool name THEN the router SHALL dispatch to the corresponding controller wrapper and return an MCP-formatted result.
3. WHEN a client calls the optional `list_agent_asset_types` tool THEN the system SHALL return the registry's types and per-type asset counts.
4. WHEN an unknown tool name is supplied THEN the system SHALL return a JSON-RPC "method not found" error.

### Requirement 7: Input validation and security

**User Story:** As an operator, I want tool inputs validated and path traversal prevented, so that the tools cannot be used to read outside the intended prefix.

#### Acceptance Criteria

1. WHEN a `get_*` tool is called THEN the system SHALL require a `name` that matches `^[^/\\]+$` and SHALL reject any name containing path separators.
2. WHEN validating input THEN the system SHALL accept optional `s3Buckets` and `namespace` parameters using the same shapes as the template tools and SHALL reject unknown properties.
3. WHEN constructing S3 keys THEN the system SHALL join the validated `name` only under the fixed `{namespace}/utilities/v2/agent_assets/{type}/` prefix.
4. WHEN returning remote content THEN the system SHALL treat it as untrusted text and SHALL NOT execute or evaluate it.
5. The system SHALL NOT log secrets and SHALL compute hashes using the runtime's built-in crypto without invoking a shell.

### Requirement 8: Caching

**User Story:** As an operator, I want asset listings and content cached, so that repeated calls are fast and S3 request volume stays low.

#### Acceptance Criteria

1. The system SHALL define an `s3-agent-assets` connection with `assets-list` and `asset-detail` cache profiles.
2. WHEN serving `list_*` and `get_*` THEN the system SHALL use pass-through caching keyed by asset type, name, bucket set, and namespace.
3. WHEN in a production environment THEN cache TTLs SHALL follow the same convention as the template profiles; WHEN in a test environment THEN TTLs SHALL be short for rapid iteration.

### Requirement 9: Large-asset handling (deferrable, parity with templates)

**User Story:** As an AI assistant, I want large assets to degrade gracefully like large templates, so that responses never exceed size limits.

#### Acceptance Criteria

1. WHEN a `get_*` response exceeds the configured size threshold THEN the system SHALL return a summary with `contentTruncated: true` and `totalChunks`, mirroring `get_template`.
2. WHEN a summary is returned THEN a `get_agent_asset_chunk` tool SHALL allow retrieving the full content by zero-based `chunkIndex`.
3. IF `chunkIndex` is out of range THEN the system SHALL return an `INVALID_CHUNK_INDEX` error with the valid range.

*(This requirement may be delivered after the core tools; current assets fit well under the threshold.)*

### Requirement 10: Documentation and configuration

**User Story:** As a user and operator, I want the new tools documented and safe to auto-approve, so that I can adopt them quickly.

#### Acceptance Criteria

1. The system's end-user tools reference SHALL document each new tool with its parameters, example prompts, use cases, the `63klabs`/`atlantis` bucket-and-namespace note, and the client-side compare workflow, and SHALL list the `ASSET_NOT_FOUND` error code.
2. The Kiro integration guide's `autoApprove` example SHALL include the new read-only agent-asset tools.
3. The admin-ops documentation SHALL describe the `{namespace}/utilities/v2/agent_assets/{type}/` layout and note that prefix-scoped admin IAM policies must add `utilities/v2/*`.
4. The developer documentation and `ARCHITECTURE.md` SHALL describe the registry-driven flow and how to add a new asset type.
5. `CHANGELOG.md` SHALL record the feature under `v0.0.6 (unreleased)` referencing the spec.
6. The feature SHALL NOT add new AWS infrastructure or IAM to the stack template; publishing assets to S3 is owned by the source repository and is out of scope here.

### Requirement 11: Testing and verification

**User Story:** As a maintainer, I want the feature covered by tests in the existing framework, so that it is safe to deploy through CI/CD.

#### Acceptance Criteria

1. New tests SHALL follow the read-function's existing Jest `*.test.js` layout under `tests/unit/<layer>/` and `tests/integration/`.
2. WHEN the DAO is tested THEN S3 access SHALL be mocked to verify listing, retrieval, `sha256` correctness, `ASSET_NOT_FOUND`, brown-out, and path-traversal rejection.
3. WHEN the router is tested THEN an integration test SHALL verify the new tools appear in `tools/list` and that `tools/call` for a list and a get returns the expected content and hashes.
4. All new and existing tests SHALL pass before the change is considered complete.
