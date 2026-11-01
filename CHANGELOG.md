# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.0.7] (unreleased)

### Added
- **Tool Discovery Enhancement** [Spec: 0-0-7-tool-discovery-enhancement](../.kiro/specs/0-0-7-tool-discovery-enhancement/) — Makes the server the first place an AI agent looks for Atlantis platform resources, and makes `@63klabs/cache-data` reachable by the queries an agent would naturally write despite its name not containing "atlantis"
  - `search_documentation`: new optional `repository`, `repositoryType`, and `namespace` filters, in addition to the existing `type`/`subType`/`ghusers` filters; a filter matching nothing returns a successful empty result rather than an error, and all filters participate in the search cache key
  - `search_documentation`: new additive `indexedRepositories` response field, present on every call including zero-result ones, listing every indexed repository (name, owner, repository type, namespace, section count, ref) independent of what the query matched — distinct from the existing results-scoped `availableFilters` block, which gains a `repository` facet alongside its existing `type`/`subType` facets
  - `indexedRepositories` degrades through a `full`/`compact`/`count` ladder against a configurable byte budget (`MCP_CORPUS_MANIFEST_MAX_BYTES`, default 4096) and is always degraded or omitted before it could cause the caller's requested search results to be truncated
  - New shared `search-common` Lambda Layer providing one normalization implementation (hyphenated-identifier splitting, suffix reduction, a shared stop-word set and minimum token length) to both the read-function and doc-indexer, replacing five previously-independent and divergent tokenizer copies; repairs a pre-existing bug where two-character tokens (`s3`, `v2`, `ec2`) were written to the index but never reachable by a keyword-path query
  - New `config/tool-metadata.js` Tool Metadata Registry declaring per-tool title, behavioral annotations (`readOnlyHint: true`, `openWorldHint: false` for every tool), category, trigger keywords, related tools, when-to-use/when-not-to-use guidance, and usage examples; fans out through a new single merge helper, `utils/tool-catalog.js`, now the only place the tool manifest, extended descriptions, and registry metadata are combined (both `tools/list` and `list_tools` call it, eliminating two previously-independent merges)
  - Published and enforced tool input schemas are now derived from one authoritative definition, disclosing previously-enforced-but-unpublished constraints (`minLength`/`maxLength`, the tool-name path-separator restriction, `additionalProperties: false`, and `list_templates`'s `namespace` property)
  - Rewritten extended tool descriptions follow a consistent trigger-first shape naming concrete identifiers (`cache-data`, `CacheableDataAccess`, `samconfig`, `buildspec.yml`) and at least one failure mode per tool; `search_documentation`'s description now explicitly names `cache-data` as in-scope; corrected a `stadards` typo in `list_starters`
  - Doc Indexer: repository classification now resolves three distinguishable states (`resolved`, `absent`, `fetch-failed`) instead of collapsing the latter two together, and file exclusions are applied per repository type rather than one global set — a `package` repository's `CHANGELOG.md` is now indexed (version/migration questions depend on it), an `absent` classification excludes nothing, and a transient `fetch-failed` carries forward the repository's prior resolved classification rather than defaulting to "exclude nothing"
  - Keyword-path relevance ranking gains repository-name and file-path match signals plus a repository-type weighting multiplier, so an authoritative repository (e.g. `cache-data` for a `cache-data` question) is not outranked by an incidental mention elsewhere
  - Semantic/semantic-assisted retrieval gains the same `repository`/`repositoryType`/`namespace` filters once the vector store is rebuilt with the new metadata; until then, a filtered semantic request falls back to the keyword path rather than returning results that contradict the filter
  - New server-level MCP `instructions` content (`config/server-instructions.js`), authored once and served from a single source, stating the server's scope (naming the Atlantis platform and `@63klabs/cache-data` explicitly), a precedence directive to query this server before web search or training recall, and a one-line summary of the indexed corpus
  - Canonical `AGENTS.md` content published through the existing `agents-md` agent-asset type; a new generic `atlantis-platform-resources` skill; several manual-inclusion procedural steering documents converted to `automate-*` skills; the `skills` agent-asset type is now enabled now that skill content exists for it
  - New structured discovery observability log events (`discovery_search`, `discovery_tool_call`, `discovery_manifest_degraded`) and a zero-result CloudWatch metric filter under a new `Discovery` namespace, so discovery effectiveness is measurable going forward
  - Documents that code search over raw repository source is out of scope — the indexed corpus is extracted sections (headings, functions, parameters), not full file-text search
- **MCP Protocol Dual-Era Support** [Spec: 0-0-7-mcp-protocol-dual-era](../.kiro/specs/0-0-7-mcp-protocol-dual-era/) — Serves both the legacy handshake-based MCP revisions (`2024-11-05`, `2025-11-25`) and the modern stateless revision (`2026-07-28`) from the same `POST /mcp/v1` endpoint, with real per-request version negotiation. No session state is introduced; the era is chosen per request from the method and the declared protocol revision
  - New `server/discover` method returning `supportedVersions`, `capabilities`, and `instructions` for modern clients that no longer send `initialize`. It is answerable without authentication or any prior request, and is never rejected for an unlisted declared revision
  - New error code `-32022` Unsupported protocol version, with the revision the client declared and the full `supportedVersions` list in `error.data`; new error code `-32020` Header mismatch for a modern request whose `Mcp-Method` or `Mcp-Name` header disagrees with the body. Existing `-32700`/`-32600`/`-32601`/`-32602`/`-32603` codes are unchanged
  - Modern-era `tools/list` returns a cacheable result carrying `ttlMs` (10 minutes, advisory to the client) and `cacheScope: "public"`; modern `tools/list`, `tools/call`, and `server/discover` results carry `resultType: "complete"` and the server identity under `_meta["io.modelcontextprotocol/serverInfo"]`. Legacy results carry none of these fields
  - Era resolution reads the declared revision from the `MCP-Protocol-Version` header or from `params._meta["io.modelcontextprotocol/protocolVersion"]` (a top-level `_meta` is also accepted); the header wins when both are present, and a blank value counts as not declared. A request that declares nothing is treated as legacy
  - Revision lists, server name, capabilities, and `instructions` each have a single definition, assembled by `getCapabilities()` and read by both eras, with tests that fail on a duplicate; a revision is advertised only once every field it requires is implemented
  - Build-time `config/release-version.js`, generated from the first version header in `CHANGELOG.md` by `build-scripts/write_release_version.py`, so the reported server version is the deployed release
  - New documentation: [MCP protocol sources of truth](docs/developer/mcp-protocol-sources.md), [CORS and response headers](docs/admin-ops/cors-and-response-headers.md), [supported protocol revisions](docs/end-user/supported-protocol-revisions.md), and an `ARCHITECTURE.md` section on dual-era support. `Mcp-Param-*` / `x-mcp-header` support is not implemented
- **Post-Deploy Smoke Verification** [Spec: 0-0-7-postdeploy-smoke-verification](../.kiro/specs/0-0-7-postdeploy-smoke-verification/) - Every deployment now verifies itself. A new last post-deploy script, `05-verify-deployment.sh`, sends about 25 read-only requests to the stage that was just deployed, and fails the build, which blocks promotion, when the live server is not the release that was built or no longer speaks both MCP protocol eras
  - 45 sub-checks, 36 core and 9 advisory. Core checks fail the build: `server/discover`, the deployed release version, legacy `initialize` negotiation, the `-32022` and `-32020` errors, the `tools/list` and `tools/call` envelopes per revision, and the CORS preflight. Advisory checks only warn: `list_templates`, the `401` for an invalid key, the stored verification key, and, on stages with a custom domain, the same headers through CloudFront
  - A run that gets HTTP `429` on a core check is `inconclusive` and fails the build. The log gives the reset time and the command to retry the stage. Nothing waits or retries inside CodeBuild
  - Results go to the PostDeploy build log, a JSON report, and one `VERIFY_REPORT` line per run, searchable with CloudWatch Logs Insights (new "Post-Deploy Verification Runs" entry in `docs/admin-ops/cloudwatch-insights-queries.json`)
  - Two new SSM parameters, created by the main build: `Mcp_PostDeployTestVerifyApiKey` (`BLANK` until a private-tier key is stored; verification runs without it) and `Mcp_PostDeployTestVerifySkip` (`false`; set it to `true` to skip verification on one stage). Until [#5](https://github.com/63Klabs/atlantis-mcp/issues/5) is fixed, a private key's account expires about 120 days after the key was set up; the developer guide gives the workarounds
  - Runs locally against any stage with `node application-infrastructure/postdeploy-scripts/verify-deployment.js`
  - New test package `application-infrastructure/tests/postdeploy-verify`, run with a fake MCP server. The one existing assertion in `tests/postdeploy/unit/buildspec-structure.test.js` that expected four post-deploy scripts now expects five, in order, ending with `05-verify-deployment.sh`
  - New documentation: [post-deploy verification for developers](docs/developer/post-deploy-verification.md) and [for operators](docs/admin-ops/post-deploy-verification.md), with updates to `ARCHITECTURE.md` and `DEPLOYMENT.md`

### Changed
- **MCP Protocol Dual-Era Support: `initialize`** [Spec: 0-0-7-mcp-protocol-dual-era](../.kiro/specs/0-0-7-mcp-protocol-dual-era/) — The legacy `InitializeResult` now carries the server-level `instructions` string and echoes a supported requested revision instead of always answering `2024-11-05`
  - A requested revision the server does not list is answered with the highest listed legacy revision that is not newer than the one requested (or `2025-11-25` when it is newer than all of them), rather than rejecting the handshake, so a legacy client on an in-between revision still connects
- **MCP Protocol Dual-Era Support: unlisted declared revision (behavior change)** — A request that declares an unlisted revision in the `MCP-Protocol-Version` header or in `_meta` now receives `-32022` on every method except `server/discover`. Previously the server ignored these values. A client that sends a revision header the server does not list will now need to send one of `2024-11-05`, `2025-11-25`, or `2026-07-28`; the `-32022` response lists them
- **MCP Protocol Dual-Era Support: `tools/list`** — `Tool.title` and `Tool.annotations` are now emitted when the request declares revision `2025-11-25` or `2026-07-28`; requests that declare no revision, or `2024-11-05`, receive the baseline fields only. Previously the revision was never passed to the tool catalog, so these fields were not emitted on any revision
- **Template: template.yml** — API Gateway CORS `AllowHeaders` extended with `Mcp-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` so browser-hosted modern clients pass the CORS preflight. Purely additive; `AllowMethods`, `AllowOrigin`, and `MaxAge` are unchanged
- **Router response headers** — `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` are no longer declared by the JSON-RPC router. They were never emitted by the Lambda (stripped in `routes/index.js` and not produced by `Response.finalize()`); API Gateway owns them. No change on the wire
- **API Gateway invokes the Read function's live alias** [Spec: 0-0-7-api-gateway-live-alias](../.kiro/specs/0-0-7-api-gateway-live-alias/) - PROD stages (`beta`, `prod`) now deploy the Read function gradually to API callers
  - During a shift (about 30 minutes by default, `FunctionGradualDeploymentType`) two versions answer API requests, so shared cache entries and table data must stay compatible with both. Set `FunctionGradualDeploymentType=AllAtOnce` for an urgent fix
  - `ReadLambdaPermissionLive` is removed; SAM's generated permission for the `McpV1Post` event already allows API Gateway to invoke the alias. `ReadLambdaPermission` (the unqualified function) is unused and scheduled for removal in v0.0.8
  - New test `read-function/tests/unit/architecture/openapi-integration-targets.test.js`, updated `openapi-spec-sync.md` guidance, and a new developer page, [gradual deployment](docs/developer/gradual-deployment.md)
  - Observed on `beta` and `prod`: the first (migration) deploy of the alias integration took about 28 minutes and was not gradually protected, because CloudFormation waits for the whole CodeDeploy shift before it updates the REST API and the API called the unqualified ARN until then. Later PROD deploys take about 28 minutes in the Deploy stage and are protected. After a rolled-back deploy, start a new pipeline execution; the Deploy stage cannot be retried

### Fixed
- **Server version reported to clients** — `serverInfo.version` was a stale, independently maintained value (`0.0.1`, later the Lambda `package.json` version) and could not match the deployed release; it is now the release version from `CHANGELOG.md`, identical on both eras
- **Gradual deployment did not apply to API traffic** [Spec: 0-0-7-api-gateway-live-alias](../.kiro/specs/0-0-7-api-gateway-live-alias/) - The `/mcp/v1` integration invoked the Read function's unqualified ARN (`$LATEST`), so API callers received new code as soon as CloudFormation updated the function while CodeDeploy shifted an alias that nothing called. The integration now targets the `live` alias, so the traffic shift and the `ReadLambdaErrorsAlarm` rollback protect API callers
- **`tools/list` returned a `cacheScope` the specification does not allow, so Kiro could not connect** [Spec: 0-0-7-tools-list-returns-cachescope-server-which-kiro](../.kiro/specs/0-0-7-tools-list-returns-cachescope-server-which-kiro/) ([#7](https://github.com/63Klabs/atlantis-mcp/issues/7)) - The modern-era (`2026-07-28`) `tools/list` result carried `cacheScope: "server"`; the specification allows only `"public"` or `"private"`, so clients that validate results rejected it and failed to connect. It now returns `"public"`, because the tool list is identical for every caller
  - `server/discover` now also carries the `ttlMs` (10 minutes) and `cacheScope` (`"public"`) that its schema requires
  - The scope and its allowed set are code constants (`TOOLS_LIST_CACHE_SCOPE`, `CACHE_SCOPES`) in `utils/mcp-protocol.js`, not a setting. If the tool list is ever filtered per tier, the scope must become `"private"`
  - The post-deploy verifier now requires `cacheScope` to be `public` or `private` on `tools/list` and `server/discover`, and `ttlMs` to be a non-negative integer on `server/discover`, so a wrong value fails the PostDeploy stage. The sub-check IDs and counts are unchanged
  - Legacy-era results (`2024-11-05`, `2025-11-25`, no declared revision) are unchanged

## [v0.0.6] (2026-09-02)

Big enhancements:

- AI assisted documentation search
- Access to Agent Asset Tools (such as steering documents)

> Learn more about the AI-assisted documentation search below. Note, this is currently enabled by default for a limited time. It will be disabled by default when moving to v0.1.0. It is also currently enabled only for users of the paid or private tier.

### Added
- **Password Reset and Change Password** [Spec: 0-0-6-password-reset](../.kiro/specs/0-0-6-password-reset/) — Self-service password management for registered users
  - Self-service **forgot password** flow at `/forgot-password/` — request a reset code via email, enter the code and a new password, confirm the reset. Includes spam-folder advisory, resend cooldown (3 attempts, 30s initial delay, 30s cooldown), and an unconfirmed-account redirect to the registration verify flow
  - Authenticated **change password** section on `/profile/` — change the current password without email delivery; session stays valid after a successful change
  - `forgot-password/` page added to the static site
- **Agent Asset Tools** [Spec: 0-0-6-agent-asset-tools](../.kiro/specs/0-0-6-agent-asset-tools/) — New registry-driven MCP tools (`list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`, `get_agent_asset_chunk`) that serve example Kiro agent assets — steering documents, hooks, and AGENTS.md files — from the existing S3 buckets and namespaces already used for templates and starters, under a new `{namespace}/utilities/v2/agent_assets/{type}/` prefix; no new AWS infrastructure or bucket tags required
  - Single-registry design (`config/agent-asset-types.js`): adding a new asset type, or enabling the shipped-but-disabled `skills` type, requires only a new/edited registry entry — no changes to the generic controller, service, or S3 data-access logic
  - Content-identity metadata (`size`, `etag`, and `sha256` for `get_agent_asset`) lets a caller detect a changed asset without re-downloading its content
  - Stricter-than-templates input validation: an `s3Buckets` filter naming an unconfigured bucket, or an unknown/disabled `assetType`, is rejected before any S3 read (rather than silently filtered)
  - Size-aware `get_agent_asset` response (mirroring `get_template`): large assets return a truncated summary with `get_agent_asset_chunk` used to retrieve the full content incrementally
  - Two new cache-data connections (`s3-agent-assets`, `agent-asset-chunks`) with brown-out support (a failed or inaccessible bucket is skipped, logged, and reported in the response rather than failing the whole request)
- **Bedrock-Assisted Documentation Semantic Search** [Spec: 0-0-6-bedrock-documentation-semantic-search](../.kiro/specs/0-0-6-bedrock-documentation-semantic-search/) — Optional Amazon Bedrock semantic retrieval for the `search_documentation` MCP tool. Defaults OFF (`EnableDocAi=false`); when disabled the tool behaves byte-for-byte as the existing keyword search and no AI resources are created or billed
  - New `doc-ai-common` Lambda Layer shared by the read-function and doc-indexer: an EmbeddingProvider (Bedrock Titan Text Embeddings V2), a VectorStore abstraction with `dynamodb` and `s3-vectors` backends selected via a factory, tier-gated retrieval strategies (`keyword` / `semantic` / `semantic-assisted`) with automatic keyword fallback on any error, and an AssistProvider (Bedrock Nova Micro) that only re-ranks the top candidates and never synthesizes prose
  - Tier gating (`public` < `registered` < `paid` < `private`, default minimum `paid`) with three retrieval modes selectable through configuration; below-tier and disabled requests use keyword search and the `search_documentation` response shape is unchanged for all callers
  - S3 Vectors vector bucket and index provisioned by a Condition-gated CloudFormation custom resource (`Custom::S3VectorIndex`); nothing is created or billed while the feature is disabled
  - Condition-gated least-privilege IAM — `bedrock:InvokeModel` scoped to the specific embedding and assist model ARNs, and `s3vectors` data-plane actions scoped to the single vector index — plus CloudWatch usage/cost metric filters under a dedicated `DocAi` metric namespace
  - New `DocAi*` CloudFormation parameters and matching `DOC_AI_*` environment variables wired to both the read-function and doc-indexer
  - Incremental index-time embedding reuse: content whose embedding input is unchanged (matching content hash, model, and dimensions) is carried forward instead of being re-embedded across index versions
  - Optional cross-region embedding override (`DocAiEmbeddingRegion` / `DOC_AI_EMBEDDING_REGION`): pins the Bedrock embedding client to a fixed alternate region for when the embedding model is unavailable in the deployment region (embedding models cannot use cross-region inference profiles); the embedding-model IAM grant follows this region. Defaults empty — the deployment region is used and behavior is unchanged when unset
  - Optional assist cross-region inference profiles (`DocAiAssistProfileRegions`): when set, `DocAiAssistModel` is treated as a Bedrock inference-profile id using AWS server-side cross-region routing, and the assist IAM grant covers the inference-profile ARN plus the assist foundation model restricted to the listed regions via the `aws:RequestedRegion` condition key (least-privilege, model-pinned). Defaults empty — no inference profile is used and behavior is unchanged when unset
  - Distinct ERROR-level `doc_ai_bedrock_model_unavailable` log line (emitted by the doc-indexer and the retrieval strategies) when a Bedrock model or inference profile is unavailable in the targeted region, alongside the existing WARN-level keyword-fallback degrade
- **Documentation Index Enhancement: `get_document` / `get_document_chunk` tools** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — New storage-only MCP tools that return the entire source file (not just a single search-result section) reconstructed from the indexed content; the server never fetches from GitHub, so on a storage miss the response identifies the requested `filePath`/`hash` and includes the file-level `githubUrl` (when derivable) for the client to fetch directly
  - Size-aware response: an oversized document returns a truncated summary plus `totalChunks`, with `get_document_chunk` used to retrieve the full content incrementally (mirroring `get_template`/`get_template_chunk`)
  - Resolvable by either a section-level `filePath` or `hash`, independent of `EnableDocAi`/`DocAiRetrievalMode`, at the same access level as keyword `search_documentation`
- **`search_documentation`: populated `githubUrl`, `repositoryType`, and `namespace`** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Search results now return a working file-level GitHub URL (release tag when the archive came from a release, otherwise the default branch) and the repository's `atlantis_repository-type`/namespace, instead of always `null`
- **`search_documentation`: `availableFilters` facets and refine-by-filter suggestions** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Additive, optional `availableFilters` block listing the distinct `type`/`subType` values (with counts) present in a result set; when `totalResults` is large the existing `suggestions` field is populated with a "narrow by type/subType" hint
- **`search_documentation`: exact-phrase ranking boost** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Keyword-mode results whose title or excerpt contain the full query phrase are boosted and re-sorted to the top of the relevance ordering; semantic/semantic-assisted ranking is unaffected
- **doc-indexer: boundary-aware excerpts** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Excerpts now prefer the first prose paragraph over leading markdown tables/code fences and trim at a sentence or word boundary, replacing the previous hard character cut that could end mid-word or mid-table row
- **X-Ray Downstream Tracing** [Spec: 0-0-6-xray-downstream-tracing](../.kiro/specs/0-0-6-xray-downstream-tracing/) — Closed the gap where AWS X-Ray traces stopped at the Lambda node and never showed downstream calls, despite active tracing being enabled stack-wide
  - Downstream X-Ray subsegments are now recorded for DynamoDB, S3, Bedrock, and S3 Vectors calls across the Read_Function, Auth_Function, Doc_Indexer, and the shared `doc-ai-common` Lambda Layer, via a new conditional `captureClient()` helper (gated on `CACHE_DATA_AWS_X_RAY_ON`/`CacheData_AWSXRayOn`, degrading to an unwrapped client when tracing is disabled or `aws-xray-sdk-core` is unavailable)
  - Activated `@63klabs/cache-data`'s existing (previously inert) X-Ray wrapping for the Read_Function's DynamoDB/S3 calls by declaring `aws-xray-sdk-core` as a production dependency
  - Fixed a pre-existing IAM gap: `AuthLambdaExecutionRole` and `CleanupExecutionRole` now attach the `AWSXRayDaemonWriteAccess` managed policy (previously missing despite `Globals.Function.Tracing: Active` applying stack-wide), so both functions can emit their own function segments
  - AWS SDK v3 X-Ray subsegments carry no resource names, so operators should expect generic per-service nodes (e.g. "DynamoDB", "Bedrock Runtime") rather than per-table or per-bucket nodes in the X-Ray service map

### Changed
- **Password validator extracted to shared asset** [Spec: 0-0-6-password-reset](../.kiro/specs/0-0-6-password-reset/) — Moved from inline in `register/index.html` to `public/js/password-validator.js`; consumed by the register, forgot-password, and profile pages
- **`assetVersion` settings key** [Spec: 0-0-6-password-reset](../.kiro/specs/0-0-6-password-reset/) — Added to `settings.json` for cache-busting the shared validator asset via `?v={{{settings.assetVersion}}}` query strings on referencing pages
- **Source Restructure: Single-Src to Multi-Src** [Spec: 0-0-6-update-to-multi-resource-spec](../.kiro/specs/0-0-6-update-to-multi-resource-spec/) — Reorganized `application-infrastructure/src/` into the Atlantis multi-resource layout so each deployable resource is fully self-contained
  - Renamed Lambda function directories: `src/lambda/read/` → `read-function/`, `auth/` → `auth-function/`, `cleanup/` → `cleanup-function/`, `indexer/` → `doc-indexer/` (CloudFormation logical IDs and `FunctionName` values unchanged; only `CodeUri` paths updated, so functions are updated in place rather than replaced)
  - Each Lambda function now owns its `.nvmrc`, `package.json` test/lint scripts, `jest.config.js`, `jest.setup.js`, and `eslint.config.js`; tests run per function
  - Converted the static site into a self-contained resource: moved static tests into `src/static/tests/` and added `.nvmrc`, `package.json`, `jest.config.js`, and `jest.setup.js` (jsdom test environment)
  - Rewrote `buildspec.yml` to iterate over `src/lambda/*/`, installing, testing, and auditing each function independently (new functions are picked up automatically); removed the central coverage-summary post-build step
  - Added a `pre_build` static-site install/test/audit step to `buildspec-postdeploy.yml`
  - Scoped the buildspec `npm audit` gate to production dependencies (`npm audit --omit=dev --audit-level=high`) in both buildspecs so advisories in dev-only test tooling (jest/babel toolchain), which is never deployed, do not fail the build; this matches the existing `--omit=dev` scope of the preceding `npm audit fix`
- **doc-indexer/read-function: hash-keyed document storage and batched metadata reads** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Replaced the per-section, per-version content body item with a single per-file `document:{fileHash}` item (version-less, de-duplicated across a file's sections, refreshed 7-day TTL each build); `search_documentation` and the semantic/assisted enrichment paths now fetch result metadata via chunked `BatchGetItem` requests (bounded `UnprocessedKeys` retry) instead of a serial `GetItem` per hit, reducing read amplification without changing result ordering

### Fixed
- **Auth Lambda: trigger-source dispatcher** [Spec: 0-0-6-password-reset](../.kiro/specs/0-0-6-password-reset/) — Cognito trigger events (e.g., `PostConfirmation_ConfirmForgotPassword`) are now echoed back unmodified instead of returning an API Gateway-shaped response, which previously caused `InvalidLambdaResponseException` on `ConfirmForgotPassword` after the password had already been changed

### Removed
- **Central `src/` root tooling** — Deleted the shared `src/package.json`, `src/package-lock.json`, `src/jest.config.js`, `src/jest.setup.js`, `src/eslint.config.js`, and `src/.nvmrc` now that each function and the static site are self-contained; the `src/` root contains only `lambda/` and `static/`
- **`DocAiVectorStore` parameter and DynamoDB vector-store backend** [Spec: 0-0-6-documentation-index-enhancement](../.kiro/specs/0-0-6-documentation-index-enhancement/) — Consolidated on S3 Vectors as the sole vector store for semantic/semantic-assisted retrieval; removed the `DocAiVectorStore` CloudFormation parameter and `DOC_AI_VECTOR_STORE` environment variable from `template.yml` and both Lambdas, and removed the DynamoDB vector-store code path (the whole-corpus-into-Lambda cosine scan)

### Dependencies
- **`doc-ai-common` Lambda Layer** [Spec: 0-0-6-bedrock-documentation-semantic-search](../.kiro/specs/0-0-6-bedrock-documentation-semantic-search/) — Bundles `@aws-sdk/client-s3vectors` as its single production dependency for the `s3-vectors` path (that client is not yet guaranteed in the Lambda runtime); all other AWS SDK clients remain dev-only and are provided by the runtime
- **`aws-xray-sdk-core@3.12.0`** [Spec: 0-0-6-xray-downstream-tracing](../.kiro/specs/0-0-6-xray-downstream-tracing/) — Added as a pinned production dependency to `read-function`, `auth-function`, `doc-indexer`, and the `doc-ai-common` layer, because the AWS Lambda managed Node.js runtime does not provide it

## [v0.0.5] (2026-05-07)

### Fixed
- **CI/CD: Test suite OOM in CodeBuild** — Resolved JavaScript heap out-of-memory crash during `npm test` in constrained build environments
  - Added `--max-old-space-size=1024` to test scripts in `package.json`
  - Scoped `collectCoverageFrom` in `jest.config.js` to Lambda source directories only (was instrumenting all `node_modules`)
  - Limited Jest workers to 2 in CI (`maxWorkers: 2` when `CI=true`)
  - Reduced `numRuns` from 100 to 10 in `settings-property.test.js` (module-reloading property tests are expensive)
  - Set `CI=true` in `buildspec.yml` before test execution
- **Test: cleanup-filtering.property.test.js** — Replaced `fc.stringOf` (not available in fast-check v4) with `fc.stringMatching(/^[0-9]{10,20}$/)` to fix test suite load failure

### Added
- **Password Re-entry Confirmation Module** [Spec: 0-0-5-password-reentry-confirmation](../.kiro/specs/0-0-5-password-reentry-confirmation/)
  - New module at `application-infrastructure/src/lambda/auth/utils/password-validator.js`
  - Pure, stateless, zero-dependency CommonJS validation functions for password forms
  - Exported functions: `validateMatch`, `validatePolicy`, `validateForm`, `getAriaAttributes`, `getAriaLiveRegion`, `isReadyForSubmission`, `getFirstErrorField`
  - Exported constants: `FIELD_IDS` (DOM element ID constants), `POLICY_RULES` (Cognito policy rule constants)
  - Exported utility: `TestHarness` (testing utility exposing internals)
  - Cognito password policy enforcement (min/max length, uppercase, lowercase, number, symbol)
  - WCAG 2.1 AA accessibility support via ARIA attribute generation and live region content
  - Real-time form validation with mismatch suppression for empty confirm field
  - Submission gating and focus management for error recovery
- **Account Validation Retry** [Spec: 0-0-5-add-account-validation-retry](../.kiro/specs/0-0-5-add-account-validation-retry/)
  - Spam folder advisory displayed on the email verification step
  - Resend verification code button with 30-second initial delay, 30-second cooldown, and max 3 attempts
  - Re-registration handling for unverified accounts (UsernameExistsException triggers authentication check to determine account state before resending)
  - Login page handling for unverified accounts (UserNotConfirmedException redirects to verification)
  - Query parameter support (`?verify=<email>`) for cross-page verification flow
  - Accessibility compliance: aria-live regions, aria-describedby associations, focus management with fallback

## [v0.0.4] (2026-05-04)

### Security
- **Key Hashing Upgrade** [Spec: 0-0-4-key-hashing-for-auth](../.kiro/specs/0-0-4-key-hashing-for-auth/) — Replaced HMAC-SHA256 with scrypt (N=16384, r=8, p=1) for API key hashing in auth and read lambdas, resolving GitHub security code scanning alerts #5, #6, #7, #8 (CWE-916)

### Breaking Changes
- **API Key Hashing Algorithm Change** — Existing API key hashes in DynamoDB are invalidated by the switch from HMAC-SHA256 to scrypt. Pre-production: test users must regenerate their API keys. No migration script needed.

## [v0.0.3] (2026-05-03)

### Added
- **Modules Nested Directory Support** [Spec: 0-0-3-modules-nested-directory-support](../.kiro/specs/0-0-3-modules-nested-directory-support/)
  - Template discovery now supports nested subdirectories under the `modules` category (`modules/{subcategory}/{templateName}.yml`)
  - Metadata parser extracts subcategory from nested paths while preserving backward compatibility for flat categories
  - `get_template` and `list_template_versions` search subdirectories for module templates via prefix-based lookup
  - `list_categories` returns a `subcategories` array for the modules category listing discovered subcategory names
  - Deduplication logic distinguishes templates with the same name in different subcategories
  - CloudFormation indexer extracts subcategory from file paths and includes subcategory-derived tokens in search keywords
  - Schema validation rejects template names containing path separators (`/`, `\`) to prevent path traversal
- **Authentication** [Spec: 0-0-3-add-authentication](../.kiro/specs/0-0-3-add-authentication/)
  - Users can register for free to increase their hourly rate limit.
  - Registration mechanism with email loop verification
  - User profile with API key generation for MCP auth
  - Promotion code redemption (for admins to grant temporary paid access)
  - Subscription to Paid tier coming later.
  - Uses Amazon Cognito

## [v0.0.2] (2026-04-09)

### Changed

- Updated logs better record request and response metrics such as tool usage.

## [v0.0.1] (2026-04-02)

Initial release.

---

## Release Notes Format

Each release should include changes under these categories:

- **Added**: New features, tools, or capabilities
- **Changed**: Modifications to existing functionality
- **Deprecated**: Features marked for removal (with sunset date)
- **Removed**: Features removed in this version
- **Fixed**: Bug fixes and corrections
- **Security**: Security-related changes or fixes

### Breaking Changes

Breaking changes should be clearly marked and include:
- Description of the breaking change
- Migration guide link
- Deprecation timeline for old version

Example:
```markdown
### Breaking Changes
- **Tool: list_templates** - Renamed parameter `buckets` to `s3Buckets`
  - **Migration Guide**: [docs/migration/v1-to-v2.md](docs/migration/v1-to-v2.md)
  - **Deprecation**: v1.x deprecated with 6-month support period ending 2026-12-31
```

### Version Links

[Unreleased]: https://github.com/63klabs/atlantis-mcp/
[v0.0.6]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.6
[v0.0.5]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.5
[v0.0.4]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.4
[v0.0.3]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.3
[v0.0.2]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.2
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
