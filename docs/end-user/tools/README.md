# MCP Tools Reference

This document provides detailed information about each MCP tool available through the Atlantis MCP Server.

## Table of Contents

- [list_tools](#list_tools)
- [list_categories](#list_categories)
- [list_templates](#list_templates)
- [get_template](#get_template)
- [get_template_chunk](#get_template_chunk)
- [list_template_versions](#list_template_versions)
- [check_template_updates](#check_template_updates)
- [list_starters](#list_starters)
- [get_starter_info](#get_starter_info)
- [list_agent_assets](#list_agent_assets)
- [get_agent_asset](#get_agent_asset)
- [list_agent_asset_types](#list_agent_asset_types)
- [search_documentation](#search_documentation)
- [get_document](#get_document)
- [get_document_chunk](#get_document_chunk)
- [validate_naming](#validate_naming)

---

## list_tools

Retrieve the complete catalog of MCP tools supported by this server, including each tool's name, description, and input schema. Use this as the first call in a session to discover available capabilities. Returns an empty array if no tools are configured on the server.

### Input Parameters

None.

### Example Usage

```
Ask your AI: "What tools does the Atlantis MCP server provide?"
```

### Use Cases

- Discover all available tools at the start of a session
- Review tool input schemas for parameter details

---

## list_categories

List all available template categories with their descriptions and template counts. Takes no parameters. Returns an empty array if no categories are configured. Use this to discover which categories are available before calling `list_templates` or `get_template`.

### Input Parameters

None.

### Example Usage

```
Ask your AI: "What template categories are available?"
```

### Use Cases

- Discover how templates are organized
- Understand available infrastructure types before browsing templates

---

## list_templates

List all CloudFormation templates available for deployment via Atlantis scripts, filtered by category, version, or S3 bucket. Categories include: **storage**, **network**, **pipeline**, **service-role**, and **modules**. Returns template metadata such as name, version, category, description, namespace, and S3 location. Returns an empty array if no templates match the specified filters. Use the `category` parameter to narrow results when you know the resource type you need.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by template category (storage, network, pipeline, service-role, modules) |
| `version` | string | No | Filter by Human_Readable_Version (e.g., "v1.2.3/2024-01-15") |
| `versionId` | string | No | Filter by S3 version ID |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**List all templates:**
```
Ask your AI: "Show me all available CloudFormation templates"
```

**Filter by category:**
```
Ask your AI: "Show me storage templates"
```

**Filter by version:**
```
Ask your AI: "Show me templates version v2.0.18"
```

### Use Cases

- Discover available templates for your infrastructure needs
- Browse templates by category (pipeline, storage, network, etc.)
- Find specific template versions

---

## get_template

Retrieve a specific CloudFormation template with its full content, parameters, outputs, version information, and S3 location. Requires both `templateName` and `category` parameters. Returns an error if either required parameter is missing or if the template is not found in the specified category. Optionally pass `version` or `versionId` to fetch a specific version rather than the latest.

If the template is too large to return in a single response, a summary is returned instead with `contentTruncated: true` and `totalChunks` indicating how many chunks the content was split into. Use `get_template_chunk` to retrieve the full content incrementally.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template to retrieve |
| `category` | string | Yes | Template category (storage, network, pipeline, service-role, modules) |
| `version` | string | No | Human_Readable_Version (e.g., "v1.2.3/2024-01-15") |
| `versionId` | string | No | S3 version ID for a specific version |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |

> **Note:** If both `version` and `versionId` are provided, they are treated as an OR condition (returns template matching either).

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**Get latest version:**
```
Ask your AI: "Get the pipeline template"
```

**Get specific version:**
```
Ask your AI: "Get template-pipeline.yml version v2.0.18"
```

### Use Cases

- Review template content before deployment
- Compare template versions
- Extract parameter definitions
- Understand template outputs

---

## get_template_chunk

Retrieve a specific chunk of a large CloudFormation template that was too large to return in a single `get_template` response. Requires `templateName`, `category`, and `chunkIndex` (zero-based integer) parameters. Returns an error if any required parameter is missing, if the template is not found, or if `chunkIndex` is out of range. The response includes `chunkIndex`, `totalChunks`, `templateName`, `category`, and the chunk `content` as a text string. Optionally pass `version`, `versionId`, `s3Buckets`, or `namespace` to target a specific template version. Use this tool after receiving a truncated `get_template` response to retrieve the full content incrementally.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template to retrieve |
| `category` | string | Yes | Template category (storage, network, pipeline, service-role, modules) |
| `chunkIndex` | integer | Yes | Zero-based index of the chunk to retrieve |
| `version` | string | No | Human_Readable_Version (e.g., "v1.2.3/2024-01-15") |
| `versionId` | string | No | S3 version ID for a specific version |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |
| `namespace` | string | No | Filter to a specific namespace (S3 root prefix) |

### Example Usage

```
Ask your AI: "The pipeline template was truncated. Get chunk 0 of template-pipeline.yml from the pipeline category"
```

### Use Cases

- Retrieve full content of large templates that exceeded the single-response size limit
- Incrementally fetch template content chunk by chunk

---

## list_template_versions

List all available versions of a specific CloudFormation template, returning version history with Human_Readable_Version, S3_VersionId, last modified date, and size. Requires both `templateName` and `category` parameters. Returns an error if either required parameter is missing or if the template does not exist. Use this to compare versions before upgrading or to find a specific historical version.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template |
| `category` | string | Yes | Template category (storage, network, pipeline, service-role, modules) |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

```
Ask your AI: "Show me all versions of the pipeline template"
```

### Use Cases

- Track template evolution over time
- Find specific versions for rollback
- Compare version metadata
- Audit template changes

---

## check_template_updates

Check whether newer versions are available for a CloudFormation template and return update information including version, release date, changelog, and migration guide links for breaking changes. Requires `templateName`, `category`, and `currentVersion` parameters. Returns an error if any required parameter is missing or if the template is not found. Pass the `currentVersion` as a Human_Readable_Version string (e.g., `v1.2.3/2024-01-15`), Short_Version (e.g., `v1.2.3`), or S3_VersionId to compare against the latest available version.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateName` | string | Yes | Name of the template to check |
| `category` | string | Yes | Template category (storage, network, pipeline, service-role, modules) |
| `currentVersion` | string | Yes | Current version you're using (e.g., "v1.2.3/2024-01-15") |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**Check single template:**
```
Ask your AI: "Check if template-pipeline.yml v2.0.17 has updates"
```

**Check multiple templates:**
```
Ask your AI: "Check for updates on all my templates"
```

### Use Cases

- Stay current with template improvements
- Plan template upgrades
- Identify breaking changes before upgrading
- Review changelogs and migration guides

---

## list_starters

List all available application starter code repositories with metadata including name, description, languages, frameworks, features, and S3 location. Starters provide CloudFormation templates, build specs, and Lambda function code for bootstrapping new projects. Returns an empty array if no starters match the specified filters. Optionally filter by `s3Buckets` or `namespace`.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |
| `namespace` | string | No | Filter to a specific namespace (S3 root prefix) |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**List all starters:**
```
Ask your AI: "Show me available application starters"
```

### Use Cases

- Find starter code for new projects
- Discover pre-configured application templates
- Identify starters with specific integrations
- Bootstrap new serverless applications

---

## get_starter_info

Retrieve detailed information about a specific starter code repository, including languages, frameworks, features, prerequisites, and S3 location. Requires the `starterName` parameter. Returns an error if `starterName` is missing or if no starter matches the given name. Use this after `list_starters` to get full details on a specific starter before initializing a project.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `starterName` | string | Yes | Name of the starter repository |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |
| `namespace` | string | No | Filter to a specific namespace (S3 root prefix) |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

```
Ask your AI: "Tell me about the atlantis-starter-02 repository"
```

### Use Cases

- Understand starter capabilities before using
- Review prerequisites and setup requirements
- Access example code snippets
- Check latest release information

---

## list_agent_assets

List available Kiro agent assets — reusable example steering documents, hooks, and AGENTS.md files (and other AI-assistant enhancement examples) — optionally filtered by asset type, S3 bucket, or namespace. Supported `assetType` values are the currently enabled types: `steering`, `hooks`, and `agents-md`. The registry also defines a `skills` type, but it is disabled by default and is not a valid `assetType` value until an administrator enables it — use `list_agent_asset_types` to discover the enabled values dynamically rather than hardcoding them. When `assetType` is omitted, results span every enabled type. Returns metadata for each matching asset (`name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`, `lastModified`) but not `content` — use `get_agent_asset` to retrieve an asset's full content. Returns an empty array, not an error, when no assets match the specified filters.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetType` | string | No | Filter to a specific agent asset type: `steering`, `hooks`, or `agents-md`; omit to list across all enabled types |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |
| `namespace` | string | No | Filter to a specific namespace (S3 root prefix) |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

### Example Usage

**List all agent assets:**
```
Ask your AI: "Show me available Kiro steering documents"
```

**Filter by type:**
```
Ask your AI: "List all Kiro hooks available from Atlantis"
```

### Use Cases

- Discover reusable steering documents before starting a new project
- Browse available hooks by type before deciding which to pull in
- Check an AGENTS.md file's `size`/`etag`/`lastModified` without downloading its content

---

## get_agent_asset

Retrieve one Kiro agent asset's full content by `assetType` and `name`. Both parameters are required; supported `assetType` values are the currently enabled types: `steering`, `hooks`, and `agents-md`. `name` is the exact filename (e.g. `product-guidelines.md`) with no path separators. Returns the asset's `content` together with `name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`, `sha256`, and `lastModified`. Returns an `ASSET_NOT_FOUND` error listing the available asset names for that type when `name` does not exist for the requested `assetType`.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetType` | string | Yes | Agent asset type to retrieve from: `steering`, `hooks`, or `agents-md` |
| `name` | string | Yes | Filename of the agent asset (no path separators), e.g. "product-guidelines.md" |
| `s3Buckets` | array[string] | No | Filter to specific S3 buckets from configured list |
| `namespace` | string | No | Filter to a specific namespace (S3 root prefix) |

> **Note:** `63klabs` is the only bucket and `atlantis` is the only namespace available via the public Atlantis MCP server. If your organization hosts its own Atlantis MCP server there may be additional namespaces and S3 buckets available.

> **Tip — keeping a local copy in sync:** If you maintain a local copy of a steering document, hook, or AGENTS.md file, compare its cached `size` and `etag` (from a prior `list_agent_assets` or `get_agent_asset` call) against the latest response before overwriting it. For a stronger check, compute the SHA-256 of your local file's bytes and compare it to the returned `sha256` — a match means your local copy is already current and no re-fetch or overwrite is needed.

### Example Usage

```
Ask your AI: "Get the product-guidelines.md steering document"
```

### Use Cases

- Pull a steering document into a new repository
- Retrieve a hook definition to install locally
- Check whether a local copy of an AGENTS.md file is out of date using `sha256` comparison

---

## list_agent_asset_types

List every enabled Kiro agent asset type together with a count of the assets discoverable for that type across the configured S3 buckets and indexed namespaces. Takes no parameters. Returns an empty list if no asset types are enabled. Use the returned `name` values as the `assetType` argument to `list_agent_assets` and `get_agent_asset`.

### Input Parameters

None.

### Example Usage

```
Ask your AI: "What types of agent assets are available?"
```

### Use Cases

- Discover which asset types are enabled before calling `list_agent_assets`
- See how many assets exist per type before deciding what to browse
- Confirm a type like `skills` is not yet enabled on this server

---

## search_documentation

Search Atlantis documentation, tutorials, and code patterns by keyword. Returns results with title, excerpt, file path, GitHub URL, and result type. Requires the `query` parameter. Returns an empty array if no documents match the query. All filters are optional: `type` and `subType` narrow the result set, and `ghusers` narrows to specific GitHub organizations.

> **Tip:** On servers where it is enabled, eligible (paid/private) tiers receive results ranked by meaning rather than exact keywords — using the same tool and the same response shape. See [Semantic Documentation Search](semantic-search.md).

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search keywords |
| `type` | string | No | Filter by result type: `documentation`, `template-pattern`, `code-example` |
| `subType` | string | No | Filter by result subtype: `guide`, `function`, `parameter` |
| `ghusers` | array[string] | No | Filter to specific GitHub users/orgs from configured list |

### Response Fields

Each result includes `title`, `excerpt`, `filePath`, `githubUrl`, `type`, `subType`, `relevanceScore`, `repository`, `repositoryType`, and `namespace`. `githubUrl`, `repositoryType`, and `namespace` may be `null` for entries indexed before those fields were populated.

The envelope also includes:

- **`availableFilters`** (optional) — the distinct `type` and `subType` values present in the matched set, with counts, e.g. `{ "type": [{ "value": "documentation", "count": 22 }], "subType": [...] }`. Use these values directly as `type`/`subType` filters on a follow-up query. Absent when there is nothing to report (e.g. zero results).
- **`suggestions`** — used for zero-result guidance as before, and also gains a "narrow the search with a type or subType filter" hint when the matched set is large, pointing you at `availableFilters`.

### Example Usage

**General search:**
```
Ask your AI: "Search documentation for DynamoDB caching"
```

**Filter by type:**
```
Ask your AI: "Find code examples for Lambda functions"
```

**Narrow a broad result set:**
```
Ask your AI: "That search had too many results — narrow it to type template-pattern"
```

### Use Cases

- Find implementation guidance
- Discover code patterns and examples
- Locate troubleshooting information
- Learn best practices
- Find CloudFormation resource patterns
- Narrow a broad result set using the `availableFilters` values from a prior search

---

## get_document

Retrieve the complete source file behind a `search_documentation` result, rather than the excerpt. Supply exactly one lookup key: the `filePath` (contentPath) from a search result, or a section `hash` (16 hexadecimal characters). A section-level key resolves to the file that contains it, so the response is the whole source file in document order, not just the matched section.

Retrieval is **storage-only** — the server never fetches from GitHub. If the document is not currently in the index, the tool returns an error that identifies what you asked for and includes the file-level `githubUrl` (when it can be derived) so you can fetch the file yourself. `get_document` requires no elevated tier and works the same whether or not semantic search is enabled.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | One of `filePath`/`hash` | contentPath from a search result (e.g., `{org}/{repo}/{filePath}/{slug}`) |
| `hash` | string | One of `filePath`/`hash` | Section content hash (16 hexadecimal characters) |

Supply exactly one of `filePath` or `hash` — providing both, or neither, is rejected.

### Response Fields

| Field | Description |
|-------|-------------|
| `filePath` | The resolved file path the content came from |
| `githubUrl` | File-level GitHub URL, or `null` when it could not be derived |
| `repository` | Repository name |
| `repositoryType` | Repository classification (e.g., `documentation`, `template`), or `null` |
| `namespace` | Repository namespace, or `null` |
| `content` | The raw source file text |

If the document exceeds the response size limit, a summary is returned instead with `contentTruncated: true`, `totalChunks`, and a `retrievalHint` describing how to use `get_document_chunk`.

### Storage-miss behavior

When the document isn't in storage, `get_document` returns a `DOCUMENT_NOT_FOUND` error carrying the requested `filePath`/`hash` and the file-level `githubUrl` (or `null` when no URL could be derived). The server does not attempt to fetch the file from GitHub on your behalf — use the returned `githubUrl` to fetch it directly.

### Example Usage

```
Ask your AI: "Get the full source file for that last search result"
```

### Use Cases

- Read the full context around an excerpt that looked relevant
- Retrieve a document by the `filePath` or `hash` returned from `search_documentation`
- Fall back to fetching from GitHub yourself when a document isn't indexed yet

---

## get_document_chunk

Retrieve a specific chunk of a large document that was too large to return in a single `get_document` response. Takes the same lookup key as `get_document` (exactly one of `filePath` or `hash`) plus a required zero-based `chunkIndex`.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | One of `filePath`/`hash` | contentPath from a search result (e.g., `{org}/{repo}/{filePath}/{slug}`) |
| `hash` | string | One of `filePath`/`hash` | Section content hash (16 hexadecimal characters) |
| `chunkIndex` | integer | Yes | Zero-based index of the chunk to retrieve |

### Response Fields

The response includes `chunkIndex`, `totalChunks`, `filePath`, and the chunk `content` as a text string.

Returns an `INVALID_CHUNK_INDEX` error if `chunkIndex` is out of range, or a `DOCUMENT_NOT_FOUND` error (same shape as `get_document`) if the document is no longer in storage.

### Example Usage

```
Ask your AI: "That document was truncated. Get chunk 0"
```

### Use Cases

- Retrieve the full content of a large document that exceeded the single-response size limit
- Incrementally fetch document content chunk by chunk, concatenating chunks `0` through `totalChunks - 1` to reassemble the full document

---

## validate_naming

Validate a resource name against Atlantis naming conventions and return parsed components with any validation errors. Supports S3 bucket patterns (regional with `-an` suffix, global with AccountId-Region, and simple global), as well as application, DynamoDB, Lambda, CloudFormation, and service-role resource types. The `service-role` type validates names against the pattern `PREFIX-ProjectId-ResourceSuffix` where PREFIX must be ALL CAPS (uppercase letters and digits only) and no StageId is present. Unrecognized resource types are validated using the standard application resource pattern (`Prefix-ProjectId-StageId-ResourceSuffix`). Requires the `resourceName` parameter. Returns a validation error if the name does not conform to any recognized pattern. When resource names contain hyphenated components, supply known values such as `prefix`, `projectId`, or `stageId` for accurate parsing. Set `isShared` to true for shared resources that omit StageId, and `hasOrgPrefix` to true when the S3 bucket includes an organization prefix segment.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resourceName` | string | Yes | Resource name to validate |
| `resourceType` | string | No | Type of AWS resource. `s3` and `service-role` have special validation patterns; all other values use standard application resource validation (`Prefix-ProjectId-StageId-ResourceSuffix`). |
| `isShared` | boolean | No | When true, validates as a shared resource without a StageId component (e.g., `Prefix-ProjectId-ResourceSuffix`) |
| `hasOrgPrefix` | boolean | No | When true, indicates the S3 bucket name includes an organization prefix segment |
| `prefix` | string | No | Known Prefix value for disambiguation of hyphenated components |
| `projectId` | string | No | Known ProjectId value for disambiguation of hyphenated components |
| `stageId` | string | No | Known StageId value for disambiguation of hyphenated components |
| `orgPrefix` | string | No | Known OrgPrefix value for disambiguation of hyphenated components |

### Example Usage

**Validate application resource:**
```
Ask your AI: "Validate this name: acme-person-api-test-GetPersonFunction"
```

**Validate S3 bucket:**
```
Ask your AI: "Is this S3 bucket name valid: acme-myapp-test-123456789012-us-east-1-an"
```

**Validate with known components:**
```
Ask your AI: "Validate acme-my-app-test-Users with prefix acme and projectId my-app"
```

### Use Cases

- Verify resource names before deployment
- Ensure naming convention compliance
- Parse resource names into their components
- Validate S3 bucket names across all three patterns
- Check service-role naming with ALL CAPS prefix

---

## Error Responses

All tools return errors in a consistent format:

```json
{
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "Template 'invalid-template.yml' not found",
    "details": {
      "availableTemplates": ["template-pipeline.yml", "template-storage.yml"]
    },
    "requestId": "abc-123-def-456"
  }
}
```

Common error codes:
- `INVALID_INPUT` - Input validation failed
- `TEMPLATE_NOT_FOUND` - Requested template doesn't exist
- `STARTER_NOT_FOUND` - Requested starter doesn't exist
- `ASSET_NOT_FOUND` - Requested agent asset doesn't exist
- `DOCUMENT_NOT_FOUND` - Requested document isn't in storage; the error includes `githubUrl` (or `null`) so the client can fetch it directly
- `INVALID_CHUNK_INDEX` - `chunkIndex` passed to `get_document_chunk` (or `get_template_chunk`/`get_agent_asset_chunk`) is out of range
- `RATE_LIMIT_EXCEEDED` - Too many requests (HTTP 429)
- `INTERNAL_ERROR` - Server error (HTTP 500)

---

## Rate Limiting

All tools are subject to rate limiting. Limits vary by tier — see the [rate limits page](https://mcp.atlantis.63klabs.net/docs/rate-limits/) for the full breakdown.

- Rate limit headers included in all responses
- HTTP 429 returned when exceeded

---

## Related Documentation

- [Semantic Documentation Search](semantic-search.md) - Meaning-ranked `search_documentation` results for eligible tiers
- [Integration Guides](../integration/README.md) - Set up your AI assistant
- [Common Use Cases](../use-cases/README.md) - Practical examples
- [Troubleshooting](../troubleshooting/README.md) - Common issues and solutions

## Support

If you need help with a specific use case:

- Documentation: [Full Docs on GitHub](https://github.com/63klabs/atlantis-mcp)
- GitHub Issues: [Report Issue](https://github.com/63klabs/atlantis-mcp/issues)
