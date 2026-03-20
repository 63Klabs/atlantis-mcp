# Implementation Plan: Update Generate Sidecar Metadata Script

## Overview

Update the Python sidecar metadata generator and JS consumer to support categorized languages/frameworks/features by deployment phase, camelCase output, displayName from README heading, version from GitHub Releases, and multi-path package.json scanning. Replace existing JS tests entirely with new tests validating the categorized format.

## Tasks

- [x] 1. Add new Python helper functions to `scripts/generate-sidecar-metadata.py`
  - [x] 1.1 Implement `parse_readme_table()` function
    - Add function that reads README.md, finds the first markdown table, identifies columns (Build/Deploy, Application Stack, optional Post-Deploy), extracts rows (Languages, Frameworks, Features) with case-insensitive bold match, parses comma-separated values, treats `-` cells as empty arrays
    - Returns dict with `languages`, `frameworks`, `features` each as `{'buildDeploy': [], 'applicationStack': [], 'postDeploy': []}`, plus `hasTable` and `hasFeaturesRow` booleans
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 1.2 Implement `extract_display_name()` function
    - Add function that reads README.md, finds the first `# heading`, returns the heading text stripped of `# ` prefix and trimmed
    - Returns empty string if no heading found
    - _Requirements: 4.1, 4.3_
  - [x] 1.3 Implement `fetch_github_release_version()` function
    - Add function that calls `GET /repos/{owner}/{repo}/releases/latest` via the requests library
    - Returns `"{tag_name} ({published_at_date})"` e.g. `"v1.2.3 (2024-06-15)"` on success
    - Returns empty string if no releases exist or on API error
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Update Python script scanning and orchestration in `scripts/generate-sidecar-metadata.py`
  - [x] 2.1 Update `extract_from_package_json()` for multi-path scanning
    - Scan `{repo_path}/package.json`, `{repo_path}/application-infrastructure/src/package.json`, and `{repo_path}/application-infrastructure/src/*/*/package.json` (glob, up to 3 levels deep from `src/`)
    - Merge dependencies from all found `package.json` files (deduplicated)
    - Log warning and skip on parse error for any individual file
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 2.2 Update `generate_metadata()` orchestrator function
    - Call `parse_readme_table()` for categorized languages/frameworks/features
    - Call `extract_display_name()` for `displayName`
    - Call `fetch_github_release_version()` for version with `package.json` fallback
    - Use multi-path scanning for dependencies
    - Apply features fallback: when table has no Features row, populate `features.applicationStack` from file detection heuristics, set `features.buildDeploy` and `features.postDeploy` to `[]`
    - Output all properties in camelCase: `deploymentPlatform`, `repositoryType`, `lastUpdated`, `displayName`, `hasCacheData`, `devDependencies`
    - Output `languages`, `frameworks`, `features` as categorized structure objects, `topics` as flat array
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.4, 7.1, 7.2, 7.3_

- [x] 3. Checkpoint - Verify Python script changes
  - Ensure the Python script runs without errors on a sample repository, ask the user if questions arise.

- [x] 4. Rewrite `parseSidecarMetadata()` in `application-infrastructure/src/lambda/read/models/s3-starters.js`
  - [x] 4.1 Rewrite `parseSidecarMetadata()` for categorized structure and camelCase
    - Parse `languages`, `frameworks`, `features` as categorized objects `{buildDeploy: [], applicationStack: [], postDeploy: []}`
    - Accept both snake_case and camelCase input property names (`deployment_platform` / `deploymentPlatform`, `repository_type` / `repositoryType`, `last_updated` / `lastUpdated`, `dev_dependencies` / `devDependencies`, `has_cache_data` / `hasCacheData`, `github_url` / `repository`)
    - camelCase takes priority when both are present for the same field
    - Always output camelCase property names
    - Include `displayName` field (default empty string)
    - Return consistent default structure on parse error with empty categorized structures and camelCase keys
    - Remove backward compatibility for singular `language`/`framework` fields
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [x] 4.2 Write property test: Consumer parsing preserves categorized structure
    - **Property 8: Consumer parsing preserves categorized structure**
    - Generator: random categorized structure objects with random string arrays for `buildDeploy`, `applicationStack`, `postDeploy`
    - Assertion: `parseSidecarMetadata(JSON.stringify(input))` returns matching categorized structures
    - Use fast-check library, minimum 100 iterations
    - **Validates: Requirements 8.1**
  - [x] 4.3 Write property test: Consumer normalizes input casing to camelCase output
    - **Property 9: Consumer normalizes input casing to camelCase output**
    - Generator: random sidecar JSON where each dual-name field randomly uses snake_case or camelCase key
    - Assertion: output always has camelCase keys with correct values
    - Use fast-check library, minimum 100 iterations
    - **Validates: Requirements 8.2, 8.3**
  - [x] 4.4 Write property test: Output structure invariant
    - **Property 3 (consumer side): Output structure invariant**
    - Generator: random valid or partial sidecar JSON
    - Assertion: output always has `languages`, `frameworks`, `features` as objects with `buildDeploy`, `applicationStack`, `postDeploy` arrays, and `topics` as flat array
    - Use fast-check library, minimum 100 iterations
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x] 4.5 Write property test: All output keys are camelCase
    - **Property 4 (consumer side): All output keys are camelCase**
    - Generator: random sidecar JSON with mixed casing
    - Assertion: every top-level key in the output matches the camelCase pattern (lowercase first letter, no underscores)
    - Use fast-check library, minimum 100 iterations
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 5. Update fallback objects in `list()` and `get()` in `application-infrastructure/src/lambda/read/models/s3-starters.js`
  - [x] 5.1 Update hardcoded fallback objects in `list()` function
    - Replace flat array `languages`, `frameworks`, `features` with categorized structure `{buildDeploy: [], applicationStack: [], postDeploy: []}`
    - Replace snake_case property names with camelCase: `deployment_platform` to `deploymentPlatform`, `repository_type` to `repositoryType`, `last_updated` to `lastUpdated`
    - Add `displayName: ''` field
    - _Requirements: 8.4_
  - [x] 5.2 Update hardcoded fallback objects in `get()` function
    - Same changes as 5.1 for the `get()` function fallback objects
    - _Requirements: 8.4_

- [x] 6. Checkpoint - Verify JS consumer changes compile and existing behavior is preserved
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Replace test suite in `application-infrastructure/src/lambda/read/tests/unit/models/s3-starters-dao.test.js`
  - [x] 7.1 Write unit tests for `parseSidecarMetadata()`
    - Test with valid categorized JSON — verify all fields parsed correctly including categorized structures
    - Test with invalid JSON — verify default object returned with empty categorized structures and camelCase keys
    - Test with minimal JSON (only `name`) — verify defaults for missing fields use categorized structures
    - Test with `displayName` field — verify it is preserved
    - Test with snake_case input (`deployment_platform`, `repository_type`, `last_updated`) — verify camelCase output
    - Test with camelCase input (`deploymentPlatform`, `repositoryType`, `lastUpdated`) — verify camelCase output
    - Test with mixed snake_case and camelCase input — verify camelCase output, camelCase takes priority
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 7.2 Write unit tests for `list()` and `get()` with new format
    - Test `list()` with no sidecar metadata — verify fallback object uses categorized structure and camelCase
    - Test `get()` with no sidecar metadata — verify fallback object uses categorized structure and camelCase
    - Test `list()` with sidecar metadata — verify categorized structure flows through
    - Test `get()` with sidecar metadata — verify categorized structure flows through
    - _Requirements: 9.1, 9.4_
  - [x] 7.3 Write unit tests for helper functions
    - Test `buildStarterZipKey`, `buildStarterMetadataKey`, `extractAppNameFromKey`, `deduplicateStarters` — existing behavior preserved
    - _Requirements: 9.6_
  - [x] 7.4 Write unit tests for `list()` multi-bucket and brown-out behavior
    - Test deduplication across multiple buckets
    - Test brown-out support when a bucket fails
    - _Requirements: 9.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All new tests use Jest; existing tests in `s3-starters-dao.test.js` are replaced entirely
- Property-based tests use the fast-check library with minimum 100 iterations
- Python script uses snake_case for functions/variables but outputs camelCase JSON keys
- JS consumer uses camelCase for everything
