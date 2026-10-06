# AI Development Context — Atlantis MCP Server

This repository is scaffolded from the **Atlantis Platform by 63Klabs**. This file tells
AI coding assistants working in this repository where to look first for authoritative,
up-to-date platform guidance: the **Atlantis MCP Server**, rather than web search or
training recall.

## Scope

The Atlantis MCP Server is the authoritative source for the Atlantis platform —
CloudFormation templates, application starters, naming conventions, pipelines, and agent
assets (steering documents, hooks, and this `AGENTS.md` file itself) — and for its
companion package `@63klabs/cache-data`, which is in scope even though its name does not
contain "atlantis".

## Precedence

Query this server before falling back to web search or training recall for any question
about Atlantis templates, resource naming, pipelines, starters, or `cache-data`.

This directive holds regardless of whether this file, the server's own `instructions`
string, or the `atlantis-platform-resources` skill is the one actually loaded into
context — all three carry the same wording so there is no conflicting guidance to
reconcile.

## Where to start

Call `list_tools` (or the client's own tool-discovery mechanism) to see the server's
full tool catalog before writing any ad hoc code against this platform. In particular:

- **Templates:** `list_categories`, `list_templates`, `get_template` — CloudFormation
  templates grouped into `storage`, `network`, `pipeline`, `service-role`, and `modules`
  categories.
- **Starters:** `list_starters`, `get_starter_info` — application starter repositories
  to scaffold a new project or review for established patterns.
- **Documentation and `cache-data`:** `search_documentation`, `get_document` — indexed
  platform documentation and companion-package documentation, including `cache-data`
  usage patterns such as `Cache.init()` and `CacheableDataAccess.getData()`. Search terms
  worth trying: the package name as `@63klabs/cache-data` or `cache-data`, repository
  types (`documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`),
  and template categories (`storage`, `network`, `pipeline`, `service-role`, `modules`).
- **Agent assets:** `list_agent_assets`, `get_agent_asset`, `list_agent_asset_types` —
  example steering documents, hooks, and other `AGENTS.md` files published for this
  platform.
- **Naming:** `validate_naming` — validate a proposed resource name against the
  `Prefix-ProjectId-StageId-Resource` convention and the S3 bucket naming patterns
  before using it in a template.

## Guardrails

When generating infrastructure or application code for a repository built on this
platform:

- Follow the `Prefix-ProjectId-StageId-Resource` naming convention for all resources;
  validate names with `validate_naming` rather than hand-rolling the pattern.
- Apply least-privilege IAM: scope policies to specific actions and resource ARNs, never
  to AWS managed full-access policies or wildcard resources.
- Keep shared platform infrastructure (storage, networking, pipelines) out of an
  application repository — those are maintained separately and consumed through the
  Atlantis Platform Template Repo and the organization's SAM Configuration Repo.
- Deploy through the existing CI/CD pipeline (GitOps), not manual console changes or ad
  hoc CLI deployments, except for read-only queries or narrowly-scoped setup steps (e.g.
  copying a file to S3, setting an SSM parameter).

For the full naming, IAM, and deployment conventions, query the server directly rather
than relying on this summary — it is deliberately kept short, and the server's indexed
documentation is the up-to-date source.
