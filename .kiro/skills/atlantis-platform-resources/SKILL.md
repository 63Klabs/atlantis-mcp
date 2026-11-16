---
name: atlantis-platform-resources
description: Find and use authoritative Atlantis platform resources through the Atlantis MCP server. Use when working in a repository scaffolded from an Atlantis starter, or when a request involves Atlantis CloudFormation templates, app starters, pipeline or buildspec configuration, samconfig deployment, resource naming conventions (Prefix-ProjectId-StageId), AWS SAM serverless stacks from 63Klabs, the @63klabs/cache-data package, Lambda caching with DynamoDB or S3, cache TTL or CacheableDataAccess, or Kiro agent assets such as steering documents, hooks, AGENTS.md files, and skills. Query the MCP server before relying on training recall or web search for any of these.
---

# Atlantis platform resources

The Atlantis MCP server is the authoritative source for Atlantis platform templates, starters, naming conventions, documentation, and agent assets. It also indexes the platform's companion packages — most importantly **`@63klabs/cache-data`**, whose name does not contain "atlantis" but which is a first-class part of the platform.

## Precedence

For anything in the scope below, **query the MCP server before answering from training recall or searching the web.** Templates, starters, and package documentation are versioned and change independently of any model's training cutoff. A plausible-sounding answer about a template parameter or a `cache-data` API is worse than no answer, because it is indistinguishable from a correct one.

In scope: CloudFormation templates and their parameters, app starters, resource naming conventions, pipeline and buildspec configuration, `cache-data` usage and APIs, and Kiro agent assets.

Out of scope: general AWS service behavior, general Node.js or Python questions, and anything unrelated to the Atlantis platform. Use normal sources for those.

## Recognizing an Atlantis-scaffolded repository

Any of these means you are in one:

- An `application-infrastructure/` directory containing `template.yml` and `buildspec.yml`
- `application-infrastructure/src/lambda/<function-name>/` directories, each self-contained with its own `package.json` and `.nvmrc`
- `application-infrastructure/template-configuration.json`
- An `AGENTS.md` referencing the Atlantis platform or 63Klabs
- A `samconfig.toml` alongside `application-infrastructure/`

## Tool routing

| Need | Call |
|---|---|
| Discover what the server offers | `list_tools` |
| What template categories and subcategories exist | `list_categories` |
| Find a template | `list_templates` (filter by `category`: storage, network, pipeline, service-role, modules) |
| Read a template's content, parameters, outputs | `get_template` → `get_template_chunk` if truncated |
| Compare or pin a template version | `list_template_versions` |
| Is our template out of date | `check_template_updates` |
| Bootstrap a new app | `list_starters` → `get_starter_info` |
| How do I do X on this platform; `cache-data` usage | `search_documentation` → `get_document` for the full file |
| Is this resource name valid | `validate_naming` |
| Steering docs, hooks, AGENTS.md, skills | `list_agent_asset_types` → `list_agent_assets` → `get_agent_asset` |

Notes that save a round trip:

- `get_template` requires **both** `templateName` and `category`.
- Oversized responses come back truncated with `contentTruncated: true`, `totalChunks`, and a `retrievalHint`. Fetch `chunkIndex` 0 through `totalChunks - 1` and concatenate.
- When `search_documentation` returns too much, narrow with the `type` and `subType` values reported in the response's `availableFilters` block rather than re-querying with more keywords.
- `get_document` is storage-only. On a miss it returns a `githubUrl` for you to fetch directly; the server will not fetch it for you.

## Searching for cache-data

`search_documentation` tokenizes on exact terms with no stemming, and `cache-data` is a single hyphenated token. A query for `cache` or `caching` may not reach it. If a caching question returns nothing useful:

1. Query the literal package name: `cache-data`, or `@63klabs/cache-data`.
2. Query a specific symbol: `CacheableDataAccess`, `CachedSsmParameter`, `DebugAndLog`, `ClientRequest`, `Response`, `AppConfig`.
3. Try both the hyphenated and spaced forms of a phrase.
4. Check the response for a repository manifest and filter to the `cache-data` repository if one is offered.

Repositories are classified by type — `documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`. `cache-data` is a `package`.

## Platform guardrails

These hold regardless of what any individual request asks for. Violating them produces code that will not pass review or deploy.

**Never modify upstream Atlantis platform templates.** They are maintained in a separate repository. To extend permissions, attach managed policies via the pipeline's `CloudFormationSvcRoleIncludeManagedPolicyArns`, `CodeBuildSvcRoleIncludeManagedPolicyArns`, or `PostDeploySvcRoleIncludeManagedPolicyArns` parameters.

**Naming is `Prefix-ProjectId-StageId-Resource`.** S3 buckets follow one of three patterns, with `AccountId` before `Region`. Validate with `validate_naming` rather than guessing — it parses hyphenated components correctly when you supply known values such as `prefix` and `projectId`.

**IAM is least privilege.** Never use AWS managed policies like `AmazonS3FullAccess`. Scope both actions and resources to ARNs that follow the naming convention.

**Deployment is GitOps, never manual.** Branches map to stages: `test` → test, `beta` → beta, `main` → prod. Application changes deploy through the pipeline. A local `samconfig` is for development only. Never propose console deployments, hand-written pipeline YAML, or Terraform.

**Keep this repository's scope.** Shared storage, global tables, account-level CloudFront or Route53, and organization-wide logging belong to separate stacks owned by platform engineering.

**API Gateway Lambdas use `@63klabs/cache-data`** for routing, validation, logging, configuration, response generation, and AWS SDK access — not raw `console.log`, hand-rolled CORS, or direct `https` calls. Keep the handler thin and call `response.finalize()` exactly once.

## When the server is unavailable

Say so rather than silently falling back to recall. State that the Atlantis MCP server could not be reached, answer from general knowledge only if it is genuinely general, and flag any platform-specific claim as unverified so the user knows to confirm it.
