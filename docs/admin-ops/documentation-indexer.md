# Documentation Indexer

## Overview

The Documentation Indexer is a scheduled Lambda function that builds a persistent DynamoDB-backed search index from GitHub repositories. It discovers repositories for configured organizations/users, downloads zip archives, extracts content (Markdown, JSDoc, Python docstrings, CloudFormation parameters), and stores indexed entries in a DynamoDB table.

The indexer runs on a configurable EventBridge schedule and uses blue-green versioned deployments so the Read Lambda always queries a complete, consistent index.

## Prerequisites

- AWS CLI configured with appropriate permissions
- Access to the AWS account where the application is deployed
- A GitHub account with access to the repositories you want indexed

## GitHub personal access token setup

The indexer authenticates with the GitHub API using a Personal Access Token (PAT) stored in AWS SSM Parameter Store.

### Creating the token

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give the token a descriptive name (e.g., "Atlantis Doc Indexer")
4. Select the following scopes:
   - `public_repo` — read access to public repositories
   - `read:org` — read access to organization membership (required to list org repositories)
5. Set an appropriate expiration (recommend 90 days, then rotate)
6. Click "Generate token" and copy the value immediately

### Storing the token in SSM Parameter Store

The deployment pipeline creates the SSM parameter with a blank value. You only need to update the value.

The parameter path follows the pattern:

```
{ParameterStoreHierarchy}GitHubToken
```

Where `{ParameterStoreHierarchy}` is the value of the `ParameterStoreHierarchy` CloudFormation parameter for your stack. The default hierarchy is `/`, which produces a path like:

```
/{DeployEnvironment}/{Prefix}-{ProjectId}-{StageId}/GitHubToken
```

Update the parameter value using the AWS CLI:

```bash
aws ssm put-parameter \
  --name "/{DeployEnvironment}/{Prefix}-{ProjectId}-{StageId}/GitHubToken" \
  --value "ghp_your_token_here" \
  --type SecureString \
  --overwrite
```

For example, for a production deployment with prefix `acme`, project `atlantis-mcp`, and stage `prod`:

```bash
aws ssm put-parameter \
  --name "/PROD/acme-atlantis-mcp-prod/GitHubToken" \
  --value "ghp_your_token_here" \
  --type SecureString \
  --overwrite
```

> **Note**: The parameter is created as a `SecureString` with value `BLANK` during the initial deployment via the `generate-put-ssm.py` build script. The script will not overwrite an existing parameter, so subsequent deployments leave your token intact. You only need to set the value once (and again when rotating).

## Blue-green index versioning

The indexer uses a blue-green versioning strategy to ensure the Read Lambda always queries a complete index, even while a new index is being built.

### How it works

1. The indexer generates a new version identifier (timestamp-based, e.g., `20250715T060000`)
2. All new content entries, keyword entries, and the main index are written under the new version
3. Only after all writes succeed does the indexer atomically update the version pointer to the new version
4. The previous version is retained with a 7-day TTL for automatic cleanup

If the build fails at any point, the version pointer remains on the previous version. The Read Lambda continues serving results from the last successful build without interruption.

### Rollback procedure

To roll back to a previous index version:

1. Query the current version pointer to find the previous version:

```bash
aws dynamodb get-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-DocIndex" \
  --key '{"pk": {"S": "version:pointer"}, "sk": {"S": "active"}}'
```

The response includes both `version` (current) and `previousVersion` fields.

2. Update the version pointer to the previous version:

```bash
aws dynamodb put-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-DocIndex" \
  --item '{
    "pk": {"S": "version:pointer"},
    "sk": {"S": "active"},
    "version": {"S": "PREVIOUS_VERSION_HERE"},
    "previousVersion": {"S": "CURRENT_VERSION_HERE"},
    "updatedAt": {"S": "2025-07-15T06:00:00Z"}
  }'
```

> **Important**: Previous version entries have a 7-day TTL. Rollback is only possible within that window. After TTL expiration, DynamoDB automatically deletes the old version entries.

### Manual re-index

To trigger a manual re-index outside the schedule, invoke the Lambda directly:

```bash
aws lambda invoke \
  --function-name "{Prefix}-{ProjectId}-{StageId}-DocIndexer" \
  --invocation-type Event \
  output.json
```

## DynamoDB schema

All data is stored in a single table (`{Prefix}-{ProjectId}-{StageId}-DocIndex`) using a composite primary key with partition key `pk` (String) and sort key `sk` (String). TTL is enabled on the `ttl` attribute.

### Key patterns

| pk | sk | Purpose |
|:---|:---|:--------|
| `version:pointer` | `active` | Points to the currently active index version |
| `mainindex:{version}` | `entries` | Main index for a specific version containing all indexed items |
| `content:{hash}` | `v:{version}:metadata` | Metadata for a content entry (path, type, title, keywords, etc.) |
| `content:{hash}` | `v:{version}:content` | Full extracted content text |
| `search:{keyword}` | `v:{version}:{hash}` | Keyword-to-content mapping with relevance score |
| `corpus:{version}` | `manifest` | Per-repository corpus manifest (name, owner, repository type, resolution, namespace, section count, ref) backing the `indexedRepositories` response field |

### Version pointer

```json
{
  "pk": "version:pointer",
  "sk": "active",
  "version": "20250715T060000",
  "previousVersion": "20250714T060000",
  "updatedAt": "2025-07-15T06:15:00Z"
}
```

### Main index entry

The main index stores an array of all indexed items for a given version. Each item includes the content hash, path, type, title, repository, owner, keywords, and last indexed timestamp. The `entryCount` field provides a quick count without parsing the full array.

### Content entries

Each piece of indexed content is stored as two items sharing the same `pk`:

- `v:{version}:metadata` — contains path, type, subType, title, excerpt, repository, owner, keywords, relevance weights, and timestamps
- `v:{version}:content` — contains the full extracted content text

The `{hash}` in the pk is a 16-character hex string derived from SHA-256 hashing of the content path.

### Search keyword entries

Keyword entries map search terms to content hashes with pre-computed relevance scores. The Read Lambda queries these entries to find matching content and sorts results by relevance.

Relevance scoring weights:

| Match type | Weight |
|:-----------|:-------|
| Title keyword match | +10 |
| Excerpt keyword match | +5 |
| General keyword match | +3 |
| Exact phrase match bonus | +20 |

Content type weights are applied as multipliers:

| Content type | Weight |
|:-------------|:-------|
| documentation | 1.0 |
| template-pattern | 0.9 |
| code-example | 0.8 |

## Repository classification and the `atlantis_repository-type` prerequisite

The indexer and the Read Lambda apply per-repository behavior — file exclusions during indexing, and relevance weighting during search — based on each repository's GitHub custom property **`atlantis_repository-type`**. Setting this property is an **operational prerequisite performed on GitHub, not a code change in this repository**: an administrator sets a custom property value on each organization repository through GitHub's repository settings (or the GitHub API/CLI), and the indexer picks it up on its next build.

> **Important**: This repository's code does not set `atlantis_repository-type` on any GitHub repository. Per-type exclusions and ranking weighting only behave as intended once an administrator has set the property on the organization's indexed repositories. A repository with no property set is handled safely (see *Absent* below) but does not receive type-specific treatment.

### Valid values

| Value | Typical repository |
|:------|:--------------------|
| `documentation` | Platform or reference documentation repositories |
| `app-starter` | Application starter/bootstrap repositories |
| `templates` | CloudFormation template repositories |
| `management` | Internal management/tooling repositories |
| `package` | Published npm/pip packages consumed by Atlantis applications, e.g. `cache-data` |
| `mcp` | MCP server repositories |

### Three-state resolution

For each repository, the indexer resolves `atlantis_repository-type` into one of three distinguishable states rather than collapsing two of them into a single empty value:

| State | Meaning | How it arises |
|:------|:--------|:---------------|
| **resolved** | The property is set to one of the valid values above. | The custom-properties API call succeeded and returned a non-empty value for `atlantis_repository-type`. |
| **absent** | The property is genuinely unset on the repository. | The call succeeded (GitHub returned a properties array, even an empty one) but `atlantis_repository-type` was not present in it. |
| **fetch-failed** | The true value is unknown. | The custom-properties API call errored, 404'd, or timed out. The indexer cannot distinguish "not set" from "could not check" without this third state. |

Resolving the property never throws and never fails an index build — a GitHub API hiccup degrades gracefully rather than blocking the scheduled build.

### Per-repository-type file exclusion matrix

File exclusions (the same global exclusion list described in the main `EXCLUDED_FILES` behavior — `LICENSE.md`, `CONTRIBUTING.md`, `CONTRIBUTE.md`, `CHANGELOG.md`, `SECURITY.md`) are applied per repository type rather than as one fixed global set:

| Classification | Exclusion policy |
|:----------------|:-------------------|
| `package` | Global exclusions **minus `CHANGELOG.md`** — a package's changelog is deliberately kept searchable, since version and migration questions depend on it (e.g. "what changed in cache-data v1.3?"). |
| `documentation`, `templates`, `app-starter`, `mcp`, `management` | Full global exclusions. |
| *absent* | **No file-name exclusions at all.** A repository with no `atlantis_repository-type` set is never penalized for an operational omission — it is indexed as broadly as possible rather than silently narrowed. |
| *fetch-failed* | **Carries forward** the repository's classification from the previous index build's corpus manifest. If no previous resolution exists (e.g. a brand-new repository whose first build hit a fetch failure), the full global exclusion set applies as the default. |

`AGENTS.md` is excluded for every repository regardless of classification — it is served instead through the `agents-md` [agent asset tool](../developer/agent-asset-tools.md), so indexing it would duplicate the same guidance on two surfaces with different freshness.

**Determinism guarantee**: two builds over identical repository content with identical successfully-resolved properties index an identical set of files for that repository, including when one of the two builds experienced a transient fetch failure that was carried forward to the previously-resolved classification.

### Relevance weighting

Repository type also weights keyword-path search relevance: a section from a `package` or `documentation` repository is not outranked by an incidental, lower-value match from an unrelated repository at equal textual relevance. Repositories with an *absent* or *fetch-failed* classification receive a neutral weight — never penalized for a missing property.

## Corpus manifest size budget

Every `search_documentation` response includes an `indexedRepositories` block listing every repository currently in the index (see the [end-user tools reference](../end-user/tools/README.md#search_documentation) for the response shape and a discover-then-filter example). The size of this block is governed by an environment variable:

| Variable | Default | Description |
|:---------|:--------|:--------------|
| `MCP_CORPUS_MANIFEST_MAX_BYTES` | `4096` (4 KB) | Maximum serialized byte size of the `indexedRepositories` block. |

When the full listing (name, owner, repository type, namespace, section count, and ref per repository) would exceed this budget, the block degrades to a `compact` listing (name and repository type only), and if that still exceeds the budget, degrades further to a `count` summary (`{ "repositoryCount": N, "omitted": true }`). This degradation ladder is evaluated against the manifest's own budget first, and then re-checked together with the rest of the response against the overall response size threshold — the manifest is always degraded (or omitted) before any of the caller's requested search results are truncated.

Raise `MCP_CORPUS_MANIFEST_MAX_BYTES` if your organization indexes a large number of repositories and wants the full per-repository listing to keep appearing on every response rather than degrading to `compact` or `count`.

## Schedule configuration

The indexer schedule is controlled by two CloudFormation parameters:

| Parameter | Default | Environment |
|:----------|:--------|:------------|
| `DocIndexScheduleForPROD` | `cron(0 6 * * ? *)` (daily at 06:00 UTC) | Production |
| `DocIndexScheduleForDEVTEST` | `cron(0 8 ? * MON *)` (weekly Monday at 08:00 UTC) | Non-production |

Update these parameters in your SAM configuration to adjust the schedule.

## Monitoring

The indexer emits structured log messages to CloudWatch Logs. Key log events:

- `index_build_start` — build initiated with version and org list
- `repos_discovered` — repositories found per organization
- `entries_indexed` — total entries indexed with duration
- `index_build_success` — build completed successfully
- `index_build_failure` — build failed with error details

A CloudWatch Alarm monitors the indexer for errors (Sum > 1 over a 900-second period) and sends notifications via SNS to the configured `AlarmNotificationEmail`. This alarm is only created in production environments.

## Related documentation

- [Atlantis DevOps Platform](https://github.com/63klabs/atlantis)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub custom properties documentation](https://docs.github.com/en/organizations/managing-organization-settings/managing-custom-properties-for-repositories-in-your-organization) — how to set `atlantis_repository-type` on an organization repository
- [search_documentation tool reference](../end-user/tools/README.md#search_documentation) — the `repository`/`repositoryType`/`namespace` filters and `indexedRepositories` response field this classification feeds
- [Tool Metadata Registry and search-common layer](../developer/tool-discovery.md) — developer-facing architecture of the discovery enhancements
