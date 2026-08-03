# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.0.6 (unreleased)

### Added
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

### Changed
- **Source Restructure: Single-Src to Multi-Src** [Spec: 0-0-6-update-to-multi-resource-spec](../.kiro/specs/0-0-6-update-to-multi-resource-spec/) — Reorganized `application-infrastructure/src/` into the Atlantis multi-resource layout so each deployable resource is fully self-contained
  - Renamed Lambda function directories: `src/lambda/read/` → `read-function/`, `auth/` → `auth-function/`, `cleanup/` → `cleanup-function/`, `indexer/` → `doc-indexer/` (CloudFormation logical IDs and `FunctionName` values unchanged; only `CodeUri` paths updated, so functions are updated in place rather than replaced)
  - Each Lambda function now owns its `.nvmrc`, `package.json` test/lint scripts, `jest.config.js`, `jest.setup.js`, and `eslint.config.js`; tests run per function
  - Converted the static site into a self-contained resource: moved static tests into `src/static/tests/` and added `.nvmrc`, `package.json`, `jest.config.js`, and `jest.setup.js` (jsdom test environment)
  - Rewrote `buildspec.yml` to iterate over `src/lambda/*/`, installing, testing, and auditing each function independently (new functions are picked up automatically); removed the central coverage-summary post-build step
  - Added a `pre_build` static-site install/test/audit step to `buildspec-postdeploy.yml`
  - Scoped the buildspec `npm audit` gate to production dependencies (`npm audit --omit=dev --audit-level=high`) in both buildspecs so advisories in dev-only test tooling (jest/babel toolchain), which is never deployed, do not fail the build; this matches the existing `--omit=dev` scope of the preceding `npm audit fix`

### Removed
- **Central `src/` root tooling** — Deleted the shared `src/package.json`, `src/package-lock.json`, `src/jest.config.js`, `src/jest.setup.js`, `src/eslint.config.js`, and `src/.nvmrc` now that each function and the static site are self-contained; the `src/` root contains only `lambda/` and `static/`

### Dependencies
- **`doc-ai-common` Lambda Layer** [Spec: 0-0-6-bedrock-documentation-semantic-search](../.kiro/specs/0-0-6-bedrock-documentation-semantic-search/) — Bundles `@aws-sdk/client-s3vectors` as its single production dependency for the `s3-vectors` path (that client is not yet guaranteed in the Lambda runtime); all other AWS SDK clients remain dev-only and are provided by the runtime

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
[v0.0.5]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.5
[v0.0.4]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.4
[v0.0.3]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.3
[v0.0.2]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.2
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
