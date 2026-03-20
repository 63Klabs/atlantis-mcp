# Fix Starters Tools Bugfix Design

## Overview

The `list_starters` and `get_starter_info` MCP tools return empty results or errors because the starters service depends on the GitHub API (`Config.getConnCacheProfile('github-api', ...)` and `Models.GitHubAPI`) which fails. The fix removes the GitHub API dependency from the starters service and switches to an S3-only approach using `Config.getConnCacheProfile('s3-app-starters', ...)` and `Models.S3Starters`, matching the working templates pattern. This also requires updating the controller, settings, schema validator, S3 starters model, and the Python sidecar metadata generator script.

## Glossary

- **Bug_Condition (C)**: Any call to `list_starters` or `get_starter_info` — the starters service always fails because it depends on the GitHub API connection which returns no results
- **Property (P)**: Starters tools return S3-sourced starter data using the CacheableDataAccess/ApiRequest/cacheObj.getBody(true) pattern, with correct sidecar metadata parsing
- **Preservation**: All non-starters tools (templates, documentation, validation, etc.) continue to function identically; the `github-api` connection and `GitHubAPI` model remain available for other tools
- **starters service** (`services/starters.js`): The service layer that orchestrates data access for starter tools, currently using `github-api` connection
- **templates service** (`services/templates.js`): The working reference implementation using `s3-templates` connection with CacheableDataAccess pattern
- **sidecar metadata**: JSON file co-located with a starter ZIP in S3 at `{namespace}/app-starters/v2/{starter-name}.json`
- **CacheableDataAccess**: Cache-data package class that provides pass-through caching with a fetchFunction pattern
- **ApiRequest**: Cache-data package utility that wraps responses in `ApiRequest.success()` or `ApiRequest.error()` for CacheableDataAccess compatibility

## Bug Details

### Bug Condition

The bug manifests on every call to `list_starters` or `get_starter_info`. The starters service uses `Config.getConnCacheProfile('github-api', 'starters-list')` and `Models.GitHubAPI.listRepositories()` as its primary data source. The GitHub API connection fails or returns no repositories matching the `app-starter` filter, causing both tools to return empty results or STARTER_NOT_FOUND errors. Additionally, the tool schemas expose `ghusers` instead of `s3Buckets`/`namespace`, the sidecar parser reads singular `language`/`framework` instead of plural arrays, and ZIP-without-JSON starters are skipped entirely.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type MCP tool call
  OUTPUT: boolean

  RETURN input.toolName IN ['list_starters', 'get_starter_info']
END FUNCTION
```

Since the bug affects ALL calls to these two tools (the service always routes through the broken GitHub API path), the bug condition is simply: the tool being called is a starters tool.

### Examples

- User calls `list_starters` with no parameters → service calls `Config.getConnCacheProfile('github-api', 'starters-list')` → GitHub API fails → returns `{ starters: [] }`
- User calls `get_starter_info` with `{ starterName: 'atlantis-starter-02' }` → service calls `Config.getConnCacheProfile('github-api', 'starter-detail')` → GitHub API fails → throws STARTER_NOT_FOUND
- User calls `list_starters` with `{ ghusers: ['63klabs'] }` → validates against `Config.settings().github.userOrgs` which may be empty → throws "No valid GitHub users/orgs specified"
- User calls `list_starters` with `{ s3Buckets: ['63klabs'] }` → schema-validator rejects `s3Buckets` as unknown property (only `ghusers` is defined)
- ZIP exists at `63klabs/app-starters/v2/my-starter.zip` without `my-starter.json` → model skips it entirely instead of returning minimal metadata

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `list_templates`, `get_template`, `list_template_versions`, `list_categories`, `check_template_updates` continue to work via the S3 templates service
- `search_documentation` continues to use the GitHub API connection and `GitHubAPI` model
- The `github-api` connection and `GitHubAPI` model remain in the codebase for other tools
- The `s3-app-starters` connection with `starters-list` and `starter-detail` cache profiles in `connections.js` remains unchanged
- `Config.settings().s3.buckets` defaults to `['63klabs']` and `Config.settings().s3.starterPrefix` returns `'app-starters/v2'`
- `validate_naming`, `list_tools`, and other non-starter tools function without changes
- `generate-sidecar-metadata.py` with `--github-repo` and `requests` installed continues to fetch GitHub metadata
- S3 starters model brown-out support (log error, continue with other buckets) remains
- S3 starters model deduplication by first-occurrence-wins priority ordering remains

**Scope:**
All inputs that do NOT target `list_starters` or `get_starter_info` should be completely unaffected by this fix. This includes:
- All template tool calls
- Documentation search calls
- Naming validation calls
- Tool listing calls

## Hypothesized Root Cause

Based on the bug description, the root causes are:

1. **Wrong Connection Profile**: `services/starters.js` uses `Config.getConnCacheProfile('github-api', 'starters-list')` and `Config.getConnCacheProfile('github-api', 'starter-detail')` instead of `Config.getConnCacheProfile('s3-app-starters', 'starters-list')` and `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')`

2. **GitHub API Dependency in Service**: The `list()` fetchFunction calls both `Models.S3Starters.list()` and `Models.GitHubAPI.listRepositories()` via `Promise.all()`. When GitHub fails, the entire aggregation fails or returns incomplete data. The `get()` fetchFunction similarly calls both `Models.S3Starters.get()` and `Models.GitHubAPI.getRepository()`.

3. **Wrong Parameter Schema**: `settings.js` and `schema-validator.js` define `ghusers` parameter for starters tools instead of `s3Buckets` and `namespace`

4. **Wrong Controller Parameter Extraction**: `controllers/starters.js` extracts `ghusers` from input and passes it to the service instead of `s3Buckets` and `namespace`

5. **Incorrect Sidecar Field Names**: `models/s3-starters.js` `parseSidecarMetadata()` reads `language` (string) and `framework` (string) instead of `languages` (array) and `frameworks` (array), and misses `topics`, `devDependencies`, `hasCacheData`, `deployment_platform`, `repository`

6. **ZIP-without-JSON Skipped**: `models/s3-starters.js` `list()` skips starters that have a ZIP but no sidecar JSON, instead of returning minimal metadata

7. **Python Script Defects**: `generate-sidecar-metadata.py` outputs wrong field names, misses fields, crashes without `requests`, and doesn't parse README sections

## Correctness Properties

Property 1: Bug Condition - Starters Tools Return S3 Data

_For any_ call to `list_starters` or `get_starter_info` where starters exist in S3 at `{namespace}/app-starters/v2/{name}.zip`, the fixed service SHALL return starter data sourced exclusively from S3 using the `s3-app-starters` connection with the CacheableDataAccess/ApiRequest/cacheObj.getBody(true) pattern, without any GitHub API calls.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.14, 2.15**

Property 2: Preservation - Non-Starters Tool Behavior

_For any_ MCP tool call that is NOT `list_starters` or `get_starter_info`, the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for templates, documentation, validation, and tool listing operations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `application-infrastructure/src/lambda/read/services/starters.js`

**Rewrite to S3-only, following `services/templates.js` pattern:**

1. **Remove GitHub imports and references**: Remove `Models.GitHubAPI` usage entirely
2. **Switch connection profile in `list()`**: Change `Config.getConnCacheProfile('github-api', 'starters-list')` to `Config.getConnCacheProfile('s3-app-starters', 'starters-list')`
3. **Switch connection profile in `get()`**: Change `Config.getConnCacheProfile('github-api', 'starter-detail')` to `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')`
4. **Replace `ghusers` with `s3Buckets`/`namespace`**: Accept `{ s3Buckets, namespace }` in `list()` and `{ starterName, s3Buckets, namespace }` in `get()`
5. **Validate buckets against settings**: Filter `s3Buckets` against `Config.settings().s3.buckets`, matching the templates service pattern
6. **Simplify fetchFunction in `list()`**: Call only `Models.S3Starters.list(connection, opts)`, wrap result with `ApiRequest.success()` or `ApiRequest.error()`
7. **Simplify fetchFunction in `get()`**: Call only `Models.S3Starters.get(connection, opts)`, handle not-found with STARTER_NOT_FOUND error
8. **Remove `deduplicateStarters` function**: No longer needed since there's only one source (S3 model already deduplicates)
9. **Set `conn.host` to buckets array**: Same pattern as templates service
10. **Set `conn.parameters`**: Include `{ namespace }` for list, `{ starterName, namespace }` for get

**New `list()` signature:**
```javascript
async function list(options = {}) {
  const { s3Buckets, namespace } = options;
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-app-starters', 'starters-list');
  // ... validate buckets, set conn.host, conn.parameters
  // ... fetchFunction calls Models.S3Starters.list(connection, opts)
  // ... return cacheObj.getBody(true);
}
```

**New `get()` signature:**
```javascript
async function get(options = {}) {
  const { starterName, s3Buckets, namespace } = options;
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-app-starters', 'starter-detail');
  // ... validate buckets, set conn.host, conn.parameters
  // ... fetchFunction calls Models.S3Starters.get(connection, opts)
  // ... return cacheObj.getBody(true);
}
```

---

**File 2**: `application-infrastructure/src/lambda/read/controllers/starters.js`

**Replace `ghusers` with `s3Buckets`/`namespace`, following `controllers/templates.js` pattern:**

1. **In `list()`**: Extract `{ s3Buckets, namespace }` from input instead of `{ ghusers }`, pass to `Services.Starters.list({ s3Buckets, namespace })`
2. **In `get()`**: Extract `{ starterName, s3Buckets, namespace }` from input instead of `{ starterName, ghusers }`, pass to `Services.Starters.get({ starterName, s3Buckets, namespace })`
3. **Update logging**: Log `namespace` and `s3BucketsCount` instead of `ghusersCount`

---

**File 3**: `application-infrastructure/src/lambda/read/models/s3-starters.js`

**Update sidecar parsing and handle ZIP-without-JSON:**

1. **Update `parseSidecarMetadata()`**: Read `languages` (array), `frameworks` (array), `topics` (array), `devDependencies` (array), `hasCacheData` (boolean), `deployment_platform` (string), `repository` (string). Keep backward compatibility by falling back to singular `language`/`framework` if plural not present.
   ```javascript
   function parseSidecarMetadata(metadataContent) {
     const metadata = JSON.parse(metadataContent);
     return {
       name: metadata.name || '',
       description: metadata.description || '',
       languages: metadata.languages || (metadata.language ? [metadata.language] : []),
       frameworks: metadata.frameworks || (metadata.framework ? [metadata.framework] : []),
       topics: metadata.topics || [],
       dependencies: metadata.dependencies || [],
       devDependencies: metadata.devDependencies || metadata.dev_dependencies || [],
       hasCacheData: metadata.hasCacheData || metadata.has_cache_data || false,
       deployment_platform: metadata.deployment_platform || 'atlantis',
       features: metadata.features || [],
       prerequisites: metadata.prerequisites || [],
       author: metadata.author || '',
       license: metadata.license || 'UNLICENSED',
       repository: metadata.repository || metadata.github_url || metadata.githubUrl || '',
       repository_type: metadata.repository_type || metadata.repositoryType || 'app-starter',
       version: metadata.version || '',
       last_updated: metadata.last_updated || metadata.lastUpdated || ''
     };
   }
   ```

2. **Handle ZIP-without-JSON in `list()`**: When sidecar JSON is not found (NoSuchKey), instead of skipping, push a minimal metadata entry:
   ```javascript
   allStarters.push({
     name: appName,
     description: '',
     languages: [],
     frameworks: [],
     topics: [],
     dependencies: [],
     devDependencies: [],
     hasCacheData: false,
     deployment_platform: '',
     features: [],
     prerequisites: [],
     author: '',
     license: '',
     repository: '',
     repository_type: 'app-starter',
     version: '',
     last_updated: '',
     hasSidecarMetadata: false,
     namespace,
     bucket,
     s3ZipPath: `s3://${bucket}/${zipFile.Key}`,
     zipSize: zipFile.Size,
     lastModified: zipFile.LastModified
   });
   ```

3. **Handle ZIP-without-JSON in `get()`**: When sidecar JSON is not found, return minimal metadata instead of continuing to next namespace/bucket.

4. **Add `hasSidecarMetadata: true`** to starters that DO have sidecar JSON.

5. **Support namespace filtering in `list()`**: When `connection.parameters.namespace` is provided, use it directly instead of discovering namespaces (matching the templates model pattern).

---

**File 4**: `application-infrastructure/src/lambda/read/config/settings.js`

**Update `list_starters` and `get_starter_info` tool schemas:**

1. **`list_starters`**: Replace `ghusers` property with `s3Buckets` and `namespace`:
   ```javascript
   {
     name: 'list_starters',
     description: 'List all available starter code repositories from configured S3 buckets. Returns starter metadata including name, description, languages, frameworks, features, and S3 location.',
     inputSchema: {
       type: 'object',
       properties: {
         s3Buckets: {
           type: 'array',
           items: { type: 'string' },
           description: 'Filter to specific S3 buckets from configured list'
         },
         namespace: {
           type: 'string',
           description: 'Filter to a specific namespace (S3 root prefix)'
         }
       }
     }
   }
   ```

2. **`get_starter_info`**: Replace `ghusers` with `s3Buckets` and `namespace`:
   ```javascript
   {
     name: 'get_starter_info',
     description: 'Retrieve detailed information about a specific starter code repository. Returns comprehensive metadata including languages, frameworks, features, prerequisites, and S3 location.',
     inputSchema: {
       type: 'object',
       properties: {
         starterName: {
           type: 'string',
           description: 'Name of the starter repository'
         },
         s3Buckets: {
           type: 'array',
           items: { type: 'string' },
           description: 'Filter to specific S3 buckets from configured list'
         },
         namespace: {
           type: 'string',
           description: 'Filter to a specific namespace (S3 root prefix)'
         }
       },
       required: ['starterName']
     }
   }
   ```

---

**File 5**: `application-infrastructure/src/lambda/read/utils/schema-validator.js`

**Update `list_starters` and `get_starter_info` validation schemas:**

1. **`list_starters`**: Replace `ghusers` with `s3Buckets` and `namespace`:
   ```javascript
   list_starters: {
     type: 'object',
     properties: {
       s3Buckets: {
         type: 'array',
         items: { type: 'string', minLength: 3, maxLength: 63 },
         minItems: 1,
         description: 'Filter to specific S3 buckets from configured list'
       },
       namespace: {
         type: 'string',
         pattern: '^[a-z0-9][a-z0-9-]*$',
         maxLength: 63,
         description: 'Filter to a specific namespace (S3 root prefix)'
       }
     },
     additionalProperties: false
   }
   ```

2. **`get_starter_info`**: Replace `ghusers` with `s3Buckets` and `namespace`:
   ```javascript
   get_starter_info: {
     type: 'object',
     properties: {
       starterName: { type: 'string', minLength: 1, description: 'Name of the starter repository' },
       s3Buckets: {
         type: 'array',
         items: { type: 'string', minLength: 3, maxLength: 63 },
         minItems: 1,
         description: 'Filter to specific S3 buckets from configured list'
       },
       namespace: {
         type: 'string',
         pattern: '^[a-z0-9][a-z0-9-]*$',
         maxLength: 63,
         description: 'Filter to a specific namespace (S3 root prefix)'
       }
     },
     required: ['starterName'],
     additionalProperties: false
   }
   ```

---

**File 6**: `scripts/generate-sidecar-metadata.py`

**Update to output new sidecar format, make `requests` optional, add README parsing:**

1. **Defer `requests` import**: Move `import requests` inside `fetch_github_metadata()` with a try/except, so the script works without `requests` when only `--repo-path` is used
   ```python
   def fetch_github_metadata(repo_full_name, github_token=None):
       try:
           import requests
       except ImportError:
           print("Warning: requests library not installed. Skipping GitHub metadata fetch.")
           return {}
       # ... rest of function
   ```

2. **Output plural field names**: Change `language` → `languages` (array), `framework` → `frameworks` (array)

3. **Add missing fields**: `topics`, `devDependencies`, `hasCacheData`, `deployment_platform`, `repository`

4. **Extract `devDependencies` from `package.json`**: Read `devDependencies` keys from `package.json`

5. **Detect `hasCacheData`**: Check if `@63klabs/cache-data` is in dependencies

6. **Set `deployment_platform`**: Default to `"atlantis"`

7. **Set `repository`**: From `--github-repo` arg formatted as `github.com/{user}/{repo}`

8. **Add README section parsing**: Parse `## Features` and `## Prerequisites` sections from README.md to supplement file-detection heuristics
   ```python
   def parse_readme_sections(repo_path):
       """Parse ## Features and ## Prerequisites sections from README.md."""
       # Find README, read content, extract sections
       # Return { 'features': [...], 'prerequisites': [...] }
   ```

9. **Merge README features/prerequisites with file-detected ones**: Union of both sources, deduplicated

10. **Update `generate_metadata()` return structure**: Match the SPECS.md sidecar format exactly

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call the starters service with mocked S3 data and observe that the GitHub API dependency causes failures. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Service Connection Test**: Call `Services.Starters.list({})` and verify it attempts to use `github-api` connection (will fail on unfixed code because GitHub API is unavailable)
2. **Schema Rejection Test**: Call `SchemaValidator.validate('list_starters', { s3Buckets: ['63klabs'] })` and verify it rejects `s3Buckets` as unknown property (will fail on unfixed code because only `ghusers` is defined)
3. **Sidecar Field Test**: Call `parseSidecarMetadata()` with `{ languages: ['Node.js'] }` and verify it returns empty `language` string instead of the array (will fail on unfixed code because it reads singular field)
4. **ZIP-without-JSON Test**: Set up S3 mock with ZIP but no JSON and verify the starter is skipped (will fail on unfixed code because it skips instead of returning minimal metadata)

**Expected Counterexamples**:
- Service attempts GitHub API connection instead of S3 connection
- Schema validator rejects `s3Buckets` and `namespace` parameters
- Sidecar parser returns wrong field types (string instead of array)
- Starters without sidecar JSON are silently dropped

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedStartersService(input)
  ASSERT result.starters IS Array
  ASSERT result uses 's3-app-starters' connection (not 'github-api')
  ASSERT each starter has languages (array), frameworks (array), topics (array)
  ASSERT starters without sidecar JSON have hasSidecarMetadata = false
  ASSERT schema validates s3Buckets and namespace parameters
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT templatesService_original(input) = templatesService_fixed(input)
  ASSERT documentationService_original(input) = documentationService_fixed(input)
  ASSERT validationService_original(input) = validationService_fixed(input)
  ASSERT toolsController_original(input) = toolsController_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for template operations and other non-starters tools, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Templates Service Preservation**: Verify `list_templates`, `get_template`, `list_template_versions`, `list_categories` continue to work identically after fix
2. **Schema Validator Preservation**: Verify all non-starters schemas (`list_templates`, `get_template`, `search_documentation`, etc.) remain unchanged
3. **Settings Preservation**: Verify `getGetEligibleTools()` returns correct tools after schema changes (list_starters should still be GET-eligible since it has no required params)
4. **Connections Preservation**: Verify `connections.js` is not modified — `s3-app-starters` and `github-api` connections remain

### Unit Tests

- Test `services/starters.js` `list()` with mocked S3 data returns starters via S3-only path
- Test `services/starters.js` `get()` with mocked S3 data returns starter detail via S3-only path
- Test `services/starters.js` `list()` validates `s3Buckets` against `Config.settings().s3.buckets`
- Test `services/starters.js` `get()` throws STARTER_NOT_FOUND when starter doesn't exist
- Test `controllers/starters.js` `list()` extracts `s3Buckets` and `namespace` from input
- Test `controllers/starters.js` `get()` extracts `starterName`, `s3Buckets`, `namespace` from input
- Test `models/s3-starters.js` `parseSidecarMetadata()` reads plural `languages`/`frameworks` arrays
- Test `models/s3-starters.js` `parseSidecarMetadata()` reads all new fields (`topics`, `devDependencies`, `hasCacheData`, `deployment_platform`, `repository`)
- Test `models/s3-starters.js` `parseSidecarMetadata()` falls back to singular `language`/`framework` for backward compatibility
- Test `models/s3-starters.js` `list()` returns minimal metadata for ZIP-without-JSON starters
- Test `models/s3-starters.js` `get()` returns minimal metadata for ZIP-without-JSON starters
- Test `models/s3-starters.js` `list()` filters by namespace when provided
- Test `schema-validator.js` validates `list_starters` with `s3Buckets` and `namespace`
- Test `schema-validator.js` validates `get_starter_info` with `starterName`, `s3Buckets`, `namespace`
- Test `schema-validator.js` rejects `ghusers` as unknown property for starters tools
- Test `settings.js` `list_starters` tool schema has `s3Buckets` and `namespace` properties
- Test `settings.js` `get_starter_info` tool schema has `starterName`, `s3Buckets`, `namespace` properties
- Test `generate-sidecar-metadata.py` outputs correct sidecar format with all fields
- Test `generate-sidecar-metadata.py` works without `requests` library when only `--repo-path` is used
- Test `generate-sidecar-metadata.py` parses README `## Features` and `## Prerequisites` sections

### Property-Based Tests

- Generate random valid S3 bucket names and namespace strings, verify starters service accepts them and routes through S3 connection
- Generate random sidecar JSON with various combinations of singular/plural field names, verify `parseSidecarMetadata()` always returns correct plural arrays
- Generate random tool names from the full tool list, verify non-starters tools are completely unaffected by the fix
- Generate random starter names and verify `get()` consistently returns STARTER_NOT_FOUND or valid data (no GitHub API errors)

### Integration Tests

- Test full flow: controller receives `list_starters` request → validates via schema → calls service → service uses S3 connection → model queries S3 → returns MCP response
- Test full flow: controller receives `get_starter_info` request → validates → calls service → returns starter detail or STARTER_NOT_FOUND
- Test that `list_starters` with `s3Buckets` filter only searches specified buckets
- Test that `list_starters` with `namespace` filter only searches specified namespace
- Test that starters with and without sidecar JSON are both returned in list results
