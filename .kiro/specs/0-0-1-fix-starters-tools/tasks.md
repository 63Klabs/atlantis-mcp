# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Starters Tools Use GitHub API Instead of S3
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the starters service routes through `github-api` connection instead of `s3-app-starters`
  - **Scoped PBT Approach**: Scope the property to `list_starters` and `get_starter_info` tool calls since the bug affects ALL calls to these two tools
  - Create test file: `application-infrastructure/src/lambda/read/tests/unit/services/starters-s3-only.property.test.js`
  - Test 1a: Mock `Config.getConnCacheProfile` and verify `Services.Starters.list({})` calls it with `'s3-app-starters'` and `'starters-list'` (not `'github-api'`). On unfixed code, the service calls `Config.getConnCacheProfile('github-api', 'starters-list')` so this assertion will FAIL
  - Test 1b: Mock `Config.getConnCacheProfile` and verify `Services.Starters.get({ starterName: 'test-starter' })` calls it with `'s3-app-starters'` and `'starter-detail'` (not `'github-api'`). On unfixed code, the service calls `Config.getConnCacheProfile('github-api', 'starter-detail')` so this assertion will FAIL
  - Test 1c: Verify `Services.Starters.list()` accepts `{ s3Buckets, namespace }` parameters (not `ghusers`). On unfixed code, the service destructures `ghusers` so `s3Buckets`/`namespace` are ignored - FAIL
  - Test 1d: Verify `SchemaValidator.validate('list_starters', { s3Buckets: ['63klabs'] })` returns `valid: true`. On unfixed code, `s3Buckets` is rejected as unknown property - FAIL
  - Test 1e: Verify `parseSidecarMetadata('{"languages":["Node.js"],"frameworks":["Express"]}')` returns arrays for `languages` and `frameworks`. On unfixed code, it reads singular `language`/`framework` fields so these are empty - FAIL
  - Test 1f: Property-based test using fast-check: for any valid starter name string, `get()` should accept `{ starterName, s3Buckets: ['63klabs'] }` without throwing a parameter validation error. On unfixed code, `s3Buckets` is not recognized - FAIL
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Config.getConnCacheProfile called with 'github-api' instead of 's3-app-starters'", "s3Buckets rejected as unknown property", "languages field returns empty string instead of array")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Starters Tool Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file: `application-infrastructure/src/lambda/read/tests/unit/services/starters-fix-preservation.property.test.js`
  - Observe on UNFIXED code: `SchemaValidator.validate('list_templates', { category: 'storage' })` returns `{ valid: true }`
  - Observe on UNFIXED code: `SchemaValidator.validate('search_documentation', { query: 'test', ghusers: ['63klabs'] })` returns `{ valid: true }`
  - Observe on UNFIXED code: `SchemaValidator.validate('validate_naming', { resourceName: 'test-resource' })` returns `{ valid: true }`
  - Observe on UNFIXED code: `settings.tools.getGetEligibleTools()` includes `'list_starters'` (no required params) and `'list_templates'`
  - Observe on UNFIXED code: `settings.tools.availableToolsList` contains `search_documentation` with `ghusers` property (unchanged)
  - Test 2a: Property-based test: for any tool name from `['list_templates', 'get_template', 'list_template_versions', 'list_categories', 'search_documentation', 'validate_naming', 'check_template_updates', 'list_tools']`, `SchemaValidator.getSchema(toolName)` returns the same schema object before and after fix. Verify schemas are unchanged on UNFIXED code
  - Test 2b: Property-based test: for any valid template category from `TEMPLATE_CATEGORIES`, `SchemaValidator.validate('list_templates', { category })` returns `{ valid: true }`. Verify on UNFIXED code
  - Test 2c: Verify `settings.tools.getGetEligibleTools()` includes `'list_starters'` (still GET-eligible since no required params after fix). Verify on UNFIXED code
  - Test 2d: Verify `search_documentation` schema still has `ghusers` property (documentation tool is unaffected). Verify on UNFIXED code
  - Test 2e: Verify `settings.s3.buckets` defaults to `['63klabs']` and `settings.s3.starterPrefix` returns `'app-starters/v2'`. Verify on UNFIXED code
  - Test 2f: Verify `settings.github.userOrgs` and `settings.github.token` still exist (GitHub config preserved for other tools). Verify on UNFIXED code
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix starters tools to use S3-only approach

  - [x] 3.1 Rewrite `services/starters.js` to S3-only approach
    - Remove `Models.GitHubAPI` usage entirely from the service
    - Change `list()`: use `Config.getConnCacheProfile('s3-app-starters', 'starters-list')` instead of `Config.getConnCacheProfile('github-api', 'starters-list')`
    - Change `get()`: use `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')` instead of `Config.getConnCacheProfile('github-api', 'starter-detail')`
    - Accept `{ s3Buckets, namespace }` in `list()` and `{ starterName, s3Buckets, namespace }` in `get()` instead of `ghusers`
    - Validate `s3Buckets` against `Config.settings().s3.buckets`, matching the templates service pattern
    - Simplify `list()` fetchFunction: call only `Models.S3Starters.list(connection, opts)`, wrap with `ApiRequest.success()` or `ApiRequest.error()`
    - Simplify `get()` fetchFunction: call only `Models.S3Starters.get(connection, opts)`, handle not-found with STARTER_NOT_FOUND error
    - Remove `deduplicateStarters` function (S3 model already deduplicates)
    - Set `conn.host` to buckets array and `conn.parameters` to include `{ namespace }` for list, `{ starterName, namespace }` for get
    - Follow the same CacheableDataAccess/ApiRequest/cacheObj.getBody(true) pattern as `services/templates.js`
    - _Bug_Condition: isBugCondition(input) where input.toolName IN ['list_starters', 'get_starter_info'] — service always routes through broken github-api path_
    - _Expected_Behavior: Service uses 's3-app-starters' connection with CacheableDataAccess pattern, accepts s3Buckets/namespace params_
    - _Preservation: Templates service, documentation service, and all other services remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Update `controllers/starters.js` to extract `s3Buckets`/`namespace`
    - In `list()`: extract `{ s3Buckets, namespace }` from input instead of `{ ghusers }`, pass to `Services.Starters.list({ s3Buckets, namespace })`
    - In `get()`: extract `{ starterName, s3Buckets, namespace }` from input instead of `{ starterName, ghusers }`, pass to `Services.Starters.get({ starterName, s3Buckets, namespace })`
    - Update logging: log `namespace` and `s3BucketsCount` instead of `ghusersCount`
    - Follow the same pattern as `controllers/templates.js`
    - _Requirements: 2.14, 2.15_

  - [x] 3.3 Update `models/s3-starters.js` sidecar parsing and ZIP-without-JSON handling
    - Update `parseSidecarMetadata()`: read `languages` (array), `frameworks` (array), `topics` (array), `devDependencies` (array), `hasCacheData` (boolean), `deployment_platform` (string), `repository` (string)
    - Add backward compatibility: fall back to singular `language`/`framework` if plural not present (e.g., `metadata.languages || (metadata.language ? [metadata.language] : [])`)
    - Handle ZIP-without-JSON in `list()`: when sidecar JSON is not found, push minimal metadata entry with `hasSidecarMetadata: false` instead of skipping
    - Handle ZIP-without-JSON in `get()`: when sidecar JSON is not found, return minimal metadata instead of continuing to next namespace/bucket
    - Add `hasSidecarMetadata: true` to starters that DO have sidecar JSON
    - _Requirements: 2.9, 2.10_

  - [x] 3.4 Update `config/settings.js` tool schemas for starters
    - Replace `list_starters` schema: remove `ghusers` property, add `s3Buckets` (array of strings) and `namespace` (string) properties
    - Update `list_starters` description to reference S3 buckets instead of GitHub
    - Replace `get_starter_info` schema: remove `ghusers` property, add `s3Buckets` (array of strings) and `namespace` (string) properties, keep `starterName` (required)
    - Update `get_starter_info` description to reference S3 and comprehensive metadata
    - Ensure `list_starters` remains GET-eligible (no required params)
    - _Requirements: 2.5, 2.6_

  - [x] 3.5 Update `utils/schema-validator.js` validation schemas for starters
    - Replace `list_starters` schema: remove `ghusers`, add `s3Buckets` (array of strings, items minLength 3 maxLength 63, minItems 1) and `namespace` (string, lowercase alphanumeric with hyphens pattern, maxLength 63)
    - Replace `get_starter_info` schema: remove `ghusers`, add `starterName` (required, string, minLength 1), `s3Buckets`, and `namespace` with same constraints
    - Keep `additionalProperties: false` on both schemas
    - Leave `search_documentation` schema unchanged (still uses `ghusers`)
    - _Requirements: 2.7, 2.8_

  - [x] 3.6 Update `scripts/generate-sidecar-metadata.py` sidecar format
    - Defer `requests` import: move `import requests` inside `fetch_github_metadata()` with try/except so script works without `requests` when only `--repo-path` is used
    - Output plural field names: `languages` (array) instead of `language` (string), `frameworks` (array) instead of `framework` (string)
    - Add missing fields: `topics` (array), `devDependencies` (array from package.json), `hasCacheData` (boolean, check for `@63klabs/cache-data` in dependencies), `deployment_platform` (string, default "atlantis"), `repository` (string from `--github-repo` arg)
    - Add README section parsing: parse `## Features` and `## Prerequisites` sections from README.md to supplement file-detection heuristics
    - Merge README features/prerequisites with file-detected ones, deduplicated
    - Update `generate_metadata()` return structure to match the complete sidecar format
    - _Requirements: 2.11, 2.12, 2.13_

  - [x] 3.7 Update existing tests to use S3-only mocks
    - Update `tests/unit/services/starters-service.test.js`: replace `ghusers` references with `s3Buckets`/`namespace`, mock `Config.getConnCacheProfile('s3-app-starters', ...)` instead of `('github-api', ...)`
    - Update `tests/unit/controllers/starters-controller.test.js`: replace `ghusers` input with `s3Buckets`/`namespace` input
    - Update `tests/unit/models/s3-starters-dao.test.js`: add tests for plural sidecar fields and ZIP-without-JSON handling
    - Update `tests/unit/utils/schema-validator.test.js`: update starters schema tests to validate `s3Buckets`/`namespace` instead of `ghusers`
    - Update any other test files that reference `ghusers` for starters tools
    - Ensure all existing tests pass with the new S3-only approach
    - _Requirements: 2.16_

  - [x] 3.8 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Starters Tools Return S3 Data
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior: service uses `s3-app-starters` connection, accepts `s3Buckets`/`namespace`, sidecar returns plural arrays
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1: `application-infrastructure/src/lambda/read/tests/unit/services/starters-s3-only.property.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 2.9_

  - [x] 3.9 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Starters Tool Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2: `application-infrastructure/src/lambda/read/tests/unit/services/starters-fix-preservation.property.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all non-starters schemas, settings, and tool behavior remain identical after fix

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `npm run test:all` from `application-infrastructure/src/lambda/read/`
  - Verify all unit tests pass including updated starters tests
  - Verify all property-based tests pass (exploration + preservation)
  - Verify all integration tests pass
  - Ensure no regressions in templates, documentation, validation, or other tools
  - Ask the user if questions arise
